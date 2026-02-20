// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Convergence integration test.
 *
 * Exercises the FULL security gate pipeline end-to-end:
 *   evaluateBashCommand → addPendingDecision → processApprovedCommand
 *   → consumePendingDecision → addLearnedRule → matchesLearnedRules
 *
 * Verifies the system converges: after one LLM call, the second invocation
 * of the same command pattern skips the LLM entirely (learned rule match).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock fs — prevents disk I/O from external-rules, learned-rules, and metrics persistence
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock logger — suppress output
vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  buildHookContext: vi.fn(() => ({ hookType: "test" })),
}));

// Mock agent-evaluator — controllable LLM responses, trackable calls
vi.mock("../agent-evaluator.js", () => ({
  analyzeWithAgent: vi.fn(),
  isEvalEnabled: vi.fn(() => ({ enabled: true })),
}));

// Mock paths — no security dir on disk, no run dir
vi.mock("../paths.js", () => ({
  findMarvelRoot: vi.fn(() => null),
  findRunDir: vi.fn(() => null),
  findSecurityDir: vi.fn(() => null),
  getSecurityDir: vi.fn(() => "/tmp/marvel-test-security"),
  getTempDir: vi.fn(() => "/tmp"),
}));

// Mock redact — passthrough
vi.mock("../redact.js", () => ({
  redactSensitive: vi.fn((s: string) => s),
}));

// --- Real modules under test (not mocked) ---
import { evaluateBashCommand, processApprovedCommand, resetSecurityMetrics, getSecurityMetrics } from "../bash-security-gate.js";
import { clearSessionRules } from "../learned-rules.js";
import { clearPendingDecisions } from "../pending-decisions.js";
import { analyzeWithAgent } from "../agent-evaluator.js";

const mockAnalyze = analyzeWithAgent as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionRules();
  clearPendingDecisions();
  resetSecurityMetrics();
});

