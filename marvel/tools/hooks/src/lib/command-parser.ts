// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Command Parser
 *
 * Shared utility for parsing compound Bash commands.
 * Used by learned-rules.ts and external-rules.ts to correctly handle
 * `cd /path && npx ...`, `source .env && pnpm tsx ...`, `# comment\ncat file`, etc.
 */

export interface CommandSegment {
  raw: string;
  executable: string;
  args: string[];
}

/**
 * Strip leading `# ...` comment lines from a command string.
 * Preserves inline comments (e.g., `cat file # this stays`).
 */
export function stripLeadingComments(command: string): string {
  const lines = command.split("\n");
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
    } else {
      break;
    }
  }
  return lines.slice(i).join("\n").trim();
}

/**
 * Split a command string on `&&`, `||`, `;` while respecting:
 * - Single and double quotes
 * - `$(...)` subshells (with nesting)
 * - Backslash escapes
 *
 * Does NOT split on `|` (pipe) — pipes are a single logical command.
 */
export function splitCompoundCommand(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let subshellDepth = 0;

  while (i < command.length) {
    const ch = command[i];

    // Backslash escape — consume next character literally
    if (ch === "\\" && !inSingleQuote && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 2;
      continue;
    }

    // Single quotes toggle (no escaping inside single quotes)
    if (ch === "'" && !inDoubleQuote && subshellDepth === 0) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }

    // Double quotes toggle
    if (ch === '"' && !inSingleQuote && subshellDepth === 0) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      i++;
      continue;
    }

    // Inside quotes — consume literally
    if (inSingleQuote || inDoubleQuote) {
      current += ch;
      i++;
      continue;
    }

    // $( subshell start
    if (ch === "$" && i + 1 < command.length && command[i + 1] === "(") {
      subshellDepth++;
      current += "$(";
      i += 2;
      continue;
    }

    // Subshell end
    if (ch === ")" && subshellDepth > 0) {
      subshellDepth--;
      current += ch;
      i++;
      continue;
    }

    // Inside subshell — consume literally
    if (subshellDepth > 0) {
      current += ch;
      i++;
      continue;
    }

    // Operators: &&, ||, ;
    if (ch === "&" && i + 1 < command.length && command[i + 1] === "&") {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = "";
      i += 2;
      continue;
    }

    if (ch === "|" && i + 1 < command.length && command[i + 1] === "|") {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = "";
      i += 2;
      continue;
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const trimmed = current.trim();
  if (trimmed) segments.push(trimmed);

  return segments;
}

// Commands that are "preamble" — they set up environment but aren't the
// meaningful command the user is actually running.
const PREAMBLE_COMMANDS = new Set([
  "cd", "pushd", "popd",
  "set", "shopt",
  "source", ".",
  "export", "unset",
  "true", "false",
]);

/**
 * Returns true if a command segment is a preamble (cd, source, export, VAR=val, etc.).
 */
export function isPreambleCommand(segment: string): boolean {
  const trimmed = segment.trim();

  // Bare VAR=value assignment (no command after it)
  if (/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(trimmed)) {
    return true;
  }

  // VAR=value with spaces in quoted value
  if (/^[A-Za-z_][A-Za-z0-9_]*=["']/.test(trimmed) && !trimmed.includes(" ")) {
    return true;
  }

  // Extract the first token
  const firstToken = trimmed.split(/\s+/)[0];
  return PREAMBLE_COMMANDS.has(firstToken);
}

/**
 * Parse a single command segment into its components.
 */
export function parseSegment(segment: string): CommandSegment {
  const trimmed = segment.trim();
  const parts = trimmed.split(/\s+/);
  return {
    raw: trimmed,
    executable: parts[0] || "",
    args: parts.slice(1),
  };
}

/**
 * Extract the first meaningful (non-preamble) command from a compound command string.
 * Strips comments → splits on operators → skips preamble → returns first meaningful segment.
 *
 * Returns null if the entire command is preamble or empty.
 */
export function extractMeaningfulCommand(command: string): CommandSegment | null {
  const stripped = stripLeadingComments(command);
  if (!stripped) return null;

  const segments = splitCompoundCommand(stripped);

  for (const seg of segments) {
    if (!isPreambleCommand(seg)) {
      return parseSegment(seg);
    }
  }

  // All segments are preamble — return the last one as a fallback
  if (segments.length > 0) {
    return parseSegment(segments[segments.length - 1]);
  }

  return null;
}

/**
 * Return all parsed segments from a compound command.
 * Used by denylist scanning to check every segment individually.
 */
export function getAllSegments(command: string): CommandSegment[] {
  const stripped = stripLeadingComments(command);
  if (!stripped) return [];

  return splitCompoundCommand(stripped).map(parseSegment);
}

/**
 * Convert an absolute path to a project-relative path.
 * Uses CLAUDE_PROJECT_DIR env var if available.
 *
 * `/Users/foo/project/backend/src/file.ts` → `backend/src/file.ts`
 *
 * Returns the original path if it's not under the project root.
 */
export function toProjectRelativePath(
  absolutePath: string,
  projectRoot?: string
): string {
  const root = projectRoot || process.env.CLAUDE_PROJECT_DIR;
  if (!root) return absolutePath;

  // Normalize: ensure root ends with /
  const normalizedRoot = root.endsWith("/") ? root : root + "/";

  if (absolutePath.startsWith(normalizedRoot)) {
    return absolutePath.slice(normalizedRoot.length);
  }

  return absolutePath;
}