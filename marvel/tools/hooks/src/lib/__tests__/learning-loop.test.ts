// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Integration tests for the LLM learning loop.
 *
 * Verifies the full flow: LLM decision → pending decision → PostToolUse → learned rule.
 * Tests both "allow" and "ask" paths, with and without LLM-suggested patterns.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { addLearnedRule, clearSessionRules, matchesLearnedRules } from "../learned-rules.js";
import { addPendingDecision, consumePendingDecision, clearPendingDecisions } from "../pending-decisions.js";

// Mock fs to prevent disk writes
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock logger to suppress output
vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  buildHookContext: vi.fn(() => ({})),
}));

describe("LLM learning loop — allow with suggested rule", () => {
  beforeEach(() => {
    clearSessionRules();
    clearPendingDecisions();
  });

  it("LLM allow + suggested rule → pending → consumed → learned rule uses LLM pattern", () => {
    const command = "gh pr list --state open";
    const suggestedRule = { type: "prefix", pattern: "gh pr list", reason: "gh pr list is read-only" };

    // Step 1: LLM says "allow" with a suggested pattern → tracked as pending
    addPendingDecision(command, "Standard dev operation", undefined, undefined, suggestedRule);

    // Step 2: PostToolUse fires → consume the pending decision
    const pending = consumePendingDecision(command);
    expect(pending).not.toBeNull();
    expect(pending!.suggestedRule).toEqual(suggestedRule);

    // Step 3: addLearnedRule uses the LLM's suggested pattern
    const rule = addLearnedRule(command, undefined, pending!.suggestedRule);
    expect(rule).not.toBeNull();
    expect(rule!.pattern).toBe("gh pr list");
    expect(rule!.type).toBe("prefix");

    // Step 4: Future invocations match the learned rule
    const match = matchesLearnedRules("gh pr list --reviewer me");
    expect(match).not.toBeNull();
    expect(match!.pattern).toBe("gh pr list");
  });

  it("LLM allow without suggested rule → falls back to extractPattern", () => {
    const command = "gh pr list --state open";

    // No suggestedRule provided
    addPendingDecision(command, "Standard dev operation");

    const pending = consumePendingDecision(command);
    expect(pending).not.toBeNull();
    expect(pending!.suggestedRule).toBeUndefined();

    // Falls back to extractPattern heuristic: "gh pr"
    const rule = addLearnedRule(command, undefined, pending!.suggestedRule);
    expect(rule).not.toBeNull();
    expect(rule!.pattern).toBe("gh pr");
  });

  it("LLM ask → user approves → learning works (regression)", () => {
    const command = "pnpm test:run";

    // LLM says "ask" with no suggestion
    addPendingDecision(command, "Uncertain about this command");

    // User approves → PostToolUse consumes
    const pending = consumePendingDecision(command);
    expect(pending).not.toBeNull();

    // Learn from user approval
    const rule = addLearnedRule(command, undefined, pending!.suggestedRule);
    expect(rule).not.toBeNull();
    expect(rule!.pattern).toBe("pnpm test:run");
  });

  it("dangerous LLM-suggested pattern is still rejected by isPatternSafe", () => {
    const command = "sudo rm -rf /tmp/cache";
    const suggestedRule = { type: "prefix", pattern: "sudo rm", reason: "common cleanup" };

    addPendingDecision(command, "Cleanup command", undefined, undefined, suggestedRule);

    const pending = consumePendingDecision(command);
    expect(pending).not.toBeNull();

    // isPatternSafe rejects "sudo" base commands
    const rule = addLearnedRule(command, undefined, pending!.suggestedRule);
    expect(rule).toBeNull();
  });

  it("too-short LLM-suggested pattern is rejected", () => {
    const command = "ls -la";
    const suggestedRule = { type: "prefix", pattern: "ls", reason: "listing files" };

    addPendingDecision(command, "List files", undefined, undefined, suggestedRule);

    const pending = consumePendingDecision(command);
    const rule = addLearnedRule(command, undefined, pending!.suggestedRule);
    // "ls" is only 2 chars, rejected by MIN_PATTERN_LENGTH
    expect(rule).toBeNull();
  });

  it("consumed pending decision is not available for second consumption", () => {
    const command = "gh pr list";
    addPendingDecision(command, "read-only");

    const first = consumePendingDecision(command);
    expect(first).not.toBeNull();

    const second = consumePendingDecision(command);
    expect(second).toBeNull();
  });
});
