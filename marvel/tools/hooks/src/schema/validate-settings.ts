// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Claude Code Settings Validator
 *
 * Validates .claude/settings.json against the Claude Code schema.
 * Run at build time to catch configuration errors early.
 *
 * Usage:
 *   node dist/schema/validate-settings.js [path-to-settings.json]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  type HookEventType,
  type HookHandlerType,
  type ValidationResult,
  VALID_HOOK_EVENTS,
  VALID_HANDLER_TYPES,
  MATCHERLESS_EVENTS,
} from "./settings-types.js";

// Type guards
function isHookEventType(value: string): value is HookEventType {
  return (VALID_HOOK_EVENTS as readonly string[]).includes(value);
}

function isHookHandlerType(value: unknown): value is HookHandlerType {
  return typeof value === "string" && (VALID_HANDLER_TYPES as readonly string[]).includes(value);
}

function isMatcherlessEvent(value: string): boolean {
  return (MATCHERLESS_EVENTS as readonly string[]).includes(value);
}

/**
 * Validate a Claude Code settings object
 */
export function validateSettings(settings: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Must be an object
  if (!settings || typeof settings !== "object") {
    return { valid: false, errors: ["Settings must be an object"], warnings: [] };
  }

  const s = settings as Record<string, unknown>;

  // Validate hooks if present
  if (s.hooks !== undefined) {
    if (typeof s.hooks !== "object" || s.hooks === null) {
      errors.push("hooks must be an object");
    } else {
      validateHooks(s.hooks as Record<string, unknown>, errors, warnings);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate the hooks configuration object
 */
function validateHooks(
  hooks: Record<string, unknown>,
  errors: string[],
  warnings: string[]
): void {
  for (const [event, matchers] of Object.entries(hooks)) {
    // Validate event name
    if (!isHookEventType(event)) {
      errors.push(`Invalid hook event: "${event}". Valid events: ${VALID_HOOK_EVENTS.join(", ")}`);
      continue;
    }

    // Matchers must be an array
    if (!Array.isArray(matchers)) {
      errors.push(`${event}: must be an array of matcher groups`);
      continue;
    }

    // Validate each matcher group
    for (let i = 0; i < matchers.length; i++) {
      validateMatcherGroup(event, i, matchers[i], errors, warnings);
    }
  }
}

/**
 * Validate a single matcher group
 */
function validateMatcherGroup(
  event: string,
  index: number,
  group: unknown,
  errors: string[],
  warnings: string[]
): void {
  const prefix = `${event}[${index}]`;

  if (!group || typeof group !== "object") {
    errors.push(`${prefix}: must be an object`);
    return;
  }

  const g = group as Record<string, unknown>;

  // CRITICAL: matcher must be a string, not an object
  if (g.matcher !== undefined) {
    if (typeof g.matcher !== "string") {
      // This is the most common mistake - using object format
      if (typeof g.matcher === "object" && g.matcher !== null) {
        const obj = g.matcher as Record<string, unknown>;
        if (Array.isArray(obj.tools)) {
          const tools = obj.tools as string[];
          errors.push(
            `${prefix}.matcher: INVALID FORMAT - got object {"tools": [${tools.map(t => `"${t}"`).join(", ")}]}, ` +
            `but matcher must be a regex STRING like "${tools.join("|")}"`
          );
        } else {
          errors.push(
            `${prefix}.matcher: Expected string (regex pattern), but got object. ` +
            `Use "Edit|Write|Read" instead of {"tools": [...]}`
          );
        }
      } else {
        errors.push(
          `${prefix}.matcher: Expected string (regex pattern), but got ${typeof g.matcher}`
        );
      }
    } else if (g.matcher === "") {
      warnings.push(
        `${prefix}.matcher: Empty string matches all. Consider omitting matcher instead.`
      );
    }

    // Warn if matcher is set for events that don't support it
    if (isMatcherlessEvent(event)) {
      warnings.push(
        `${prefix}.matcher: "${event}" does not support matchers. Matcher will be ignored.`
      );
    }
  }

  // hooks array is required
  if (!Array.isArray(g.hooks)) {
    errors.push(`${prefix}.hooks: must be an array of hook handlers`);
    return;
  }

  if (g.hooks.length === 0) {
    warnings.push(`${prefix}.hooks: empty array - this matcher group does nothing`);
  }

  // Validate each hook handler
  for (let j = 0; j < g.hooks.length; j++) {
    validateHookHandler(prefix, j, g.hooks[j], errors, warnings);
  }
}

/**
 * Validate a single hook handler
 */
function validateHookHandler(
  prefix: string,
  index: number,
  handler: unknown,
  errors: string[],
  warnings: string[]
): void {
  const hPrefix = `${prefix}.hooks[${index}]`;

  if (!handler || typeof handler !== "object") {
    errors.push(`${hPrefix}: must be an object`);
    return;
  }

  const h = handler as Record<string, unknown>;

  // type is required
  if (!h.type) {
    errors.push(`${hPrefix}.type: required field missing`);
    return;
  }

  if (!isHookHandlerType(h.type)) {
    errors.push(
      `${hPrefix}.type: "${h.type}" is not valid. Must be: ${VALID_HANDLER_TYPES.join(", ")}`
    );
    return;
  }

  // Validate based on handler type
  switch (h.type) {
    case "command":
      validateCommandHandler(hPrefix, h, errors, warnings);
      break;
    case "prompt":
    case "agent":
      validatePromptHandler(hPrefix, h, errors, warnings);
      break;
  }

  // Validate optional common fields
  if (h.timeout !== undefined && typeof h.timeout !== "number") {
    errors.push(`${hPrefix}.timeout: must be a number (seconds)`);
  }

  if (h.statusMessage !== undefined && typeof h.statusMessage !== "string") {
    errors.push(`${hPrefix}.statusMessage: must be a string`);
  }
}

/**
 * Validate a command hook handler
 */
function validateCommandHandler(
  prefix: string,
  handler: Record<string, unknown>,
  errors: string[],
  warnings: string[]
): void {
  // command is required
  if (typeof handler.command !== "string") {
    errors.push(`${prefix}.command: required string field`);
    return;
  }

  const cmd = handler.command;

  // Check for working directory independence
  if (!cmd.includes("$CLAUDE_PROJECT_DIR") && !cmd.startsWith("/")) {
    // Check if it's a relative path that could break
    if (cmd.includes("/") || cmd.startsWith("node ") || cmd.startsWith("./")) {
      warnings.push(
        `${prefix}.command: Uses relative path "${cmd.substring(0, 50)}...". ` +
        `Consider using $CLAUDE_PROJECT_DIR for working directory independence: ` +
        `node "$CLAUDE_PROJECT_DIR/path/to/script.js"`
      );
    }
  }

  // Validate async field
  if (handler.async !== undefined && typeof handler.async !== "boolean") {
    errors.push(`${prefix}.async: must be a boolean`);
  }
}

/**
 * Validate a prompt or agent hook handler
 */
function validatePromptHandler(
  prefix: string,
  handler: Record<string, unknown>,
  errors: string[],
  warnings: string[]
): void {
  // prompt is required
  if (typeof handler.prompt !== "string") {
    errors.push(`${prefix}.prompt: required string field`);
    return;
  }

  // Check for $ARGUMENTS placeholder
  if (!handler.prompt.includes("$ARGUMENTS")) {
    warnings.push(
      `${prefix}.prompt: Does not include $ARGUMENTS placeholder. ` +
      `The hook input JSON will be appended to the prompt.`
    );
  }

  // Validate model field
  if (handler.model !== undefined && typeof handler.model !== "string") {
    errors.push(`${prefix}.model: must be a string`);
  }
}

/**
 * Find the project root by looking for .claude directory
 */
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

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Determine settings path
  let settingsPath: string;

  if (args[0]) {
    settingsPath = path.resolve(args[0]);
  } else {
    // Find project root from current directory or __dirname
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = findProjectRoot(process.cwd()) || findProjectRoot(__dirname);

    if (!projectRoot) {
      console.error("Error: Could not find project root (no .claude directory found)");
      console.error("Usage: node validate-settings.js [path-to-settings.json]");
      process.exit(1);
    }

    settingsPath = path.join(projectRoot, ".claude", "settings.json");
  }

  // Check file exists
  if (!fs.existsSync(settingsPath)) {
    console.error(`Error: Settings file not found: ${settingsPath}`);
    process.exit(1);
  }

  console.log(`Validating: ${settingsPath}\n`);

  // Read and parse JSON
  let content: string;
  let settings: unknown;

  try {
    content = fs.readFileSync(settingsPath, "utf-8");
  } catch (e) {
    console.error(`Error reading file: ${e}`);
    process.exit(1);
  }

  try {
    settings = JSON.parse(content);
  } catch (e) {
    console.error(`Error: Invalid JSON in settings.json`);
    console.error(`  ${e}`);
    process.exit(1);
  }

  // Validate
  const result = validateSettings(settings);

  // Print warnings
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`  \u26A0  ${warning}`);
    }
    console.log("");
  }

  // Print errors
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const error of result.errors) {
      console.log(`  \u2717  ${error}`);
    }
    console.log("");
    console.error(`Validation FAILED with ${result.errors.length} error(s)`);
    process.exit(1);
  }

  console.log("\u2713 Settings validated successfully");
  if (result.warnings.length > 0) {
    console.log(`  (${result.warnings.length} warning(s))`);
  }
}

// Run if executed directly
main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});