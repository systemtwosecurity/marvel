// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * MARVEL Status Compiler
 *
 * Compiles session status for the "marvel status" command.
 * Returns HookOutput with additionalContext wrapped in <marvel-status> XML.
 */

import * as fs from "fs";
import * as path from "path";
import type { SyncHookJSONOutput, UserPromptSubmitHookSpecificOutput } from "../sdk-types.js";
import type { RunState } from "../types.js";
import type { LogContext } from "./logger.js";
import { findRunDir, getTempDir } from "./paths.js";
import { safeReadJson } from "./file-ops.js";
import { VALID_HOOK_EVENTS } from "../schema/settings-types.js";

interface SettingsJson {
  hooks?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}

function formatDuration(startedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  const nowMs = Date.now();
  const diffSec = Math.floor((nowMs - startMs) / 1000);

  if (diffSec < 0) return "0s";

  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function checkDaemonHealth(daemonId: string | undefined): string {
  if (!daemonId) return "unknown (no daemon ID)";

  const tempDir = getTempDir();
  const pidPath = `${tempDir}/p-${daemonId}.pid`;
  const socketPath = `${tempDir}/p-${daemonId}.sock`;

  const pidExists = fs.existsSync(pidPath);
  const socketExists = fs.existsSync(socketPath);

  if (pidExists && socketExists) {
    try {
      const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
      process.kill(pid, 0);
      return `running (pid: ${pid})`;
    } catch {
      return "stale (process not found)";
    }
  }

  if (pidExists) return "degraded (socket missing)";
  if (socketExists) return "degraded (pid file missing)";
  return "not running";
}

function getConfiguredHooks(): { configured: string[]; missing: string[] } {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) {
    return { configured: [], missing: [...VALID_HOOK_EVENTS] };
  }

  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  const settings = safeReadJson<SettingsJson>(settingsPath, { hookType: "marvel-status" });

  if (!settings?.hooks) {
    return { configured: [], missing: [...VALID_HOOK_EVENTS] };
  }

  const configured = Object.keys(settings.hooks);
  const missing = VALID_HOOK_EVENTS.filter((e) => !configured.includes(e));
  return { configured, missing };
}

export function compileMarvelStatus(context: LogContext): SyncHookJSONOutput {
  try {
    const runDir = findRunDir();
    const daemonId = process.env.MARVEL_DAEMON_ID;

    const lines: string[] = [];
    lines.push("MARVEL Session Status");
    lines.push("─".repeat(40));

    if (runDir) {
      const runState = safeReadJson<RunState>(
        path.join(runDir, "run.json"),
        context
      );

      if (runState) {
        lines.push(`Run ID: ${runState.runId}`);
        lines.push(`Started: ${runState.startedAt}`);
        lines.push(`Duration: ${formatDuration(runState.startedAt)}`);
        lines.push(`Active packs: ${runState.activePacks?.length ?? 0}`);
        if (runState.activePacks?.length) {
          for (const pack of runState.activePacks) {
            lines.push(`  - ${pack}`);
          }
        }
        lines.push(`Tool calls: ${runState.toolCallCount ?? 0}`);
        lines.push(`Corrections: ${runState.correctionCount ?? 0}`);

        if (runState.pendingLessons) {
          lines.push(`Pending lessons: ${runState.pendingLessons}`);
        }

        // Hot packs (most injected this session)
        if (runState.packInjectionCounts) {
          const packCounts = Object.entries(runState.packInjectionCounts)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 5);
          if (packCounts.length > 0) {
            lines.push("");
            lines.push("Hot packs:");
            for (const [pack, count] of packCounts) {
              lines.push(`  ${pack}: ${count} injections`);
            }
          }
        }

        if (runState.recentActivity?.length) {
          lines.push("");
          lines.push(`Recent activity: ${runState.recentActivity.length} events`);
          const last5 = runState.recentActivity.slice(-5);
          for (const event of last5) {
            lines.push(`  - [${event.type}] ${event.timestamp}`);
          }
        }
      } else {
        lines.push("Run state: not found");
      }
    } else {
      lines.push("Run directory: not found");
    }

    lines.push("");
    lines.push(`Daemon: ${checkDaemonHealth(daemonId)}`);

    const { configured, missing } = getConfiguredHooks();
    lines.push(`Hooks configured: ${configured.length}/${VALID_HOOK_EVENTS.length}`);
    if (missing.length > 0) {
      lines.push(`Missing hooks: ${missing.join(", ")}`);
    }

    const statusText = `<marvel-status>\n${lines.join("\n")}\n</marvel-status>`;
    const hookSpecificOutput: UserPromptSubmitHookSpecificOutput = {
      hookEventName: "UserPromptSubmit",
      additionalContext: statusText,
    };
    return { hookSpecificOutput };
  } catch {
    return {};
  }
}