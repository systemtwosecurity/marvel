// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Evaluation Schemas
 *
 * Structured output schemas and runtime validators for agent-based security evaluation.
 * Used by the WebSocket evaluation server to validate Claude's structured output.
 */

/**
 * The structured output from an agent security evaluation session.
 */
export interface AgentSecurityDecision {
  decision: "allow" | "deny" | "ask";
  reasoning: string;
  confidence: number; // 0.0–1.0
  investigated: string[]; // files/paths examined
  suggested_rule?: {
    type: "prefix" | "regex" | "contains";
    pattern: string;
    reason: string;
  };
}

/**
 * JSON Schema for the initialize control_request jsonSchema field.
 * Enables schema-validated structured output from Claude Code.
 */
export const SECURITY_DECISION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["allow", "deny", "ask"] },
    reasoning: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    investigated: { type: "array", items: { type: "string" } },
    suggested_rule: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["prefix", "regex", "contains"] },
        pattern: { type: "string" },
        reason: { type: "string" },
      },
      required: ["type", "pattern", "reason"],
    },
  },
  required: ["decision", "reasoning", "confidence"],
};

/**
 * Runtime validator for AgentSecurityDecision.
 * Belt-and-suspenders — CLI validates via schema but we double-check.
 */
export function isValidSecurityDecision(
  value: unknown
): value is AgentSecurityDecision {
  if (value === null || typeof value !== "object") return false;

  const obj = value as Record<string, unknown>;

  // Required fields
  if (typeof obj.decision !== "string") return false;
  if (!["allow", "deny", "ask"].includes(obj.decision)) return false;

  if (typeof obj.reasoning !== "string") return false;

  if (typeof obj.confidence !== "number") return false;
  if (obj.confidence < 0 || obj.confidence > 1) return false;

  // investigated is required by schema but may be missing — default to []
  if (obj.investigated !== undefined) {
    if (!Array.isArray(obj.investigated)) return false;
    for (const item of obj.investigated) {
      if (typeof item !== "string") return false;
    }
  }

  // suggested_rule is optional
  if (obj.suggested_rule !== undefined) {
    if (obj.suggested_rule === null || typeof obj.suggested_rule !== "object")
      return false;
    const rule = obj.suggested_rule as Record<string, unknown>;
    if (typeof rule.type !== "string") return false;
    if (!["prefix", "regex", "contains"].includes(rule.type)) return false;
    if (typeof rule.pattern !== "string") return false;
    if (typeof rule.reason !== "string") return false;
  }

  return true;
}

/**
 * Meta-evaluation result for Phase 2.
 */
export interface MetaEvaluationResult {
  original_decision: "allow" | "deny" | "ask";
  correct: boolean;
  suggested_decision: "allow" | "deny" | "ask";
  reasoning: string;
  confidence: number;
}

/**
 * JSON Schema for meta-evaluation structured output (Phase 2).
 */
export const META_EVALUATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    original_decision: { type: "string", enum: ["allow", "deny", "ask"] },
    correct: { type: "boolean" },
    suggested_decision: { type: "string", enum: ["allow", "deny", "ask"] },
    reasoning: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "original_decision",
    "correct",
    "suggested_decision",
    "reasoning",
    "confidence",
  ],
};