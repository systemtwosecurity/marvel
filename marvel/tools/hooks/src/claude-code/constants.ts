// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Claude Code Constants
 *
 * Central registry of all assumptions about Claude Code.
 * When Claude Code updates, check the changelog and update the tracked
 * version below, then audit all constants for compatibility.
 */

/**
 * Tracked Claude Code version
 * Update this when upgrading Claude Code compatibility
 */
export const CLAUDE_CODE_VERSION = {
  major: 2,
  minor: 1,
  patch: 38,
  full: '2.1.38',
  releaseDate: '2026-02-01',
} as const;

/**
 * Tool names as they appear in Claude Code tool calls
 * If Claude Code renames a tool, update here
 */
export const TOOL_NAMES = {
  // File operations
  read: 'Read',
  write: 'Write',
  edit: 'Edit',

  // Search operations
  grep: 'Grep',
  glob: 'Glob',

  // Execution
  bash: 'Bash',

  // Web operations
  webFetch: 'WebFetch',
  webSearch: 'WebSearch',

  // Task management
  taskCreate: 'TaskCreate',
  taskUpdate: 'TaskUpdate',
  taskGet: 'TaskGet',
  taskList: 'TaskList',
  task: 'Task',
  taskOutput: 'TaskOutput',
  taskStop: 'TaskStop',

  // Other
  skill: 'Skill',
  askUserQuestion: 'AskUserQuestion',
  enterPlanMode: 'EnterPlanMode',
  exitPlanMode: 'ExitPlanMode',

  // Notebook
  notebookEdit: 'NotebookEdit',
} as const;

/**
 * Tool parameter names
 * If Claude Code changes parameter names, update here
 */
export const TOOL_PARAMS = {
  // Read tool
  read: {
    filePath: 'file_path',
    offset: 'offset',
    limit: 'limit',
  },

  // Write tool
  write: {
    filePath: 'file_path',
    content: 'content',
  },

  // Edit tool
  edit: {
    filePath: 'file_path',
    oldString: 'old_string',
    newString: 'new_string',
    replaceAll: 'replace_all',
  },

  // Bash tool
  bash: {
    command: 'command',
    timeout: 'timeout',
    description: 'description',
    runInBackground: 'run_in_background',
  },

  // Grep tool
  grep: {
    pattern: 'pattern',
    path: 'path',
    glob: 'glob',
    outputMode: 'output_mode',
  },

  // Glob tool
  glob: {
    pattern: 'pattern',
    path: 'path',
  },
} as const;

/**
 * Hook types supported by Claude Code
 * If Claude Code adds/removes hook types, update here
 */
export const HOOK_TYPES = {
  sessionStart: 'SessionStart',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
  userPromptSubmit: 'UserPromptSubmit',
  stop: 'Stop',
  preCompact: 'PreCompact',
  permissionRequest: 'PermissionRequest',
  subagentStart: 'SubagentStart',
  subagentStop: 'SubagentStop',
  notification: 'Notification',
  teammateIdle: 'TeammateIdle',
  taskCompleted: 'TaskCompleted',
  sessionEnd: 'SessionEnd',
} as const;

/**
 * Hook input/output format expectations
 */
export const HOOK_FORMAT = {
  // Hook receives JSON on stdin
  inputFormat: 'json',
  // Hook returns JSON on stdout
  outputFormat: 'json',
  // Expected fields in hook input
  inputFields: {
    tool: 'tool',
    toolInput: 'toolInput',
    sessionId: 'sessionId',
  },
  // Expected fields in hook output
  outputFields: {
    decision: 'decision', // 'allow' | 'block' | 'modify'
    reason: 'reason',
    modifiedInput: 'modifiedInput',
  },
} as const;

/**
 * Agent types available via Task tool
 * If Claude Code renames/removes agents, update here
 */
export const AGENT_TYPES = {
  generalPurpose: 'general-purpose',
  explore: 'Explore',
  plan: 'Plan',
  // Note: These are built-in agent names
} as const;

/**
 * Permission format in settings.json
 */
export const PERMISSION_FORMAT = {
  // Permission patterns use this format
  pattern: 'Tool(pattern:*)',
  // Example: 'Bash(pnpm:*)', 'Read(/tmp/**)'
  examples: ['Bash(pnpm:*)', 'Bash(git:*)', 'Read(/tmp/**)', 'WebFetch(domain:github.com)'],
} as const;

/**
 * Settings.json structure expectations
 */
export const SETTINGS_STRUCTURE = {
  // Top-level keys
  permissions: 'permissions',
  hooks: 'hooks',

  // Permission sub-keys
  permissionsAllow: 'allow',
  permissionsDeny: 'deny',
} as const;

/**
 * Token budget expectations
 */
export const TOKEN_BUDGET = {
  // Approximate Claude Code system prompt size
  systemPromptTokens: 15000,
  // Approximate context window
  contextWindow: 200000,
  // Recommended MARVEL overhead
  marvelOverhead: 5000,
} as const;

/**
 * Get all tool names as an array
 */
export function getAllToolNames(): string[] {
  return Object.values(TOOL_NAMES);
}

/**
 * Check if a string is a known tool name
 */
export function isKnownTool(name: string): boolean {
  return getAllToolNames().includes(name);
}

/**
 * Get all hook types as an array
 */
export function getAllHookTypes(): string[] {
  return Object.values(HOOK_TYPES);
}

/**
 * Check if a string is a known hook type
 */
export function isKnownHookType(type: string): boolean {
  return getAllHookTypes().includes(type);
}