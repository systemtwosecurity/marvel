// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Learned Rules Module
 *
 * Manages dynamically learned security rules from user decisions.
 * Rules are learned when users approve commands that received "ask" decisions.
 *
 * Two layers:
 * 1. Session memory - In-memory cache for immediate session learning
 * 2. Persistent storage - Written to marvel/security/learned.jsonl for cross-session learning
 */

import * as fs from "fs";
import * as path from "path";
import type { ExternalRule } from "../types.js";
import { extractMeaningfulCommand, toProjectRelativePath } from "./command-parser.js";
import type { LogContext } from "./logger.js";
import { logDebug, logWarn } from "./logger.js";
import { getSecurityDir } from "./paths.js";
import { redactSensitive } from "./redact.js";

// Learned rule with additional metadata
export interface LearnedRule extends ExternalRule {
  learnedAt: string;
  approvedCommand: string;
  sessionId?: string;
}

// In-memory session cache
const sessionRules: LearnedRule[] = [];
let persistentRulesLoaded = false;
let persistentRules: LearnedRule[] = [];

/**
 * Get the path to the learned rules file.
 */
function getLearnedRulesPath(): string {
  return path.join(getSecurityDir(), "learned.jsonl");
}

/**
 * Load persistent learned rules from disk.
 * Only loads once per process.
 */
