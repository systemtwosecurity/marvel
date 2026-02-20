// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Bash Security Gate
 *
 * Main security gate for Bash commands.
 * Decision flow:
 * 1. Allowlist hit → allow (no LLM)
 * 2. Denylist hit → deny (no LLM) - MUST come before learned rules for safety
 * 3. Learned rules hit → allow (user previously approved similar command)
 * 4. Else → LLM evaluation via `claude -p` → allow/deny/ask
 *
 * Learning:
 * - When "ask" is returned and user approves, the command pattern is learned
 * - When "allow" is returned by the LLM, the pattern is also learned (so future
 *   invocations skip the LLM and match via learned rules instead)
 * - Learned rules persist across sessions via marvel/security/learned.jsonl
 *
 * SECURITY NOTE: Denylist is checked before learned rules to prevent dangerous
 * commands from being allowed via overly broad learned patterns (e.g., approving
 * "rm /specific/file" should not allow "rm -rf /").
 */

import * as fs from "fs";
import * as path from "path";
import type { SecurityEvaluationResponse } from "../types.js";
import type { LogContext } from "./logger.js";
import { logDebug, logWarn } from "./logger.js";
import { matchesAllowlist, matchesDenylist } from "./external-rules.js";
import { matchesLearnedRules, addLearnedRule } from "./learned-rules.js";
import { addPendingDecision, consumePendingDecision } from "./pending-decisions.js";
import { analyzeWithAgent } from "./agent-evaluator.js";
import { findRunDir } from "./paths.js";

/**
 * Security gate metrics for tracking decision sources
 */
export interface SecurityMetrics {
  bySource: {
    allowlist: number;
    denylist: number;
    learned: number;
    llm: number;
    error: number;
  };
  byDecision: {
    allow: number;
    deny: number;
    ask: number;
  };
  total: number;
  autoAcceptRate: number;
  startedAt: string;
  lastUpdated: string;
}

// In-memory metrics
let metrics: SecurityMetrics = createFreshMetrics();

function createFreshMetrics(): SecurityMetrics {
  return {
    bySource: {
      allowlist: 0,
      denylist: 0,
      learned: 0,
      llm: 0,
      error: 0,
    },
    byDecision: {
      allow: 0,
      deny: 0,
      ask: 0,
    },
    total: 0,
    autoAcceptRate: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Update metrics after a security decision.
 */
function trackDecision(source: SecurityEvaluationResponse["source"], decision: "allow" | "deny" | "ask"): void {
  metrics.bySource[source]++;
  metrics.byDecision[decision]++;
  metrics.total++;

  // Auto-accept includes allowlist and learned rules
  const autoAccepts = metrics.bySource.allowlist + metrics.bySource.learned;
  metrics.autoAcceptRate = metrics.total > 0 ? autoAccepts / metrics.total : 0;
  metrics.lastUpdated = new Date().toISOString();
}

/**
 * Persist metrics to the run directory.
 */
function persistMetrics(context?: LogContext): void {
  const runDir = findRunDir();
  if (!runDir) return;

  try {
    const metricsPath = path.join(runDir, "security-metrics.json");
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), { mode: 0o600 });
    logDebug("Persisted security metrics", context);
  } catch {
    // Ignore persistence errors - metrics are in-memory anyway
  }
}

/**
 * Get current security metrics.
 */
export function getSecurityMetrics(): SecurityMetrics {
  return { ...metrics };
}

/**
 * Reset security metrics (useful for testing).
 */
export function resetSecurityMetrics(): void {
  metrics = createFreshMetrics();
}

/**
 * Check if we're in a recursive security evaluation call.
 * This prevents infinite loops when the LLM evaluation itself triggers Bash commands.
 */
function isRecursiveCall(): boolean {
  return process.env.MARVEL_SECURITY_EVAL === "1";
}

/**
 * Evaluate a Bash command through the security gate.
 *
 * @param command - The bash command to evaluate
 * @param description - Optional description of the command's purpose
 * @param context - Logging context
 * @returns Security evaluation result
 */