describe("convergence — LLM allow path", () => {
  it("first call hits LLM, second call matches learned rule (LLM skipped)", async () => {
    // LLM says "allow" with a suggested pattern
    mockAnalyze.mockResolvedValue({
      decision: "allow",
      reason: "Read-only GitHub CLI operation",
      suggestedRule: { type: "prefix", pattern: "gh pr", reason: "gh pr commands are read-only" },
    });

    const ctx = { hookType: "test" };

    // --- First invocation ---
    const result1 = await evaluateBashCommand("gh pr list --state open", undefined, ctx);
    expect(result1.decision).toBe("allow");
    expect(result1.source).toBe("llm");
    expect(mockAnalyze).toHaveBeenCalledTimes(1);

    // Simulate PostToolUse: command ran successfully
    const learned = processApprovedCommand("gh pr list --state open", ctx);
    expect(learned).toBe(true);

    // --- Second invocation (same command) ---
    mockAnalyze.mockClear();
    const result2 = await evaluateBashCommand("gh pr list --state open", undefined, ctx);
    expect(result2.decision).toBe("allow");
    expect(result2.source).toBe("learned");
    expect(mockAnalyze).not.toHaveBeenCalled(); // LLM NOT consulted

    // --- Third invocation (different args, same prefix) ---
    const result3 = await evaluateBashCommand("gh pr view 42", undefined, ctx);
    expect(result3.decision).toBe("allow");
    expect(result3.source).toBe("learned");
    expect(mockAnalyze).not.toHaveBeenCalled(); // still no LLM
  });

  it("converges for LLM allow WITHOUT suggested pattern (falls back to extractPattern)", async () => {
    // LLM says "allow" but provides no suggestedRule
    mockAnalyze.mockResolvedValue({
      decision: "allow",
      reason: "Safe pnpm operation",
    });

    const ctx = { hookType: "test" };

    // First invocation
    const result1 = await evaluateBashCommand("pnpm exec vitest run", undefined, ctx);
    expect(result1.decision).toBe("allow");
    expect(result1.source).toBe("llm");

    // PostToolUse
    const learned = processApprovedCommand("pnpm exec vitest run", ctx);
    expect(learned).toBe(true);

    // Second invocation — should match learned rule "pnpm exec"
    mockAnalyze.mockClear();
    const result2 = await evaluateBashCommand("pnpm exec vitest run", undefined, ctx);
    expect(result2.decision).toBe("allow");
    expect(result2.source).toBe("learned");
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it("LLM 'ask' path still works — user approval triggers learning", async () => {
    // LLM says "ask" — user must confirm
    mockAnalyze.mockResolvedValue({
      decision: "ask",
      reason: "Uncertain about this command",
    });

    const ctx = { hookType: "test" };

    // First invocation — LLM says ask
    const result1 = await evaluateBashCommand("cargo build --release", undefined, ctx);
    expect(result1.decision).toBe("ask");
    expect(result1.source).toBe("llm");

    // User approves → command runs → PostToolUse
    const learned = processApprovedCommand("cargo build --release", ctx);
    expect(learned).toBe(true);

    // Second invocation — should match learned rule "cargo build"
    mockAnalyze.mockClear();
    const result2 = await evaluateBashCommand("cargo build --release", undefined, ctx);
    expect(result2.decision).toBe("allow");
    expect(result2.source).toBe("learned");
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it("LLM 'deny' does NOT create a pending decision or learned rule", async () => {
    mockAnalyze.mockResolvedValue({
      decision: "deny",
      reason: "Destructive operation",
    });

    const ctx = { hookType: "test" };

    // First invocation — denied
    const result1 = await evaluateBashCommand("rm -rf /tmp/important", undefined, ctx);
    expect(result1.decision).toBe("deny");
    expect(result1.source).toBe("llm");

    // PostToolUse — should NOT find a pending decision
    const learned = processApprovedCommand("rm -rf /tmp/important", ctx);
    expect(learned).toBe(false);

    // Second invocation — must still hit LLM (nothing learned)
    const result2 = await evaluateBashCommand("rm -rf /tmp/important", undefined, ctx);
    expect(result2.source).toBe("llm");
    expect(mockAnalyze).toHaveBeenCalledTimes(2);
  });

  it("metrics track convergence accurately", async () => {
    mockAnalyze.mockResolvedValue({
      decision: "allow",
      reason: "Safe",
      suggestedRule: { type: "prefix", pattern: "gh issue", reason: "read-only" },
    });

    const ctx = { hookType: "test" };

    // First call: LLM
    await evaluateBashCommand("gh issue list", undefined, ctx);
    processApprovedCommand("gh issue list", ctx);

    // Second call: learned
    mockAnalyze.mockClear();
    await evaluateBashCommand("gh issue list", undefined, ctx);

    // Third call: learned (different args)
    await evaluateBashCommand("gh issue view 123", undefined, ctx);

    const m = getSecurityMetrics();
    expect(m.bySource.llm).toBe(1);
    expect(m.bySource.learned).toBe(2);
    expect(m.total).toBe(3);
    // autoAcceptRate = (allowlist + learned) / total = 2/3
    expect(m.autoAcceptRate).toBeCloseTo(2 / 3);
  });

  it("allowlist commands bypass both LLM and learning", async () => {
    const ctx = { hookType: "test" };

    // "git status" is in the default allowlist
    const result = await evaluateBashCommand("git status", undefined, ctx);
    expect(result.decision).toBe("allow");
    expect(result.source).toBe("allowlist");
    expect(mockAnalyze).not.toHaveBeenCalled();

    // PostToolUse — no pending decision, no learning
    const learned = processApprovedCommand("git status", ctx);
    expect(learned).toBe(false);
  });

  it("dangerous LLM-suggested pattern is rejected, falls back to extractPattern", async () => {
    // LLM suggests a pattern with a dangerous base command
    mockAnalyze.mockResolvedValue({
      decision: "allow",
      reason: "Package update",
      suggestedRule: { type: "prefix", pattern: "sudo apt update", reason: "safe update" },
    });

    const ctx = { hookType: "test" };

    await evaluateBashCommand("sudo apt update", undefined, ctx);
    // processApprovedCommand: suggestedRule="sudo apt update" → isPatternSafe rejects (sudo)
    // falls through entirely — addLearnedRule returns null
    const learned = processApprovedCommand("sudo apt update", ctx);
    expect(learned).toBe(false);

    // Second invocation still hits LLM (nothing learned)
    mockAnalyze.mockClear();
    mockAnalyze.mockResolvedValue({ decision: "ask", reason: "Needs confirmation" });
    const result2 = await evaluateBashCommand("sudo apt update", undefined, ctx);
    expect(result2.source).toBe("llm");
  });
});
