// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Build Order Rules
 *
 * Detects bare `pnpm build` commands that skip workspace dependency
 * compilation and warns agents to use `pnpm build:all` instead.
 */

export interface BuildOrderWarning {
  command: string;
  suggestion: string;
  message: string;
}

/**
 * Matches bare `pnpm build` or `pnpm run build` but NOT workspace-aware
 * variants like build:all, build:shared, build:web, build:backend,
 * cf:build, or --filter commands.
 */
const BARE_BUILD_PATTERN = /^pnpm\s+(run\s+)?build(\s|$)/;

/**
 * Check if a command is a bare build that skips workspace dependencies.
 * Returns a warning if the command only runs the root build without
 * compiling workspace dependencies first.
 */
export function checkBuildOrder(command: string): BuildOrderWarning | null {
  const trimmed = command.trim();

  if (!BARE_BUILD_PATTERN.test(trimmed)) {
    return null;
  }

  return {
    command: trimmed,
    suggestion: "pnpm build:all",
    message:
      "STOP: `pnpm build` only runs the root build — it does NOT compile workspace dependencies. " +
      "Use `pnpm build:all` to build all packages in topological order. " +
      "If you see module resolution errors for workspace packages, this is a build-order problem, not a code bug.",
  };
}