export async function evaluateBashCommand(
  command: string,
  description: string | undefined,
  context: LogContext
): Promise<SecurityEvaluationResponse> {
  // Recursion guard: if we're in a security evaluation call, always allow
  // This prevents infinite loops when `claude -p` triggers hooks
  if (isRecursiveCall()) {
    logDebug("Recursion guard triggered - allowing command", context);
    return {
      decision: "allow",
      reason: "Recursive security evaluation call",
      source: "allowlist",
    };
  }

  // Layer 1: Check allowlist
  const allowRule = matchesAllowlist(command, context);
  if (allowRule) {
    logDebug(`Allowlist match: ${allowRule.id}`, context);
    trackDecision("allowlist", "allow");
    persistMetrics(context);
    return {
      decision: "allow",
      reason: allowRule.reason,
      source: "allowlist",
    };
  }

  // Layer 2: Check denylist (BEFORE learned rules for safety)
  // This prevents dangerous commands from being allowed via overly broad learned patterns
  const denyRule = matchesDenylist(command, context);
  if (denyRule) {
    logDebug(`Denylist match: ${denyRule.id}`, context);
    trackDecision("denylist", "deny");
    persistMetrics(context);
    return {
      decision: "deny",
      reason: denyRule.reason,
      source: "denylist",
    };
  }

  // Layer 3: Check learned rules (user previously approved similar commands)
  const learnedRule = matchesLearnedRules(command, context);
  if (learnedRule) {
    logDebug(`Learned rule match: ${learnedRule.id}`, context);
    trackDecision("learned", "allow");
    persistMetrics(context);
    return {
      decision: "allow",
      reason: `Previously approved: ${learnedRule.reason}`,
      source: "learned",
    };
  }

  // Layer 4: LLM evaluation (no list matches)
  logDebug("No list match, evaluating with LLM", context);
  try {
    const llmResult = await analyzeWithAgent(command, description, context);

    // Track "ask" and "allow" decisions so we can learn from them.
    // "ask": user will approve/deny → PostToolUse learns from approval.
    // "allow": LLM already approved → PostToolUse learns the pattern to skip LLM next time.
    if (llmResult.decision === "ask" || llmResult.decision === "allow") {
      addPendingDecision(command, llmResult.reason, description, context, llmResult.suggestedRule);
    }

    trackDecision("llm", llmResult.decision);
    persistMetrics(context);
    return {
      decision: llmResult.decision,
      reason: llmResult.reason,
      source: "llm",
      suggestions: llmResult.suggestions,
    };
  } catch (error) {
    // Fail-ask: on error, prompt user instead of silently allowing
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`LLM evaluation failed, asking user: ${message}`, context);

    trackDecision("error", "ask");
    persistMetrics(context);
    return {
      decision: "ask",
      reason: "Security check unavailable - user confirmation required",
      source: "error",
    };
  }
}

/**
 * Process a command that was approved (by user or LLM).
 * Called from PostToolUse when a Bash command completes.
 * If the command had a pending decision (from "ask" or LLM "allow"),
 * we learn the pattern so future invocations skip the LLM.
 *
 * @param command - The bash command that was executed
 * @param context - Logging context
 * @returns true if a new rule was learned, false otherwise
 */
export function processApprovedCommand(
  command: string,
  context?: LogContext
): boolean {
  // Check if this command had a pending decision (from "ask" or LLM "allow")
  const pending = consumePendingDecision(command, context);
  if (!pending) {
    // Command was not in pending set - it was either:
    // - Auto-allowed by allowlist/learned rules
    // - Already processed
    return false;
  }

  // Command was approved (by user or LLM) - try to learn from it
  // addLearnedRule returns null if the pattern is too dangerous to learn
  logDebug(`Attempting to learn from approved command: ${command.slice(0, 50)}...`, context);
  const rule = addLearnedRule(command, context, pending.suggestedRule);

  if (rule) {
    logDebug(`Successfully learned rule: ${rule.id}`, context);
    return true;
  }

  logDebug("Pattern rejected as unsafe - not learning this command", context);
  return false;
}