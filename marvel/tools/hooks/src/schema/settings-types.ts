// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Claude Code Settings Schema Types
 *
 * TypeScript types that match Claude Code's hook configuration schema.
 * These provide compile-time safety when generating or validating settings.json.
 *
 * Reference: https://code.claude.com/docs/en/hooks
 */

import type { HookEvent } from "../sdk-types.js";

// Re-export SDK's HookEvent as HookEventType for backward compatibility
export type HookEventType = HookEvent;

// Tool names that can be matched in PreToolUse/PostToolUse
export type ToolName =
  | "Bash"
  | "Edit"
  | "Write"
  | "Read"
  | "Glob"
  | "Grep"
  | "Task"
  | "WebFetch"
  | "WebSearch"
  | "NotebookEdit"
  | string; // MCP tools follow pattern mcp__<server>__<tool>

// SessionStart matcher values
export type SessionStartMatcher = "startup" | "resume" | "clear" | "compact";

// SessionEnd matcher values
export type SessionEndMatcher =
  | "clear"
  | "logout"
  | "prompt_input_exit"
  | "bypass_permissions_disabled"
  | "other";

// Notification matcher values
export type NotificationMatcher =
  | "permission_prompt"
  | "idle_prompt"
  | "auth_success"
  | "elicitation_dialog";

// PreCompact matcher values
export type PreCompactMatcher = "manual" | "auto";

// Hook handler types
export type HookHandlerType = "command" | "prompt" | "agent";

// Base fields common to all hook handlers
interface BaseHookHandler {
  timeout?: number;
  statusMessage?: string;
}

// Command hook handler - executes a shell command
export interface CommandHookHandler extends BaseHookHandler {
  type: "command";
  command: string;
  async?: boolean;
}

// Prompt hook handler - single-turn LLM evaluation
export interface PromptHookHandler extends BaseHookHandler {
  type: "prompt";
  prompt: string;
  model?: string;
}

// Agent hook handler - multi-turn LLM with tool access
export interface AgentHookHandler extends BaseHookHandler {
  type: "agent";
  prompt: string;
  model?: string;
}

export type HookHandler = CommandHookHandler | PromptHookHandler | AgentHookHandler;

/**
 * Matcher group - defines when hooks fire
 *
 * IMPORTANT: The `matcher` field is a REGEX STRING, not an object.
 * - Use "Edit|Write|Read" to match multiple tools
 * - Use "Bash" to match a single tool
 * - Use "mcp__.*" to match all MCP tools
 * - Omit matcher or use "*" to match all occurrences
 */
export interface MatcherGroup {
  /**
   * Regex pattern string to filter when hooks fire.
   * What it filters depends on the event type:
   * - PreToolUse/PostToolUse: tool name
   * - SessionStart: startup reason
   * - Notification: notification type
   *
   * MUST be a string, not an object like {"tools": [...]}
   */
  matcher?: string;
  hooks: HookHandler[];
}

// Full hooks configuration
export interface HooksConfiguration {
  SessionStart?: MatcherGroup[];
  UserPromptSubmit?: MatcherGroup[];
  PreToolUse?: MatcherGroup[];
  PostToolUse?: MatcherGroup[];
  PostToolUseFailure?: MatcherGroup[];
  PermissionRequest?: MatcherGroup[];
  Notification?: MatcherGroup[];
  SubagentStart?: MatcherGroup[];
  SubagentStop?: MatcherGroup[];
  Stop?: MatcherGroup[];
  PreCompact?: MatcherGroup[];
  SessionEnd?: MatcherGroup[];
  TeammateIdle?: MatcherGroup[];
  TaskCompleted?: MatcherGroup[];
}

// Full settings.json schema
export interface ClaudeSettings {
  plansDirectory?: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  hooks?: HooksConfiguration;
  disableAllHooks?: boolean;
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Helper type to ensure hook events are valid
export const VALID_HOOK_EVENTS: readonly HookEventType[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "PreCompact",
  "SessionEnd",
  "TeammateIdle",
  "TaskCompleted",
] as const;

// Events that don't support matchers
export const MATCHERLESS_EVENTS: readonly HookEventType[] = [
  "UserPromptSubmit",
  "Stop",
  "TeammateIdle",
  "TaskCompleted",
] as const;

// Valid handler types
export const VALID_HANDLER_TYPES: readonly HookHandlerType[] = [
  "command",
  "prompt",
  "agent",
] as const;