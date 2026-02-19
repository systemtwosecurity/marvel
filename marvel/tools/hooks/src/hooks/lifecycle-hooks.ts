// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Lifecycle Hooks
 *
 * Lightweight handlers for subagent, notification, teammate, and task events.
 * Each logs the event to recentActivity in run.json.
 */

import * as path from "path";
import type {
  SubagentStartHookInput,
  SubagentStopHookInput,
  NotificationHookInput,
  TeammateIdleHookInput,
  TaskCompletedHookInput,
  SyncHookJSONOutput,
} from "../sdk-types.js";
import type { RunState, ActivityEventType } from "../types.js";
import { findRunDir } from "../lib/paths.js";
import { safeReadJson, safeWriteJson } from "../lib/file-ops.js";
import { logDebug, buildHookContext, type LogContext } from "../lib/logger.js";
import { registerAgent, completeAgent, trackTeammate } from "../lib/agent-registry.js";

function logActivity(
  activityType: ActivityEventType,
  data: Record<string, unknown>,
  context: LogContext
): void {
  const runDir = findRunDir();
  if (!runDir) {
    logDebug(`Run directory not found, skipping ${activityType}`, context);
    return;
  }

  const runJsonPath = path.join(runDir, "run.json");
  const runState = safeReadJson<RunState>(runJsonPath, context);
  if (!runState) {
    logDebug(`Run state not found, skipping ${activityType}`, context);
    return;
  }

  runState.recentActivity = runState.recentActivity || [];
  runState.recentActivity.push({
    type: activityType,
    timestamp: new Date().toISOString(),
    data,
  });

  if (runState.recentActivity.length > 20) {
    runState.recentActivity = runState.recentActivity.slice(-20);
  }

  safeWriteJson(runJsonPath, runState, context);
}

export async function handleSubagentStart(input: SubagentStartHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("subagent-start", input);
  logActivity("subagent_start", { agent_id: input.agent_id, agent_type: input.agent_type }, context);
  registerAgent(input.session_id, input.agent_id, input.agent_type, context);
  return {};
}

export async function handleSubagentStop(input: SubagentStopHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("subagent-stop", input);
  logActivity("subagent_stop", { agent_id: input.agent_id, agent_transcript_path: input.agent_transcript_path }, context);
  completeAgent(input.session_id, input.agent_id, input.agent_transcript_path, context);
  return {};
}

export async function handleNotification(input: NotificationHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("notification", input);
  logActivity("notification", { message: input.message, title: input.title, notification_type: input.notification_type }, context);
  return {};
}

export async function handleTeammateIdle(input: TeammateIdleHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("teammate-idle", input);
  logActivity("teammate_idle", { teammate_name: input.teammate_name, team_name: input.team_name }, context);
  trackTeammate(input.session_id, input.teammate_name, input.team_name, context);
  return {};
}

export async function handleTaskCompleted(input: TaskCompletedHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("task-completed", input);
  logActivity("task_completed", { task_id: input.task_id, task_subject: input.task_subject }, context);
  return {};
}