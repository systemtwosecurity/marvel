// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Security LLM Client
 *
 * Uses `claude -p` for one-shot security analysis of ambiguous commands.
 * Implements fail-open behavior: on error, returns "allow" to fall back to native permissions.
 */

import * as fs from "fs";
import * as path from "path";
import type { SyncHookJSONOutput, PermissionRequestHookSpecificOutput } from "../sdk-types.js";
import type { LogContext } from "./logger.js";
import { logDebug, logWarn } from "./logger.js";
import { getSecurityDir } from "./paths.js";
import { redactSensitive } from "./redact.js";

const MODEL = "haiku";

// Response type for the analyzeWithLlm function
export interface LlmAnalysisResult {
  decision: "allow" | "deny" | "ask";
  reason: string;
  suggestions?: {
    allow?: Array<{ pattern: string; reason: string }>;
    deny?: Array<{ pattern: string; reason: string }>;
  };
  suggestedRule?: { type: "prefix" | "regex" | "contains"; pattern: string; reason: string };
}

/**
 * Escape special characters for safe inclusion in prompt.
 * Prevents prompt injection by neutralizing control sequences.
 */
export function escapeForPrompt(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Log a rule suggestion to the suggestions file.
 * This allows humans to review and potentially add rules.
 */
export function logSuggestion(
  command: string,
  suggestions: LlmAnalysisResult["suggestions"],
  context?: LogContext
): void {
  if (!suggestions) return;

  const suggestionsPath = path.join(getSecurityDir(), "suggestions.jsonl");

  // Ensure directory exists
  const dir = path.dirname(suggestionsPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch {
    logWarn(`Failed to create suggestions directory: ${dir}`, context);
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    command: redactSensitive(command),
    suggestions,
  };

  try {
    fs.appendFileSync(suggestionsPath, JSON.stringify(entry) + "\n", { mode: 0o600 });
    logDebug("Logged rule suggestion", context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to log suggestion: ${message}`, context);
  }
}

/**
 * Log a security decision for batch analysis.
 * Enables reviewing decisions over time to improve rules and prompts.
 */
export function logDecision(
  command: string,
  description: string | undefined,
  decision: "allow" | "deny" | "ask",
  reasoning: string,
  durationMs: number,
  context?: LogContext
): void {
  const decisionsPath = path.join(getSecurityDir(), "decisions.jsonl");

  // Ensure directory exists
  const dir = path.dirname(decisionsPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch {
    logWarn(`Failed to create decisions directory: ${dir}`, context);
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    command: redactSensitive(command),
    description: description ? redactSensitive(description) : null,
    decision,
    reasoning,
    durationMs,
    model: MODEL,
  };

  try {
    fs.appendFileSync(decisionsPath, JSON.stringify(entry) + "\n", { mode: 0o600 });
    logDebug(`Logged security decision: ${decision}`, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to log decision: ${message}`, context);
  }
}

/**
 * Create an "allow" decision response.
 * SDK allow has no message field — only updatedInput and updatedPermissions.
 */
export function allow(): SyncHookJSONOutput {
  const decision: PermissionRequestHookSpecificOutput = {
    hookEventName: "PermissionRequest",
    decision: {
      behavior: "allow",
    },
  };
  return { hookSpecificOutput: decision };
}

/**
 * Create a "deny" decision response.
 */
export function deny(reason: string): SyncHookJSONOutput {
  const decision: PermissionRequestHookSpecificOutput = {
    hookEventName: "PermissionRequest",
    decision: {
      behavior: "deny",
      message: reason,
    },
  };
  return { hookSpecificOutput: decision };
}

/**
 * Return empty output to let Claude Code ask the user.
 * In the SDK, there is no "ask" behavior — returning {} means no decision was made.
 */
export function askUser(_message?: string): SyncHookJSONOutput {
  return {};
}