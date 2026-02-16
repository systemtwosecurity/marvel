// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  SECURITY_DECISION_SCHEMA,
  META_EVALUATION_SCHEMA,
  isValidSecurityDecision,
} from "../evaluation-schemas.js";

describe("SECURITY_DECISION_SCHEMA", () => {
  it("has required top-level structure", () => {
    expect(SECURITY_DECISION_SCHEMA.type).toBe("object");
    expect(SECURITY_DECISION_SCHEMA.required).toEqual([
      "decision",
      "reasoning",
      "confidence",
    ]);
  });

  it("defines decision as enum with correct values", () => {
    const props = SECURITY_DECISION_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.decision.enum).toEqual(["allow", "deny", "ask"]);
  });

  it("defines confidence with min/max bounds", () => {
    const props = SECURITY_DECISION_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.confidence.minimum).toBe(0);
    expect(props.confidence.maximum).toBe(1);
  });

  it("defines investigated as array of strings", () => {
    const props = SECURITY_DECISION_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.investigated).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("defines suggested_rule with required fields", () => {
    const props = SECURITY_DECISION_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const rule = props.suggested_rule as Record<string, unknown>;
    expect(rule.required).toEqual(["type", "pattern", "reason"]);
  });
});

describe("META_EVALUATION_SCHEMA", () => {
  it("has required top-level structure", () => {
    expect(META_EVALUATION_SCHEMA.type).toBe("object");
    expect(META_EVALUATION_SCHEMA.required).toEqual([
      "original_decision",
      "correct",
      "suggested_decision",
      "reasoning",
      "confidence",
    ]);
  });
});

describe("isValidSecurityDecision", () => {
  it("accepts valid allow decision", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "Standard build command",
        confidence: 0.95,
        investigated: [],
      })
    ).toBe(true);
  });

  it("accepts valid deny decision", () => {
    expect(
      isValidSecurityDecision({
        decision: "deny",
        reasoning: "Destructive command",
        confidence: 0.99,
        investigated: ["/src/index.ts"],
      })
    ).toBe(true);
  });

  it("accepts valid ask decision", () => {
    expect(
      isValidSecurityDecision({
        decision: "ask",
        reasoning: "Uncertain intent",
        confidence: 0.5,
        investigated: [],
      })
    ).toBe(true);
  });

  it("accepts decision with suggested_rule", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "Git command",
        confidence: 0.9,
        investigated: [],
        suggested_rule: {
          type: "prefix",
          pattern: "git status",
          reason: "Read-only git command",
        },
      })
    ).toBe(true);
  });

  it("accepts decision without investigated field", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "Standard command",
        confidence: 0.8,
      })
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidSecurityDecision(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidSecurityDecision(undefined)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidSecurityDecision("string")).toBe(false);
    expect(isValidSecurityDecision(42)).toBe(false);
  });

  it("rejects missing decision", () => {
    expect(
      isValidSecurityDecision({
        reasoning: "test",
        confidence: 0.5,
      })
    ).toBe(false);
  });

  it("rejects invalid decision value", () => {
    expect(
      isValidSecurityDecision({
        decision: "maybe",
        reasoning: "test",
        confidence: 0.5,
      })
    ).toBe(false);
  });

  it("rejects missing reasoning", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        confidence: 0.5,
      })
    ).toBe(false);
  });

  it("rejects missing confidence", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
      })
    ).toBe(false);
  });

  it("rejects confidence below 0", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: -0.1,
      })
    ).toBe(false);
  });

  it("rejects confidence above 1", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 1.1,
      })
    ).toBe(false);
  });

  it("accepts confidence at boundaries (0 and 1)", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 0,
      })
    ).toBe(true);
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 1,
      })
    ).toBe(true);
  });

  it("rejects non-string items in investigated", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 0.5,
        investigated: [42],
      })
    ).toBe(false);
  });

  it("rejects non-array investigated", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 0.5,
        investigated: "not-array",
      })
    ).toBe(false);
  });

  it("rejects invalid suggested_rule type", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 0.5,
        suggested_rule: {
          type: "invalid",
          pattern: "test",
          reason: "test",
        },
      })
    ).toBe(false);
  });

  it("rejects suggested_rule missing pattern", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 0.5,
        suggested_rule: {
          type: "prefix",
          reason: "test",
        },
      })
    ).toBe(false);
  });

  it("rejects null suggested_rule", () => {
    expect(
      isValidSecurityDecision({
        decision: "allow",
        reasoning: "test",
        confidence: 0.5,
        suggested_rule: null,
      })
    ).toBe(false);
  });
});