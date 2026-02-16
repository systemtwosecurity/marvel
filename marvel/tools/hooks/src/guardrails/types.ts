// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Guardrail Types
 *
 * Type definitions for MARVEL guardrails and validation.
 */

/**
 * Module boundary definition
 */
export interface ModuleBoundary {
  from: string;
  cannotImportFrom: string[];
}

/**
 * Guardrail configuration
 */
export interface Guardrails {
  allowedTools?: string[];
  forbiddenPaths?: RegExp[];
  sensitivePaths?: RegExp[];
  boundaries?: ModuleBoundary[];
}

/**
 * Guardrail violation severity
 */
export type ViolationSeverity = 'warning' | 'error' | 'critical';

/**
 * Guardrail violation type
 */
export type ViolationType =
  | 'tool_not_allowed'
  | 'forbidden_path'
  | 'sensitive_path'
  | 'module_boundary';

/**
 * Guardrail violation error
 */
export class GuardrailViolation extends Error {
  constructor(
    message: string,
    public readonly type: ViolationType,
    public readonly severity: ViolationSeverity = 'error',
    public readonly context?: {
      tool?: string;
      path?: string;
      from?: string;
      to?: string;
      command?: string;
      allowedTools?: string[];
      forbiddenPatterns?: RegExp[];
      boundaries?: ModuleBoundary[];
      reference?: string;
    },
  ) {
    super(message);
    this.name = 'GuardrailViolation';
  }
}

/**
 * Tool call parameters (simplified)
 */
export interface ToolCallParams {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  command?: string; // For Bash tool
  path?: string; // For Glob/Grep tools
  pattern?: string; // For Grep tool
  [key: string]: unknown;
}