function loadPersistentRules(context?: LogContext): void {
  if (persistentRulesLoaded) return;
  persistentRulesLoaded = true;

  const rulesPath = getLearnedRulesPath();
  if (!fs.existsSync(rulesPath)) {
    logDebug("No learned rules file found", context);
    return;
  }

  try {
    const content = fs.readFileSync(rulesPath, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const rule = JSON.parse(line) as LearnedRule;
        if (rule.id && rule.pattern && rule.type) {
          persistentRules.push(rule);
        }
      } catch {
        // Skip invalid lines
      }
    }

    logDebug(`Loaded ${persistentRules.length} persistent learned rules`, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to load learned rules: ${message}`, context);
  }
}

/**
 * Get all learned rules (session + persistent).
 * Session rules take precedence (checked first).
 */
export function getLearnedRules(context?: LogContext): LearnedRule[] {
  loadPersistentRules(context);
  // Session rules first, then persistent (session rules are more recent)
  return [...sessionRules, ...persistentRules];
}

// Patterns that are too dangerous to learn (even with subcommands)
const DANGEROUS_BASE_COMMANDS = [
  "sudo",      // Elevated privileges - always require explicit approval
];

// Minimum pattern length to prevent overly broad rules
// 5 chars allows two-token subcommand patterns like "gh pr" which carry sufficient specificity
const MIN_PATTERN_LENGTH = 5;

// Patterns that are too broad as simple prefix patterns
// These need to include subcommands or arguments to be safe
const REQUIRES_SUBCOMMAND = new Set([
  "rm",        // File removal - need path context
  "curl",      // Network requests - need URL context
  "wget",      // Network requests - need URL context
  "chmod",     // Permission changes - need mode context
  "chown",     // Ownership changes - need owner context
  "dd",        // Disk operations - need full context
  "kill",      // Process termination - need PID context
  "pkill",     // Process termination - need name context
  "killall",   // Process termination - need name context
]);

// Destructive git subcommands that should never be auto-approved
const DANGEROUS_GIT_SUBCOMMANDS = new Set([
  "reset",     // Can discard commits/changes
  "clean",     // Deletes untracked files
  "push --force", // Can overwrite remote history
  "push -f",   // Short form of --force
  "checkout .", // Discards all working tree changes
  "restore .", // Discards all working tree changes
  "branch -D", // Force-delete a branch
  "stash drop", // Permanently remove stashed changes
]);

/**
 * Check if a pattern is safe to learn.
 * Rejects patterns that are too short, too dangerous, or not useful as learned rules.
 */
export function isPatternSafe(pattern: string, baseCommand: string): { safe: boolean; reason?: string } {
  // Check if base command is always dangerous
  if (DANGEROUS_BASE_COMMANDS.includes(baseCommand)) {
    return { safe: false, reason: `'${baseCommand}' commands require explicit approval` };
  }

  // Check minimum length
  if (pattern.length < MIN_PATTERN_LENGTH) {
    return { safe: false, reason: `Pattern too short (${pattern.length} chars, min ${MIN_PATTERN_LENGTH})` };
  }

  // Check if command requires subcommand but pattern is just the base command
  if (REQUIRES_SUBCOMMAND.has(baseCommand) && pattern === baseCommand) {
    return { safe: false, reason: `'${baseCommand}' requires more specific context to learn` };
  }

  // Check for dangerous git subcommands
  if (baseCommand === "git") {
    for (const dangerous of DANGEROUS_GIT_SUBCOMMANDS) {
      if (pattern === `git ${dangerous}` || pattern.startsWith(`git ${dangerous} `)) {
        return { safe: false, reason: `'git ${dangerous}' is destructive and requires explicit approval` };
      }
    }
  }

  // Filter out env var assignment patterns (VAR=value) — not reusable command patterns
  if (/^[A-Z][A-Z0-9_]+=/.test(pattern)) {
    return { safe: false, reason: "Environment variable assignments are not reusable command patterns" };
  }

  return { safe: true };
}

// Commands whose flags act as subcommands (the flag changes the command's meaning entirely)
const FLAG_SUBCOMMANDS: Record<string, Set<string>> = {
  node: new Set(["-e", "--eval", "-p", "--print"]),
  python: new Set(["-c", "-m"]),
  python3: new Set(["-c", "-m"]),
  ruby: new Set(["-e"]),
  perl: new Set(["-e"]),
};

// Commands with subcommands (git, docker, kubectl, npm, pnpm, etc.)
const SUBCOMMAND_PREFIXES = new Set([
  "git", "docker", "kubectl", "npm", "pnpm", "yarn", "cargo", "go",
  "pip", "uv", "brew", "apt", "dnf", "pacman", "systemctl", "journalctl",
  "claude", "uvx", "npx", "gh",
]);

/**
 * Extract a generalizable pattern from a command.
 * Uses heuristics to create a pattern that will match similar commands.
 *
 * For compound commands (`cd /path && npx drizzle-kit push`), extracts the
 * meaningful command first, then applies heuristics to that.
 */
export function extractPattern(command: string): { pattern: string; type: "prefix" | "regex" } {
  // Extract the meaningful command from compound commands
  const meaningful = extractMeaningfulCommand(command);
  const trimmed = meaningful ? meaningful.raw : command.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length === 0) {
    return { pattern: trimmed, type: "prefix" };
  }

  const baseCommand = parts[0];

  // Flag-subcommand awareness: `node -e "..."` → `node -e`
  const flagSubcmds = FLAG_SUBCOMMANDS[baseCommand];
  if (flagSubcmds && parts.length >= 2 && flagSubcmds.has(parts[1])) {
    return { pattern: `${baseCommand} ${parts[1]}`, type: "prefix" };
  }

  // Subcommand prefixes: `npx drizzle-kit` → `npx drizzle-kit`
  if (SUBCOMMAND_PREFIXES.has(baseCommand) && parts.length >= 2) {
    const prefix = `${parts[0]} ${parts[1]}`;
    return { pattern: prefix, type: "prefix" };
  }

  // Path-aware pattern extraction — when a command includes a path argument,
  // learn the "command path-prefix" pattern instead of just the base command.
  // e.g., "cat backend/src/lib/db.ts" → "cat backend/" prefix
  // Also handle absolute paths by converting to project-relative first.
  if (parts.length >= 2) {
    let arg = parts[1];

    // Convert absolute paths to project-relative
    if (arg.startsWith("/")) {
      const relative = toProjectRelativePath(arg);
      if (relative !== arg) {
        arg = relative;
      }
    }

    const pathPrefixMatch = arg.match(/^([a-zA-Z][a-zA-Z0-9._-]*\/)/);
    if (pathPrefixMatch) {
      const prefix = `${baseCommand} ${pathPrefixMatch[1]}`;
      if (prefix.length >= MIN_PATTERN_LENGTH) {
        return { pattern: prefix, type: "prefix" };
      }
    }
  }

  // For other commands, use just the base command as prefix
  // This is intentionally broad - if user approved "make build", we allow all "make" commands
  return { pattern: baseCommand, type: "prefix" };
}

/**
 * Add a learned rule from a user-approved command.
 * Adds to both session memory and persistent storage.
 * Returns null if the pattern is deemed unsafe to learn.
 */
export function addLearnedRule(
  command: string,
  context?: LogContext,
  suggestedRule?: { type: string; pattern: string; reason: string }
): LearnedRule | null {
  let pattern: string;
  let type: "prefix" | "regex";

  if (suggestedRule?.pattern) {
    // Use LLM-suggested pattern (still validated through isPatternSafe below)
    pattern = suggestedRule.pattern;
    type = suggestedRule.type === "regex" ? "regex" : "prefix";
    logDebug(`Using LLM-suggested pattern: "${pattern}" (type: ${type})`, context);
  } else {
    const extracted = extractPattern(command);
    pattern = extracted.pattern;
    type = extracted.type;
  }

  // Extract base command from the meaningful command (not the raw compound)
  const meaningful = extractMeaningfulCommand(command);
  const baseCommand = meaningful ? meaningful.executable : command.trim().split(/\s+/)[0];

  // Validate pattern safety
  const safetyCheck = isPatternSafe(pattern, baseCommand);
  if (!safetyCheck.safe) {
    logWarn(`Rejected learned rule: ${safetyCheck.reason} (command: ${command.slice(0, 50)}...)`, context);
    return null;
  }

  const id = `learned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const rule: LearnedRule = {
    id,
    type,
    pattern,
    reason: redactSensitive(`User approved: ${command.slice(0, 80)}...`),
    learnedAt: new Date().toISOString(),
    approvedCommand: redactSensitive(command),
    sessionId: process.env.CLAUDE_SESSION_ID,
  };

  // Add to session memory immediately
  sessionRules.push(rule);
  logDebug(`Added session learned rule: ${rule.id} (pattern: ${pattern})`, context);

  // Persist to disk
  const rulesPath = getLearnedRulesPath();
  const dir = path.dirname(rulesPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.appendFileSync(rulesPath, JSON.stringify(rule) + "\n", { mode: 0o600 });
    logDebug("Persisted learned rule to disk", context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to persist learned rule: ${message}`, context);
  }

  return rule;
}

/**
 * Check if a regex pattern is safe to compile.
 * Since extractPattern() only ever returns type: "prefix", regex patterns
 * only enter via tampered learned.jsonl. Reject all regex metacharacters
 * so regex rules degrade to literal substring matches.
 */
export function isSafeRegexPattern(pattern: unknown): boolean {
  if (typeof pattern !== "string") return false;
  if (pattern.length === 0 || pattern.length > 512) return false;
  // Reject any regex metacharacters — learned rules should be plain literals
  if (/[.^$*+?()[\]{}|\\]/.test(pattern)) return false;
  return true;
}

/**
 * Test a single command string against a rule.
 */
function testAgainstRule(command: string, rule: LearnedRule): boolean {
  switch (rule.type) {
    case "prefix":
      return command.startsWith(rule.pattern);

    case "contains":
      return command.includes(rule.pattern);

    case "regex":
      if (!isSafeRegexPattern(rule.pattern)) return false;
      try {
        return new RegExp(rule.pattern).test(command);
      } catch {
        return false;
      }

    default:
      return false;
  }
}

/**
 * Check if a command matches any learned rule.
 * Tests against both the full raw command and the extracted meaningful command.
 * Returns the matching rule if found, null otherwise.
 */
export function matchesLearnedRules(
  command: string,
  context?: LogContext
): LearnedRule | null {
  const rules = getLearnedRules(context);
  const trimmed = command.trim();

  // Also extract the meaningful command for compound commands
  const meaningful = extractMeaningfulCommand(command);
  const meaningfulRaw = meaningful?.raw;

  for (const rule of rules) {
    if (rule.type === "regex" && !isSafeRegexPattern(rule.pattern)) {
      logWarn(`Skipping unsafe regex pattern in learned rule: ${rule.id}`, context);
      continue;
    }

    // Test against full raw command first
    if (testAgainstRule(trimmed, rule)) {
      logDebug(`Command matches learned rule: ${rule.id}`, context);
      return rule;
    }

    // Test against meaningful command (for compound commands like "cd /path && npx ...")
    if (meaningfulRaw && meaningfulRaw !== trimmed && testAgainstRule(meaningfulRaw, rule)) {
      logDebug(`Meaningful command matches learned rule: ${rule.id} (from: ${trimmed.slice(0, 60)})`, context);
      return rule;
    }
  }

  return null;
}

/**
 * Get count of learned rules (for debugging/stats).
 */
export function getLearnedRulesCount(context?: LogContext): { session: number; persistent: number } {
  loadPersistentRules(context);
  return {
    session: sessionRules.length,
    persistent: persistentRules.length,
  };
}

/**
 * Clear session rules (useful for testing).
 */
export function clearSessionRules(): void {
  sessionRules.length = 0;
}