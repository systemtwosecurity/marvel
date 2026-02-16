// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * PostToolUseFailure Hook
 *
 * Tracks failed tool calls as complement to post-tool-use.
 */

import * as path from "path";
import type { PostToolUseFailureHookInput, SyncHookJSONOutput } from "../sdk-types.js";
import type { ToolCallRecord, RunState } from "../types.js";
import { findRunDir } from "../lib/paths.js";
import { safeAppendFile, safeReadJson, safeWriteJson } from "../lib/file-ops.js";
import { logDebug, buildHookContext } from "../lib/logger.js";
import { summarize, getInputSummary } from "../lib/tool-summary.js";

export async function handlePostToolUseFailure(input: PostToolUseFailureHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("post-tool-use-failure", input);

  const toolName = input.tool_name;
  if (!toolName) {
    return {};
  }

  const runDir = findRunDir();
  if (!runDir) {
    logDebug("Run directory not found, skipping failure recording", context);
    return {};
  }

  const runJsonPath = path.join(runDir, "run.json");
  const runState = safeReadJson<RunState>(runJsonPath, context);
  if (!runState) {
    logDebug("Run state not found, skipping failure recording", context);
    return {};
  }

  const sequence = (runState.toolCallCount || 0) + 1;

  const record: ToolCallRecord = {
    sequence,
    timestamp: new Date().toISOString(),
    tool: toolName,
    input_summary: getInputSummary(input),
    output_summary: input.error ? summarize(input.error) : undefined,
    success: false,
  };

  // Append to tool_calls.jsonl
  const tracePath = path.join(runDir, "tool_calls.jsonl");
  safeAppendFile(tracePath, JSON.stringify(record) + "\n", context);

  // Update run state
  runState.toolCallCount = sequence;
  runState.recentActivity = runState.recentActivity || [];
  runState.recentActivity.push({
    type: "tool_failure",
    timestamp: record.timestamp,
    data: { tool: toolName, input_summary: record.input_summary },
  });

  if (runState.recentActivity.length > 20) {
    runState.recentActivity = runState.recentActivity.slice(-20);
  }

  safeWriteJson(runJsonPath, runState, context);

  return {};
}