// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * PreCompact Hook
 *
 * Snapshots run state before context compaction.
 */

import * as path from "path";
import type { PreCompactHookInput, SyncHookJSONOutput } from "../sdk-types.js";
import type { RunState } from "../types.js";
import { findRunDir, getTempDir } from "../lib/paths.js";
import { serializeForSession, hasSessionAgents } from "../lib/agent-registry.js";
import { safeReadJson, safeWriteJson } from "../lib/file-ops.js";
import { logDebug, buildHookContext } from "../lib/logger.js";

export async function handlePreCompact(input: PreCompactHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("pre-compact", input);

  const runDir = findRunDir();
  if (!runDir) {
    logDebug("Run directory not found, skipping pre-compact", context);
    return {};
  }

  const runJsonPath = path.join(runDir, "run.json");
  const runState = safeReadJson<RunState>(runJsonPath, context);
  if (!runState) {
    logDebug("Run state not found, skipping pre-compact", context);
    return {};
  }

  // Save snapshot before compaction
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(runDir, `snapshot-${timestamp}.json`);
  safeWriteJson(snapshotPath, runState, context);

  // Append compaction event to recentActivity
  runState.recentActivity = runState.recentActivity || [];
  runState.recentActivity.push({
    type: "compaction",
    timestamp: new Date().toISOString(),
    data: { toolCallCount: runState.toolCallCount },
  });

  if (runState.recentActivity.length > 20) {
    runState.recentActivity = runState.recentActivity.slice(-20);
  }

  safeWriteJson(runJsonPath, runState, context);

  // Serialize agent state to temp file as fallback for daemon restarts
  const sessionId = (input as Record<string, unknown>).session_id as string | undefined;
  let agentNote = "";
  if (sessionId && hasSessionAgents(sessionId)) {
    const agentState = serializeForSession(sessionId);
    const agentFilePath = path.join(getTempDir(), `agents-${sessionId}.json`);
    safeWriteJson(agentFilePath, agentState, context, false);
    const runningCount = agentState.agents.filter((a) => a.status === "running").length;
    const totalCount = agentState.agents.length;
    logDebug(`Serialized ${totalCount} agents (${runningCount} running) to ${agentFilePath}`, context);

    agentNote = `\n\n**CRITICAL — Agent State:** ${runningCount} of ${totalCount} agents were running at compaction time. Their state has been preserved and will be re-injected after compaction. Do NOT re-launch these agents or begin work that depends on their results.`;
  }

  // Return custom summary prompt to guide context compaction
  const summaryPrompt = `When summarizing this conversation for context preservation, include:

1. **Project Context**: What project/feature is being worked on and its current state
2. **Recent Accomplishments**: What was completed in this session (files changed, features added, bugs fixed)
3. **Current Focus**: What is actively being worked on right now
4. **Important Details**: Key decisions made, constraints discovered, file paths that matter
5. **Next Steps**: What needs to be done next, including any blockers

Ask yourself: "Will this detail matter when work resumes after compaction?"
- If yes → include it with specifics (file paths, function names, error messages)
- If no → omit it

Preserve MARVEL run context: Run ID ${runState.runId}, active packs: ${runState.activePacks?.join(", ") || "none"}, corrections: ${runState.correctionCount || 0}${agentNote}`;

  // PreCompact isn't in the SDK's hookEventName union yet, but Claude Code accepts additionalContext.
  return {
    hookSpecificOutput: {
      additionalContext: summaryPrompt,
    },
  } as SyncHookJSONOutput;
}