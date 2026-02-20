// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * External Rules Loader
 *
 * Loads allowlist/denylist rules from marvel/security/ directory.
 * Falls back to hardcoded defaults if files are missing.
 */

import * as fs from "fs";
import * as path from "path";
import type { ExternalRule, RuleFile } from "../types.js";
import { getAllSegments } from "./command-parser.js";
import type { LogContext } from "./logger.js";
import { logDebug, logWarn } from "./logger.js";
import { findSecurityDir } from "./paths.js";

// Hardcoded fallback rules if external files are missing
const DEFAULT_ALLOW_RULES: ExternalRule[] = [
  { id: "allow-git-status", type: "prefix", pattern: "git status", reason: "Read-only git operation" },
  { id: "allow-git-diff", type: "prefix", pattern: "git diff", reason: "Read-only git operation" },
  { id: "allow-git-log", type: "prefix", pattern: "git log", reason: "Read-only git operation" },
  { id: "allow-git-branch", type: "prefix", pattern: "git branch", reason: "Read-only git operation" },
  { id: "allow-git-show", type: "prefix", pattern: "git show", reason: "Read-only git operation" },
  { id: "allow-pnpm-safe", type: "regex", pattern: "^pnpm\\s+(install|dev|build|lint|test|run|typecheck)\\b", reason: "Safe pnpm dev operations" },
  { id: "allow-npm-safe", type: "regex", pattern: "^npm\\s+(run|test|start)\\b", reason: "Safe npm dev operations" },
  { id: "allow-ls", type: "prefix", pattern: "ls", reason: "Read-only directory listing" },
  { id: "allow-pwd", type: "prefix", pattern: "pwd", reason: "Print working directory" },
  { id: "allow-echo", type: "prefix", pattern: "echo ", reason: "Print to stdout" },
  { id: "allow-which", type: "prefix", pattern: "which ", reason: "Locate command" },
  { id: "allow-cat", type: "prefix", pattern: "cat ", reason: "Read file contents" },
  { id: "allow-head", type: "prefix", pattern: "head ", reason: "Read file head" },
  { id: "allow-tail", type: "prefix", pattern: "tail ", reason: "Read file tail" },
  { id: "allow-wc", type: "prefix", pattern: "wc ", reason: "Word count" },
];

