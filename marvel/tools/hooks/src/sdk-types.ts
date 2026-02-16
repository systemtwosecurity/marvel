// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * SDK Type Re-exports
 *
 * Type-only re-exports from @anthropic-ai/claude-agent-sdk.
 * Zero runtime cost — ensures our hooks match what Claude Code sends/expects.
 */

export type {
  // Hook event discriminator
  HookEvent,

  // Base input (common fields: session_id, transcript_path, cwd, permission_mode?)
  BaseHookInput,

  // Discriminated union of all hook inputs
  HookInput,

  // Individual hook input types
  PreToolUseHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  UserPromptSubmitHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  StopHookInput,
  PermissionRequestHookInput,
  PreCompactHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  NotificationHookInput,
  TeammateIdleHookInput,
  TaskCompletedHookInput,

  // Sync hook output (the shape we return from handlers)
  SyncHookJSONOutput,

  // Hook-specific output types (nested in hookSpecificOutput)
  PreToolUseHookSpecificOutput,
  PostToolUseHookSpecificOutput,
  PostToolUseFailureHookSpecificOutput,
  UserPromptSubmitHookSpecificOutput,
  SessionStartHookSpecificOutput,
  PermissionRequestHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";