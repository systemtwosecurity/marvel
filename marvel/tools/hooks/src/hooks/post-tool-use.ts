// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * PostToolUse Hook
 *
 * Records tool calls to trace for analysis.
 */

import * as path from "path";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "../sdk-types.js";
import type { ToolCallRecord, RunState } from "../types.js";
import { findRunDir } from "../lib/paths.js";
import { safeAppendFile, safeReadJson, safeWriteJson } from "../lib/file-ops.js";
import { logDebug, buildHookContext } from "../lib/logger.js";
import { processApprovedCommand } from "../lib/bash-security-gate.js";
import { recordPreCommitSuccess, invalidatePreCommitChecks } from "../lib/session-state.js";
import { summarize, getInputSummary } from "../lib/tool-summary.js";

export async function handlePostToolUse(input: PostToolUseHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("post-tool-use", input);

  const toolName = input.tool_name;
  const toolInput = input.tool_input as Record<string, unknown> | undefined;

  // Process Bash command approvals for learning
  // If this command had a pending decision (LLM "allow" or user-approved "ask"), learn its pattern
  if (toolName === "Bash" && toolInput?.command) {
    const command = toolInput.command as string;
    const learned = processApprovedCommand(command, context);
    if (learned) {
      logDebug(`Learned new security rule from approved command`, context);
    }

    // Track pre-commit checks (lint, test, build, typecheck)
    const preCommitCheck = recordPreCommitSuccess(command, context);
    if (preCommitCheck) {
      logDebug(`Recorded pre-commit success: ${preCommitCheck}`, context);
    }
  }

  // Invalidate lint/typecheck when code files are edited
  if ((toolName === "Edit" || toolName === "Write") && toolInput) {
    const filePath = (toolInput.file_path ?? toolInput.path) as string | undefined;
    if (filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      invalidatePreCommitChecks(["lint", "typecheck", "test"], context);
    }
  }

  const runDir = findRunDir();
  if (!runDir) {
    logDebug("Run directory not found, skipping trace recording", context);
    return {};
  }

  // Read current state to get persistent sequence number
  const runJsonPath = path.join(runDir, "run.json");
  const runState = safeReadJson<RunState>(runJsonPath, context);
  if (!runState) {
    logDebug("Run state not found, skipping trace recording", context);
    return {};
  }

  // Use toolCallCount as the sequence number (persisted across CLI invocations)
  const sequence = (runState.toolCallCount || 0) + 1;

  const record: ToolCallRecord = {
    sequence,
    timestamp: new Date().toISOString(),
    tool: toolName,
    input_summary: getInputSummary(input),
    output_summary: input.tool_response
      ? summarize(input.tool_response)
      : undefined,
    success: true, // Claude Code doesn't pass error info, assume success
  };

  // Append to tool_calls.jsonl
  const tracePath = path.join(runDir, "tool_calls.jsonl");
  if (!safeAppendFile(tracePath, JSON.stringify(record) + "\n", context)) {
    return {};
  }

  // Update tool call count in run state (this also becomes the next sequence number)
  runState.toolCallCount = sequence;
  safeWriteJson(runJsonPath, runState, context);

  return {};
}