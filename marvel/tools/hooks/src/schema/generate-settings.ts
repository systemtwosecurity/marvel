// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Claude Code Settings Generator
 *
 * Generates .claude/settings.json with proper hook configuration.
 * Uses the unified marvel-hook.sh entry point which:
 *   - Starts daemon on SessionStart
 *   - Uses daemon for fast hooks (~5ms)
 *   - Falls back with warnings if daemon unavailable
 *   - Stops daemon on SessionEnd
 *
 * Usage:
 *   node dist/schema/generate-settings.js > ../../.claude/settings.json
 *   node dist/schema/generate-settings.js --write
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ClaudeSettings, CommandHookHandler, MatcherGroup } from "./settings-types.js";

// Use $CLAUDE_PROJECT_DIR for working directory independence
const PROJECT_DIR = '"$CLAUDE_PROJECT_DIR"';

// Unified entry point - handles daemon lifecycle automatically
const HOOK_SCRIPT = `${PROJECT_DIR}/marvel/tools/hooks/scripts/marvel-hook.sh`;

function commandHook(hookType: string, timeout?: number): CommandHookHandler {
  const hook: CommandHookHandler = {
    type: "command",
    command: `${HOOK_SCRIPT} ${hookType}`,
  };
  if (timeout !== undefined) {
    hook.timeout = timeout;
  }
  return hook;
}

function matcherGroup(hooks: CommandHookHandler[], matcher?: string): MatcherGroup {
  return matcher ? { matcher, hooks } : { hooks };
}

/**
 * Settings configuration
 *
 * All hooks use the unified marvel-hook.sh entry point.
 * The script handles daemon lifecycle automatically:
 *   - SessionStart: starts daemon for this session
 *   - Other hooks: uses daemon, warns on fallback
 *   - SessionEnd: stops daemon
 */
export const settings: ClaudeSettings = {
  hooks: {
    // Starts daemon, initializes session
    SessionStart: [
      matcherGroup([commandHook("session-start")]),
    ],

    // Inject lessons before file operations; security gate for Bash
    PreToolUse: [
      matcherGroup(
        [commandHook("pre-tool-use", 90)],
        "Bash|Edit|Write|Read"
      ),
    ],

    // Capture corrections and handle "marvel status"
    UserPromptSubmit: [
      matcherGroup([commandHook("user-prompt-submit")]),
    ],

    // Record tool calls to trace
    PostToolUse: [
      matcherGroup(
        [commandHook("post-tool-use")],
        "Edit|Write|Bash|Read|Grep|Glob"
      ),
    ],

    // Track failed tool calls
    PostToolUseFailure: [
      matcherGroup(
        [commandHook("post-tool-use-failure")],
        "Edit|Write|Bash"
      ),
    ],

    // Security gate for permission requests
    PermissionRequest: [
      matcherGroup(
        [commandHook("permission-request", 90)],
        "Bash"
      ),
    ],

    // Snapshot state before context compaction
    PreCompact: [
      matcherGroup([commandHook("pre-compact")]),
    ],

    // Reflection at end of turn
    Stop: [
      matcherGroup([commandHook("stop")]),
    ],

    // Track subagent lifecycle
    SubagentStart: [
      matcherGroup([commandHook("subagent-start")]),
    ],
    SubagentStop: [
      matcherGroup([commandHook("subagent-stop")]),
    ],

    // Track notifications
    Notification: [
      matcherGroup([commandHook("notification")]),
    ],

    // Track teammate idle events
    TeammateIdle: [
      matcherGroup([commandHook("teammate-idle")]),
    ],

    // Track task completions
    TaskCompleted: [
      matcherGroup([commandHook("task-completed")]),
    ],

    // Stop daemon on session end
    SessionEnd: [
      matcherGroup([commandHook("session-end")]),
    ],
  },
};

function findProjectRoot(startDir: string): string | null {
  let current = startDir;
  const root = path.parse(current).root;

  while (current !== root) {
    if (fs.existsSync(path.join(current, ".claude"))) {
      return current;
    }
    current = path.dirname(current);
  }

  return null;
}

function generateSettings(): string {
  return JSON.stringify(settings, null, 2);
}

function main(): void {
  const args = process.argv.slice(2);
  const writeFlag = args.includes("--write") || args.includes("-w");

  const json = generateSettings();

  if (writeFlag) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = findProjectRoot(process.cwd()) || findProjectRoot(__dirname);

    if (!projectRoot) {
      console.error("Error: Could not find project root (no .claude directory found)");
      process.exit(1);
    }

    const settingsPath = path.join(projectRoot, ".claude", "settings.json");
    const claudeDir = path.dirname(settingsPath);

    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Read-merge-write: preserve existing settings, only update the hooks key
    const generated = JSON.parse(json) as Record<string, unknown>;
    let merged = generated;

    if (fs.existsSync(settingsPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
        merged = { ...existing, hooks: generated.hooks };
      } catch {
        // Existing file is corrupted — back it up before overwriting
        const backupPath = settingsPath + `.backup-${Date.now()}`;
        try {
          fs.copyFileSync(settingsPath, backupPath);
          console.error(`Backed up corrupted settings to: ${backupPath}`);
        } catch {
          // Best-effort backup
        }
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
    console.error(`Written to: ${settingsPath}`);
  } else {
    console.log(json);
  }
}

main();