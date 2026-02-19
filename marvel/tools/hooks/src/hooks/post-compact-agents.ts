// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * PostCompact Agent State Recovery
 *
 * Fires as a SessionStart(compact) hook after context compaction.
 * Reads the daemon's in-memory agent registry (primary) or the temp
 * file written by PreCompact (fallback), then injects a compact summary
 * into the lead agent's context so it knows about all in-flight agents.
 */

import * as fs from "fs";
import * as path from "path";
import type { BaseHookInput, SyncHookJSONOutput } from "../sdk-types.js";
import type { SerializedAgentState, AgentEntry } from "../lib/agent-registry.js";
import { getSessionAgents, getTeamState } from "../lib/agent-registry.js";
import { getTempDir } from "../lib/paths.js";
import { safeReadJson } from "../lib/file-ops.js";
import { logDebug, logWarn, buildHookContext } from "../lib/logger.js";

/** Max chars for the injected context (~500 tokens at 4 chars/token) */
const MAX_CONTEXT_CHARS = 2000;

/** Max chars for an individual agent's result summary */
const MAX_RESULT_CHARS = 80;

function getAgentStateFilePath(sessionId: string): string {
  return path.join(getTempDir(), `agents-${sessionId}.json`);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function formatAgentRow(agent: AgentEntry): string {
  const status = agent.status;
  let result: string;

  switch (status) {
    case "completed": {
      result = agent.resultSummary
        ? truncate(agent.resultSummary, MAX_RESULT_CHARS)
        : "Completed (result in transcript)";
      break;
    }
    case "errored": {
      result = agent.errorMessage
        ? `Error: ${truncate(agent.errorMessage, MAX_RESULT_CHARS - 7)}`
        : "Errored (unknown error)";
      break;
    }
    case "running": {
      result = "Still running — await with TaskOutput";
      break;
    }
  }

  return `| ${agent.id} | ${agent.agentType} | ${status} | ${result} |`;
}

function buildContextInjection(agents: AgentEntry[], teamName: string | null): string {
  const lines: string[] = [
    "<agent-state-recovery>",
    "## Agents Active Before Compaction",
    "",
    "The following agents were running when context was compacted. Their state has been preserved.",
    "",
    "| Agent ID | Type | Status | Result |",
    "|----------|------|--------|--------|",
  ];

  for (const agent of agents) {
    lines.push(formatAgentRow(agent));
  }

  const runningAgents = agents.filter((a) => a.status === "running");
  if (runningAgents.length > 0) {
    lines.push("");
    lines.push(`**Action Required:** ${runningAgents.length} agent(s) still running. Use TaskOutput with the agent ID to check results before proceeding.`);
  }

  if (teamName) {
    lines.push("");
    lines.push(`**Team:** "${teamName}" is active. Team coordination should continue.`);
  }

  lines.push("</agent-state-recovery>");

  let result = lines.join("\n");

  // Enforce budget — truncate from the bottom if too long
  if (result.length > MAX_CONTEXT_CHARS) {
    const header = lines.slice(0, 8).join("\n"); // Keep header + table header
    const footer = "\n\n... (truncated — too many agents for context budget)\n</agent-state-recovery>";
    const budget = MAX_CONTEXT_CHARS - header.length - footer.length;

    const agentRows: string[] = [];
    let used = 0;
    for (const agent of agents) {
      const row = formatAgentRow(agent);
      if (used + row.length + 1 > budget) break;
      agentRows.push(row);
      used += row.length + 1;
    }

    result = header + "\n" + agentRows.join("\n") + footer;
  }

  return result;
}

function cleanupTempFile(filePath: string, context: ReturnType<typeof buildHookContext>): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logDebug(`Cleaned up agent state file: ${filePath}`, context);
    }
  } catch {
    logWarn(`Failed to clean up agent state file: ${filePath}`, context);
  }
}

export async function handlePostCompactAgents(
  input: BaseHookInput,
): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("post-compact-agents", input);
  const sessionId = (input as Record<string, unknown>).session_id as string | undefined;

  if (!sessionId) {
    logWarn("No session_id in input, skipping post-compact agent recovery", context);
    return {};
  }

  const agentFilePath = getAgentStateFilePath(sessionId);

  // Primary: check daemon in-memory registry (survives compaction)
  let agents = getSessionAgents(sessionId);

  // Fallback: read temp file (covers daemon restart between pre/post compact)
  if (agents.length === 0) {
    logDebug("No agents in daemon registry, checking temp file fallback", context);
    const serialized = safeReadJson<SerializedAgentState>(agentFilePath, context);
    if (serialized && serialized.version === 1 && Array.isArray(serialized.agents)) {
      agents = serialized.agents;
      logDebug(`Loaded ${agents.length} agents from temp file fallback`, context);
    }
  }

  // Clean up temp file regardless of source
  cleanupTempFile(agentFilePath, context);

  if (agents.length === 0) {
    logDebug("No agents to recover after compaction", context);
    return {};
  }

  // Get team state
  const teamState = getTeamState(sessionId);
  const teamName = teamState?.name ?? null;

  // Build and return context injection
  const contextInjection = buildContextInjection(agents, teamName);
  logDebug(`Injecting agent recovery context: ${agents.length} agents, ${contextInjection.length} chars`, context);

  return {
    hookSpecificOutput: {
      additionalContext: contextInjection,
    },
  } as SyncHookJSONOutput;
}
