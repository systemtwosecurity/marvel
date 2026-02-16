// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * UserPromptSubmit Hook
 *
 * Captures user guidance (corrections, directions) for learning.
 */

import * as path from "path";
import type { UserPromptSubmitHookInput, SyncHookJSONOutput } from "../sdk-types.js";
import type { Guidance, RunState } from "../types.js";
import { findRunDir } from "../lib/paths.js";
import { detectGuidanceType, detectCategory } from "../lib/guidance.js";
import { safeAppendFile, safeReadJson, safeWriteJson } from "../lib/file-ops.js";
import { logDebug, buildHookContext } from "../lib/logger.js";
import { redactSensitive } from "../lib/redact.js";
import { compileMarvelStatus } from "../lib/marvel-status.js";

const STATUS_PATTERN = /^\/?\s*marvel[\s-]+(status|info|health)\s*$/i;

// Patterns for detecting corrections
const CORRECTION_PATTERNS = [
  /^no[,.]?\s/i,
  /^don'?t\s/i,
  /^instead[,.]?\s/i,
  /^actually[,.]?\s/i,
  /^not\s.*[,.]?\s(use|do)/i,
  /^wrong/i,
  /^that'?s\s+not/i,
  /should\s+(not|never)\s/i,
  /shouldn'?t\s/i,
  /that\s+won'?t\s+work/i,
  /wrong\s+approach/i,
  /too\s+shallow/i,
  /more\s+robust/i,
  /that'?s\s+not\s+what/i,
  /^use\s+/i,
  /misunderstand/i,
  /^(the|this)\s+is\s+(wrong|incorrect)/i,
];

function generateGuidanceId(): string {
  return `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function handleUserPromptSubmit(
  input: UserPromptSubmitHookInput
): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("user-prompt-submit", input);
  const prompt = input.prompt;
  if (!prompt || prompt.length < 3) {
    return {};
  }

  if (STATUS_PATTERN.test(prompt.trim())) {
    return compileMarvelStatus(context);
  }

  const runDir = findRunDir();
  if (!runDir) {
    logDebug("Run directory not found, skipping hook", context);
    return {};
  }

  const guidanceType = detectGuidanceType(prompt, CORRECTION_PATTERNS);

  // Only capture corrections and directions
  if (guidanceType !== "correction" && guidanceType !== "direction") {
    return {};
  }

  // Read run state to get lastInjection for before/after context
  const runJsonPath = path.join(runDir, "run.json");
  const runState = safeReadJson<RunState>(runJsonPath, context);

  // Contextual boost: short messages right after a tool call are more likely corrections
  let confidence = guidanceType === "correction" ? 0.8 : 0.6;
  if (guidanceType === "correction" && prompt.length < 50 && runState?.lastInjection) {
    confidence = 0.9;
  }

  const guidance: Guidance = {
    id: generateGuidanceId(),
    timestamp: new Date().toISOString(),
    run_id: path.basename(runDir),
    type: guidanceType,
    content: redactSensitive(prompt),
    category: detectCategory(prompt),
    confidence,
    // Capture preceding context from the most recent injection
    preceding_tool: runState?.lastInjection ? "Edit" : undefined,
    preceding_file: runState?.lastInjection?.file,
    preceding_injections: runState?.lastInjection?.packs,
  };

  // Append to guidance.jsonl
  const guidancePath = path.join(runDir, "guidance.jsonl");
  if (!safeAppendFile(guidancePath, JSON.stringify(guidance) + "\n", context)) {
    return {};
  }

  // Update run state correction count if it's a correction
  if (guidanceType === "correction") {
    if (runState) {
      runState.correctionCount = (runState.correctionCount || 0) + 1;
      runState.recentActivity = runState.recentActivity || [];
      runState.recentActivity.push({
        type: "capture",
        timestamp: guidance.timestamp,
        data: { guidanceType, category: guidance.category },
      });
      // Keep only last 20 activities
      if (runState.recentActivity.length > 20) {
        runState.recentActivity = runState.recentActivity.slice(-20);
      }
      safeWriteJson(runJsonPath, runState, context);
    }
  }

  return {};
}