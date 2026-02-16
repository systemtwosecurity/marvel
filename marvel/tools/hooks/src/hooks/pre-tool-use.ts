// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * PreToolUse Hook
 *
 * Injects relevant lessons before file operations.
 * This is the core of MARVEL's knowledge injection system.
 */

import * as path from "path";
import type { PreToolUseHookInput, SyncHookJSONOutput, PreToolUseHookSpecificOutput } from "../sdk-types.js";
import type { LoadedPack, Guidance, RunState, InjectionRecord } from "../types.js";
import { findMarvelRoot, findRunDir } from "../lib/paths.js";
import { loadAllPacks } from "../loaders/pack-loader.js";
import { calculateRelevance, selectTopPacks } from "../lib/relevance.js";
import { checkToolPreference } from "../rules/tool-preferences.js";
import { checkBuildOrder } from "../rules/build-order.js";
import { evaluateBashCommand } from "../lib/bash-security-gate.js";
import { checkPreCommitRequirements, checkMergeRequirements } from "../lib/session-state.js";
import { safeParseJsonl, safeReadJson, safeWriteJson, safeAppendFile } from "../lib/file-ops.js";
import { logDebug, buildHookContext, type LogContext } from "../lib/logger.js";

const TOOLS_WITH_FILES = ["Edit", "Write", "Read"];
const MAX_LESSONS_PER_PACK = 3;
const MAX_TOTAL_LESSONS = 10;
const MAX_INJECTION_CACHE_SIZE = 200;

// In-memory dedup: tracks lesson keys injected during this daemon lifetime.
// Resets on daemon restart (process exit) and explicitly via clearInjectionCache().
const recentlyInjected = new Set<string>();

export function clearInjectionCache(): void {
  recentlyInjected.clear();
}

function getFilePath(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") return null;

  const ti = toolInput as Record<string, unknown>;
  const filePath = ti.file_path || ti.path || ti.file;
  return typeof filePath === "string" ? filePath : null;
}

function readRecentGuidance(
  runDir: string,
  context: LogContext,
  windowMinutes: number = 30
): Guidance[] {
  const guidancePath = path.join(runDir, "guidance.jsonl");
  const cutoff = Date.now() - windowMinutes * 60 * 1000;

  const allGuidance = safeParseJsonl<Guidance>(guidancePath, context);
  return allGuidance.filter((g) => new Date(g.timestamp).getTime() > cutoff);
}

function formatLessonsForContext(
  packs: LoadedPack[],
  filePath: string
): string {
  const sections: string[] = [];
  let totalLessons = 0;
  const newKeys: string[] = [];

  for (const pack of packs) {
    if (totalLessons >= MAX_TOTAL_LESSONS) break;

    // Sort by utility_score descending (higher utility = more helpful); default 0.5 for unscored
    const sorted = [...pack.lessons].sort(
      (a, b) => (b.utility_score ?? 0.5) - (a.utility_score ?? 0.5)
    );
    const relevantLessons = sorted.slice(0, MAX_LESSONS_PER_PACK);
    if (relevantLessons.length === 0) continue;

    const lessonLines: string[] = [];
    for (const lesson of relevantLessons) {
      const key = `${pack.metadata.name}::${lesson.title}`;
      if (recentlyInjected.has(key)) continue;
      totalLessons++;
      newKeys.push(key);
      lessonLines.push(`  - ${lesson.title}: ${lesson.actionable}`);
    }

    if (lessonLines.length > 0) {
      sections.push(`[${pack.metadata.name}]\n${lessonLines.join("\n")}`);
    }
  }

  if (sections.length === 0) {
    return "";
  }

  // Commit new keys to the cache after successful formatting
  if (recentlyInjected.size + newKeys.length > MAX_INJECTION_CACHE_SIZE) {
    recentlyInjected.clear();
  }
  for (const key of newKeys) {
    recentlyInjected.add(key);
  }

  return `<marvel-context file="${filePath}">\n${sections.join(
    "\n\n"
  )}\n</marvel-context>`;
}

