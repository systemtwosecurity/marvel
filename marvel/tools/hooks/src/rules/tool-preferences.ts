// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Tool Preferences
 *
 * Rules for preferred tools/commands.
 * When a non-preferred tool is detected, a warning is injected.
 */

export interface ToolPreference {
  pattern: RegExp;
  suggestion: string;
  message: string;
}

export const TOOL_PREFERENCES: ToolPreference[] = [
  {
    pattern: /^npx\s+/,
    suggestion: "pnpm dlx",
    message: "Use 'pnpm dlx' instead of 'npx' (project uses pnpm)",
  },
  {
    pattern: /^npm\s+(install|i|add|remove|uninstall)\b/,
    suggestion: "pnpm",
    message: "Use 'pnpm' instead of 'npm' for package operations",
  },
  {
    pattern: /^npm\s+run\b/,
    suggestion: "pnpm run",
    message: "Use 'pnpm run' instead of 'npm run'",
  },
  {
    pattern: /^yarn\s+(add|install|remove)\b/,
    suggestion: "pnpm",
    message: "Use 'pnpm' instead of 'yarn' for package operations",
  },
  {
    pattern: /^python\s/,
    suggestion: "uv run python",
    message: "Use 'uv run python' instead of 'python' directly",
  },
  {
    pattern: /^python3\s/,
    suggestion: "uv run python",
    message: "Use 'uv run python' instead of 'python3' directly",
  },
  {
    pattern: /^pip\s/,
    suggestion: "uv pip",
    message: "Use 'uv pip' instead of 'pip' directly",
  },
  {
    pattern: /^pip3\s/,
    suggestion: "uv pip",
    message: "Use 'uv pip' instead of 'pip3' directly",
  },
];

/**
 * Check if a command uses a non-preferred tool.
 * Returns the matching preference if found, null otherwise.
 */
export function checkToolPreference(command: string): ToolPreference | null {
  const trimmed = command.trim();
  for (const pref of TOOL_PREFERENCES) {
    if (pref.pattern.test(trimmed)) {
      return pref;
    }
  }
  return null;
}