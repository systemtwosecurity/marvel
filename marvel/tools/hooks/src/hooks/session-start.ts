// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * SessionStart Hook
 *
 * Initializes run directory and loads packs at session start.
 */

import * as fs from "fs";
import * as path from "path";
import type { SessionStartHookInput, SyncHookJSONOutput, SessionStartHookSpecificOutput } from "../sdk-types.js";
import type { RunState } from "../types.js";
import { loadAllPacks } from "../loaders/pack-loader.js";
import { findMarvelRoot, getTempDir } from "../lib/paths.js";
import { safeMkdir, safeWriteJson } from "../lib/file-ops.js";
import { logDebug, logWarn, buildHookContext } from "../lib/logger.js";
import { isEvalEnabled } from "../lib/agent-evaluator.js";

function generateRunId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timePart = now.toISOString().slice(11, 19).replace(/:/g, "");
  return `run_${datePart}_${timePart}`;
}

export async function handleSessionStart(
  input: SessionStartHookInput
): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("session-start", input);
  const marvelRoot = findMarvelRoot();
  if (!marvelRoot) {
    logDebug("MARVEL root not found, skipping session start", context);
    return {};
  }

  const runId = generateRunId();
  const runsDir = path.join(marvelRoot, "runs");
  const runDir = path.join(runsDir, runId);

  // Create run directory
  if (!safeMkdir(runDir, context)) {
    return {};
  }

  // Load packs
  const packs = await loadAllPacks(marvelRoot);
  const packNames = packs.map((p) => p.metadata.name);

  // Initialize run state
  const runState: RunState = {
    runId,
    startedAt: new Date().toISOString(),
    activePacks: packNames,
    toolCallCount: 0,
    correctionCount: 0,
    recentActivity: [],
  };

  // Write run.json
  const runJsonPath = path.join(runDir, "run.json");
  if (!safeWriteJson(runJsonPath, runState, context)) {
    return {};
  }

  // Set environment variable for other hooks
  process.env.MARVEL_RUN_ID = runId;
  process.env.MARVEL_RUN_DIR = runDir;

  // Health diagnostics
  const sessionId = process.env.CLAUDE_SESSION_ID;
  const healthLines: string[] = [];

  if (!sessionId || sessionId === "unknown") {
    healthLines.push(
      "WARNING: Session ID not set — pre-commit tracking will use shared state.",
    );
    logWarn("CLAUDE_SESSION_ID is not set — session state will use shared 'unknown' file", context);
  }

  // Check for stale daemon files
  try {
    const tempDir = getTempDir();
    const files = fs.readdirSync(tempDir).filter((f) => f.startsWith("p-") || f.startsWith("session-"));
    const staleCount = files.filter((f) => f.endsWith(".pid")).length;
    if (staleCount > 10) {
      healthLines.push(`WARNING: ${staleCount} daemon PID files in temp dir — consider running cleanup.`);
      logWarn(`${staleCount} daemon PID files in temp dir — consider running cleanup`, context);
    }
    logDebug(`Hook health: session=${sessionId ?? "unset"}, tempFiles=${files.length}, pidFiles=${staleCount}`, context);
  } catch {
    // Non-fatal — don't block session start for diagnostics
  }

  // Check security evaluator health
  const evalStatus = isEvalEnabled();
  if (!evalStatus.enabled) {
    healthLines.push(
      `WARNING: Security LLM evaluator is disabled — unknown commands will require manual confirmation. ${evalStatus.reason}`,
    );
    logWarn(`Security evaluator disabled: ${evalStatus.reason}`, context);
  } else {
    logDebug("Security evaluator enabled", context);
  }

  // Build context message
  const packList = packNames.map((n) => `- ${n}`).join("\n");
  const healthSection = healthLines.length > 0
    ? healthLines.join("\n") + "\n"
    : "";
  const contextMessage = `${healthSection}MARVEL session started: ${runId}\nActive packs:\n${packList}`;

  logDebug("Session started successfully", { ...context, runId });

  const hookSpecificOutput: SessionStartHookSpecificOutput = {
    hookEventName: "SessionStart",
    additionalContext: contextMessage,
  };
  return { hookSpecificOutput };
}