export async function handlePreToolUse(input: PreToolUseHookInput): Promise<SyncHookJSONOutput> {
  const logContext = buildHookContext("pre-tool-use", input);
  const toolName = input.tool_name;
  const toolInput = input.tool_input as Record<string, unknown> | undefined;

  // Security gate for Bash commands
  if (toolName === "Bash" && toolInput?.command) {
    const command = toolInput.command as string;
    const description = toolInput.description as string | undefined;

    // Tool preference and build-order warnings (non-blocking)
    const pref = checkToolPreference(command);
    const buildWarn = checkBuildOrder(command);

    // Collect all warnings into additionalContext
    const warnings: string[] = [];
    if (pref) warnings.push(`<marvel-warning>${pref.message}</marvel-warning>`);
    if (buildWarn) warnings.push(`<marvel-warning>${buildWarn.message}</marvel-warning>`);

    // Merge requirements check — BLOCKING
    // Tests must pass before any merge to main
    const MERGE_PATTERNS = [
      /^gh\s+pr\s+merge\b/,
      /^gh\s+api\s+.*\/merge\b/,
      /^gh\s+pr\s+create\s+.*--merge\b/,
    ];

    if (MERGE_PATTERNS.some(p => p.test(command.trim()))) {
      const mergeCheck = checkMergeRequirements(logContext);
      if (!mergeCheck.ready) {
        logDebug(`Merge requirements not met: ${mergeCheck.missing.join(", ")}`, logContext);

        const hookSpecificOutput: PreToolUseHookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: mergeCheck.message,
          additionalContext: `<marvel-warning>BLOCKED: ${mergeCheck.message}</marvel-warning>`,
        };
        return { hookSpecificOutput };
      }
    }

    // Pre-commit/pre-push requirements check
    // Non-blocking warning — surfaces context but lets the allowlist decide permission
    if (/^git\s+(commit|push)\b/.test(command.trim())) {
      const preCommitCheck = checkPreCommitRequirements(logContext);
      if (!preCommitCheck.ready) {
        const action = /^git\s+push\b/.test(command.trim()) ? "pushing" : "committing";
        logDebug(`Pre-${action} requirements not met: ${preCommitCheck.missing.join(", ")}`, logContext);

        // Return as non-blocking warning context (not a permission gate)
        warnings.push(`<marvel-warning>${preCommitCheck.message}</marvel-warning>`);
      }
    }

    // Security gate evaluation
    const securityResult = await evaluateBashCommand(command, description, logContext);

    const warningContext = warnings.length > 0 ? warnings.join("\n") : undefined;

    // Merge warnings into hookSpecificOutput.additionalContext alongside permissionDecision
    const hookSpecificOutput: PreToolUseHookSpecificOutput = {
      hookEventName: "PreToolUse",
      permissionDecision: securityResult.decision,
      permissionDecisionReason: securityResult.reason,
      additionalContext: warningContext,
    };

    return { hookSpecificOutput };
  }

  if (!TOOLS_WITH_FILES.includes(toolName)) {
    return {};
  }

  const filePath = getFilePath(input.tool_input);
  if (!filePath) {
    return {};
  }

  const marvelRoot = findMarvelRoot();
  if (!marvelRoot) {
    logDebug("MARVEL root not found, skipping hook", logContext);
    return {};
  }

  // Load packs and calculate relevance
  const packs = await loadAllPacks(marvelRoot);
  if (packs.length === 0) {
    return {};
  }

  // Get recent guidance for relevance boosting
  const runDir = findRunDir();
  const recentGuidance = runDir ? readRecentGuidance(runDir, logContext) : [];

  // Calculate relevance scores
  const scores = packs.map((pack) => ({
    pack,
    score: calculateRelevance(pack, filePath, recentGuidance),
  }));

  // Select top packs
  const selectedPacks = selectTopPacks(scores, filePath, recentGuidance);
  if (selectedPacks.length === 0) {
    return {};
  }

  // Format lessons for context injection
  const context = formatLessonsForContext(selectedPacks, filePath);
  if (!context) {
    return {};
  }

  // Track injection in run state
  if (runDir) {
    const runJsonPath = path.join(runDir, "run.json");
    const runState = safeReadJson<RunState>(runJsonPath, logContext);
    if (runState) {
      runState.recentActivity = runState.recentActivity || [];
      runState.recentActivity.push({
        type: "injection",
        timestamp: new Date().toISOString(),
        data: {
          file: filePath,
          packs: selectedPacks.map((p) => p.metadata.name),
          lessonCount: selectedPacks.reduce(
            (sum, p) => sum + Math.min(p.lessons.length, MAX_LESSONS_PER_PACK),
            0
          ),
        },
      });
      if (runState.recentActivity.length > 20) {
        runState.recentActivity = runState.recentActivity.slice(-20);
      }
      // Track last injection for before/after pair capture in corrections
      // Build relevance score map for selected packs
      const scoreMap = new Map(scores.map((s) => [s.pack.metadata.name, s.score]));
      runState.lastInjection = {
        file: filePath,
        packs: selectedPacks.map((p) => p.metadata.name),
        relevanceScores: selectedPacks.map((p) => ({
          pack: p.metadata.name,
          score: scoreMap.get(p.metadata.name) ?? 0,
          signals: [],
        })),
        lessons: selectedPacks.flatMap((p) =>
          p.lessons.slice(0, MAX_LESSONS_PER_PACK).map((l) => l.title)
        ),
      };
      safeWriteJson(runJsonPath, runState, logContext);
    }

    // Write injection record for outcome tracking
    const injectionRecord: InjectionRecord = {
      timestamp: new Date().toISOString(),
      file: filePath,
      lessons_injected: selectedPacks.flatMap((p) =>
        p.lessons.slice(0, MAX_LESSONS_PER_PACK).map((l) => l.title)
      ),
      packs_injected: selectedPacks.map((p) => p.metadata.name),
    };
    safeAppendFile(
      path.join(runDir, "injections.jsonl"),
      JSON.stringify(injectionRecord) + "\n",
      logContext
    );
  }

  const hookSpecificOutput: PreToolUseHookSpecificOutput = {
    hookEventName: "PreToolUse",
    additionalContext: context,
  };
  return { hookSpecificOutput };
}