const DEFAULT_DENY_RULES: ExternalRule[] = [
  // Package manager enforcement - use pnpm/uv instead
  { id: "deny-npx", type: "prefix", pattern: "npx ", reason: "Project uses pnpm - use 'pnpm exec' or 'pnpm dlx' instead of npx" },
  { id: "deny-npm-install", type: "regex", pattern: "^npm\\s+(install|i|add|ci)\\b", reason: "Project uses pnpm - use 'pnpm install' or 'pnpm add' instead" },
  { id: "deny-yarn", type: "regex", pattern: "^yarn\\s+(install|add)\\b", reason: "Project uses pnpm - use 'pnpm install' or 'pnpm add' instead" },

  // Python environment enforcement - use uv per CLAUDE.md
  { id: "deny-python-direct", type: "regex", pattern: "^python3?\\s", reason: "Use 'uv run python' per CLAUDE.md" },
  { id: "deny-pip-direct", type: "regex", pattern: "^pip3?\\s", reason: "Use 'uv pip' per CLAUDE.md" },

  // rm - destructive file removal
  // Use (?:\s+\S+)*\s+ instead of .*\s+ to prevent ReDoS from overlapping quantifiers
  { id: "deny-rm-rf-root", type: "regex", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|\\-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\\s+/(?!Users|home|tmp)", reason: "Destructive: removes root filesystem paths" },
  { id: "deny-rm-rf-slash", type: "regex", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/\\s*$", reason: "Destructive: removes root filesystem" },
  { id: "deny-rm-rf-home", type: "regex", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+~/?\\s*$", reason: "Destructive: removes entire home directory" },
  { id: "deny-rm-rf-star", type: "regex", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/\\*", reason: "Destructive: removes all root level directories" },
  { id: "deny-rm-system-dirs", type: "regex", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/(etc|var|usr|bin|sbin|lib|boot|sys|proc)\\b", reason: "Destructive: removes system directories" },
  { id: "deny-rm-no-preserve-root", type: "contains", pattern: "--no-preserve-root", reason: "Destructive: bypasses rm safety" },

  // chmod - dangerous permission changes
  // Use -[a-zA-Z]+ (not *) inside ()* to prevent nested zero-length match (exponential ReDoS)
  { id: "deny-chmod-777", type: "regex", pattern: "chmod\\s+(-[a-zA-Z]+\\s+)*777", reason: "Insecure permissions: world-writable" },
  { id: "deny-chmod-666", type: "regex", pattern: "chmod\\s+(-[a-zA-Z]+\\s+)*666", reason: "Insecure permissions: world-writable files" },
  { id: "deny-chmod-recursive-system", type: "regex", pattern: "chmod\\s+(-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/(etc|var|usr|bin|sbin|lib)", reason: "Destructive: recursive chmod on system dirs" },

  // chown - dangerous ownership changes
  { id: "deny-chown-recursive-system", type: "regex", pattern: "chown\\s+(-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/(etc|var|usr|bin|sbin|lib)", reason: "Destructive: recursive chown on system dirs" },
  { id: "deny-chown-root", type: "regex", pattern: "chown\\s+(-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/\\s*$", reason: "Destructive: chown on root" },

  // Remote code execution
  // Use [^|]* instead of .* before pipe to prevent backtracking
  { id: "deny-curl-pipe-bash", type: "regex", pattern: "curl[^|]*\\|\\s*(bash|sh|zsh|python|perl|ruby)", reason: "Remote code execution via curl pipe" },
  { id: "deny-wget-pipe-bash", type: "regex", pattern: "wget[^|]*\\|\\s*(bash|sh|zsh|python|perl|ruby)", reason: "Remote code execution via wget pipe" },
  { id: "deny-curl-pipe-sudo", type: "regex", pattern: "curl[^|]*\\|\\s*sudo", reason: "Remote code execution with elevated privileges" },

  // Disk/filesystem operations
  { id: "deny-dd-of-dev", type: "regex", pattern: "dd\\s+[^ ]*of=/dev/", reason: "Destructive: writes to device" },
  { id: "deny-mkfs", type: "prefix", pattern: "mkfs", reason: "Destructive: formats filesystem" },
  { id: "deny-format", type: "prefix", pattern: "format ", reason: "Destructive: formats disk" },
  { id: "deny-fdisk", type: "prefix", pattern: "fdisk", reason: "Destructive: disk partitioning" },
  { id: "deny-parted", type: "prefix", pattern: "parted", reason: "Destructive: disk partitioning" },

  // System control
  { id: "deny-shutdown", type: "prefix", pattern: "shutdown", reason: "System shutdown" },
  { id: "deny-reboot", type: "prefix", pattern: "reboot", reason: "System reboot" },
  { id: "deny-init-0", type: "contains", pattern: "init 0", reason: "System shutdown" },
  { id: "deny-init-6", type: "contains", pattern: "init 6", reason: "System reboot" },
  { id: "deny-systemctl-disable", type: "regex", pattern: "systemctl\\s+(disable|mask)\\s+(sshd|networking|network|firewalld|iptables)", reason: "Disabling critical services" },

  // sudo with dangerous commands (catch-all for above with sudo prefix)
  { id: "deny-sudo-rm-rf", type: "regex", pattern: "sudo\\s+rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)", reason: "Elevated destructive file removal" },
];

/**
 * Load rules from an external JSON file.
 */
function loadRulesFromFile(filePath: string, context: LogContext): ExternalRule[] | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as RuleFile;

    if (!parsed.rules || !Array.isArray(parsed.rules)) {
      logWarn(`Invalid rule file format: ${filePath}`, context);
      return null;
    }

    // Validate rules
    const validRules = parsed.rules.filter((rule) => {
      if (!rule.id || !rule.type || !rule.pattern || !rule.reason) {
        logWarn(`Invalid rule missing required fields: ${JSON.stringify(rule)}`, context);
        return false;
      }
      if (!["regex", "prefix", "contains"].includes(rule.type)) {
        logWarn(`Invalid rule type "${rule.type}" for rule ${rule.id}`, context);
        return false;
      }
      return true;
    });

    logDebug(`Loaded ${validRules.length} rules from ${filePath}`, context);
    return validRules;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to load rules from ${filePath}: ${message}`, context);
    return null;
  }
}

/**
 * Load allowlist rules.
 * Returns external rules if available, otherwise hardcoded defaults.
 */
export function loadAllowRules(context: LogContext): ExternalRule[] {
  const securityDir = findSecurityDir();
  if (securityDir) {
    const allowlistPath = path.join(securityDir, "allowlist.json");
    const externalRules = loadRulesFromFile(allowlistPath, context);
    if (externalRules !== null) {
      return externalRules;
    }
  }

  logDebug("Using default allowlist rules", context);
  return DEFAULT_ALLOW_RULES;
}

/**
 * Load denylist rules.
 * Returns external rules if available, otherwise hardcoded defaults.
 */
export function loadDenyRules(context: LogContext): ExternalRule[] {
  const securityDir = findSecurityDir();
  if (securityDir) {
    const denylistPath = path.join(securityDir, "denylist.json");
    const externalRules = loadRulesFromFile(denylistPath, context);
    if (externalRules !== null) {
      return externalRules;
    }
  }

  logDebug("Using default denylist rules", context);
  return DEFAULT_DENY_RULES;
}

/**
 * Check if a command matches a single rule.
 */
function matchesRule(command: string, rule: ExternalRule): boolean {
  const trimmed = command.trim();

  switch (rule.type) {
    case "prefix":
      return trimmed.startsWith(rule.pattern);

    case "contains":
      return trimmed.includes(rule.pattern);

    case "regex":
      try {
        const regex = new RegExp(rule.pattern);
        return regex.test(trimmed);
      } catch {
        // Invalid regex, treat as no match
        return false;
      }

    default:
      return false;
  }
}

/**
 * Normalize a compound command for allowlist matching.
 * Strips safe shell constructs to expose the primary command.
 */
function normalizeCommand(command: string): string {
  let normalized = command.trim();

  // Strip leading `cd /path &&` or `cd /path;`
  normalized = normalized.replace(/^cd\s+\S+\s*(?:&&|;)\s*/, "");

  // Strip leading VAR=value env assignments (e.g., LOG=1 FOO=bar grep ...)
  normalized = normalized.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  // Also strip VAR=value && (with explicit &&)
  normalized = normalized.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s*&&\s*)+/, "");

  // Strip trailing shell redirections (2>/dev/null, >/dev/null 2>&1, etc.)
  // Use [ \t] instead of \s to avoid ReDoS from \s matching \r\n overlapping with .*
  normalized = normalized.replace(/[ \t]+\d*>[ \t]*\/dev\/null(?:[ \t]+2>&1)?$/, "");
  normalized = normalized.replace(/[ \t]+2>&1[ \t]*$/, "");

  // Strip trailing `; echo "..."` or `; echo $?` status checks
  normalized = normalized.replace(/[ \t]*;[ \t]*echo[ \t]+.*$/, "");

  // Strip pnpm workspace filter flags: --filter <pkg>, -F <pkg>, --filter=<pkg>
  normalized = normalized.replace(/^(pnpm)\s+(?:--filter(?:=|\s+)\S+|-F\s+\S+)\s+/, "$1 ");

  return normalized.trim();
}

/**
 * Check if a command matches any allowlist rule.
 * Returns the matching rule if found, null otherwise.
 * Falls back to normalized command matching (strips cd prefix, redirections, echo suffix),
 * then to individual segment matching for compound commands.
 */
export function matchesAllowlist(
  command: string,
  context: LogContext
): ExternalRule | null {
  const rules = loadAllowRules(context);
  const segments = getAllSegments(command);

  // Compound commands (multiple segments joined by &&, ;, ||, |) must have
  // ALL segments match the allowlist. This prevents bypass via e.g.
  // "rm -rf / && git status" where "git status" alone would match.
  if (segments.length > 1) {
    let allMatch = true;
    let lastRule: ExternalRule | null = null;
    for (const segment of segments) {
      let matched = false;
      for (const rule of rules) {
        if (matchesRule(segment.raw, rule)) {
          matched = true;
          lastRule = rule;
          break;
        }
      }
      if (!matched) {
        allMatch = false;
        break;
      }
    }
    if (allMatch && lastRule) {
      logDebug(`All segments match allowlist (last rule: ${lastRule.id})`, context);
      return lastRule;
    }
    return null;
  }

  // Single command — try full command first
  for (const rule of rules) {
    if (matchesRule(command, rule)) {
      logDebug(`Command matches allowlist rule: ${rule.id}`, context);
      return rule;
    }
  }

  // Try normalized command (strip cd prefix, redirections, echo suffix)
  const normalized = normalizeCommand(command);
  if (normalized !== command.trim()) {
    for (const rule of rules) {
      if (matchesRule(normalized, rule)) {
        logDebug(`Normalized command matches allowlist rule: ${rule.id} (original: ${command.slice(0, 60)})`, context);
        return rule;
      }
    }
  }

  return null;
}

/**
 * Check if a command matches any denylist rule.
 * Checks the full raw command, then each individual segment of compound commands.
 * If ANY segment matches, the whole command is denied.
 * Returns the matching rule if found, null otherwise.
 */
export function matchesDenylist(
  command: string,
  context: LogContext
): ExternalRule | null {
  const rules = loadDenyRules(context);

  // Check full raw command
  for (const rule of rules) {
    if (matchesRule(command, rule)) {
      logDebug(`Command matches denylist rule: ${rule.id}`, context);
      return rule;
    }
  }

  // Check each segment individually for compound commands
  const segments = getAllSegments(command);
  if (segments.length > 1) {
    for (const segment of segments) {
      for (const rule of rules) {
        if (matchesRule(segment.raw, rule)) {
          logDebug(`Segment matches denylist rule: ${rule.id} (segment: ${segment.raw.slice(0, 60)})`, context);
          return rule;
        }
      }
    }
  }

  return null;
}