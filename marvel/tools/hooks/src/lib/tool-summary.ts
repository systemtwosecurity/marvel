// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Tool Summary Utilities
 *
 * Shared functions for summarizing tool call inputs/outputs.
 * Used by post-tool-use and post-tool-use-failure handlers.
 */

export const MAX_SUMMARY_LENGTH = 200;

export function summarize(
  value: unknown,
  maxLength: number = MAX_SUMMARY_LENGTH
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + "...";
}

export function getInputSummary(input: { tool_input?: unknown }): string {
  const raw = input.tool_input;
  if (!raw || typeof raw !== "object") return "";

  const toolInput = raw as Record<string, unknown>;

  // For file operations, summarize the path
  if (toolInput.file_path || toolInput.path) {
    return summarize(toolInput.file_path || toolInput.path);
  }

  // For bash, summarize the command
  if (toolInput.command) {
    return summarize(toolInput.command);
  }

  // For search operations
  if (toolInput.pattern) {
    return summarize(toolInput.pattern);
  }

  return summarize(toolInput);
}