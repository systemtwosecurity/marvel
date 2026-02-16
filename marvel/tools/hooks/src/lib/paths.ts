// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Path Utilities
 *
 * Helpers for finding MARVEL directories.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Find the MARVEL root directory by walking up from cwd.
 */
export function findMarvelRoot(): string | null {
  // Check environment variable first
  const envRoot = process.env.MARVEL_ROOT;
  if (envRoot && fs.existsSync(path.join(envRoot, "packs"))) {
    return envRoot;
  }

  // Walk up from project directory or cwd
  let current = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    const marvelPath = path.join(current, "marvel");
    if (fs.existsSync(path.join(marvelPath, "packs"))) {
      return marvelPath;
    }
    current = path.dirname(current);
  }

  return null;
}

/**
 * Find the current run directory.
 */
export function findRunDir(): string | null {
  // Check environment variable first
  const envDir = process.env.MARVEL_RUN_DIR;
  if (envDir && fs.existsSync(envDir)) {
    return envDir;
  }

  // Find marvel root and look for most recent run
  const marvelRoot = findMarvelRoot();
  if (!marvelRoot) {
    return null;
  }

  const runsDir = path.join(marvelRoot, "runs");
  if (!fs.existsSync(runsDir)) {
    return null;
  }

  // Find most recent run directory
  const runs = fs
    .readdirSync(runsDir)
    .filter((name) => name.startsWith("run_"))
    .sort()
    .reverse();

  if (runs.length === 0) {
    return null;
  }

  return path.join(runsDir, runs[0]);
}

/**
 * Get the MARVEL security directory path.
 * Always returns a path (may not exist on disk yet).
 */
export function getSecurityDir(): string {
  const marvelRoot = findMarvelRoot();
  if (marvelRoot) {
    return path.join(marvelRoot, "security");
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectDir, "marvel", "security");
}

/**
 * Find the MARVEL security directory if it exists on disk.
 */
export function findSecurityDir(): string | null {
  const dir = getSecurityDir();
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Get a secure, per-user temp directory for MARVEL hooks.
 * Created with mode 0o700 (owner-only access).
 */
export function getTempDir(): string {
  const uid = process.getuid?.() ?? "nouid";
  // Short dir name keeps full socket paths well under the macOS sun_path
  // limit of 104 bytes (old "marvel-hooks-{uid}" pushed paths to 104+ chars).
  const baseDir = path.join(os.tmpdir(), `mhd-${uid}`);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(baseDir, 0o700);
    } catch {
      // Best-effort
    }
  }
  return baseDir;
}