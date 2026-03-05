// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreReflection, TaskReflectionState } from "../../types.js";

vi.mock("../../lib/file-ops.js", () => ({
  safeWriteJson: vi.fn().mockReturnValue(true),
  safeReadJson: vi.fn().mockReturnValue(null),
}));

vi.mock("../../lib/logger.js", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
}));

import {
  generatePreReflection,
  generatePostReflection,
  writeReflection,
  readPreReflection,
  generateTaskId,
  formatReflectionSummary,
} from "../reflection.js";
import { safeWriteJson, safeReadJson } from "../file-ops.js";

const mockSafeWriteJson = vi.mocked(safeWriteJson);
const mockSafeReadJson = vi.mocked(safeReadJson);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateTaskId", () => {
  it("generates a task ID with expected format", () => {
    const id = generateTaskId();
    expect(id).toMatch(/^task_\d{6}$/);
  });
});

describe("generatePreReflection", () => {
  it("creates a valid PreReflection with required fields", () => {
    const pre = generatePreReflection(
      "task_120000",
      "Add error handling to the API client",
      ["code-quality", "testing"]
    );

    expect(pre.version).toBe(1);
    expect(pre.phase).toBe("pre");
    expect(pre.taskId).toBe("task_120000");
    expect(pre.plan).toBeInstanceOf(Array);
    expect(pre.plan.length).toBeGreaterThan(0);
    expect(pre.assumptions).toBeInstanceOf(Array);
    expect(pre.assumptions.length).toBeGreaterThan(0);
    expect(pre.confidence).toBeGreaterThan(0);
    expect(pre.confidence).toBeLessThanOrEqual(1);
    expect(pre.timestamp).toBeDefined();
    expect(pre.expectedVerification).toEqual(["lint", "typecheck", "test", "build"]);
  });

  it("includes pack-specific assumptions", () => {
    const pre = generatePreReflection(
      "task_120000",
      "Fix the broken test",
      ["code-quality", "testing"]
    );

    const assumptionText = pre.assumptions.join(" ");
    expect(assumptionText).toContain("patterns");
    expect(assumptionText).toContain("Test suite");
  });

  it("detects risks from sensitive path mentions", () => {
    const pre = generatePreReflection(
      "task_120000",
      "Update the auth middleware for token validation",
      ["security"]
    );

    expect(pre.risks).toBeDefined();
    expect(pre.risks!.length).toBeGreaterThan(0);
    expect(pre.risks!.some((r) => /auth/i.test(r.risk))).toBe(true);
  });

  it("adjusts confidence downward for risky tasks", () => {
    const safe = generatePreReflection(
      "task_1",
      "Add a button component",
      ["code-quality"]
    );
    const risky = generatePreReflection(
      "task_2",
      "Update auth middleware security token",
      ["security"]
    );

    expect(risky.confidence).toBeLessThan(safe.confidence);
  });

  it("uses add/create plan for creation tasks", () => {
    const pre = generatePreReflection(
      "task_1",
      "Create a new utility function",
      []
    );
    expect(pre.plan.some((p) => /requirements/i.test(p))).toBe(true);
  });

  it("uses fix plan for bug fix tasks", () => {
    const pre = generatePreReflection(
      "task_1",
      "Fix the null pointer bug in parser",
      []
    );
    expect(pre.plan.some((p) => /root cause/i.test(p))).toBe(true);
  });
});

describe("generatePostReflection", () => {
  const makePreReflection = (overrides?: Partial<PreReflection>): PreReflection => ({
    version: 1,
    phase: "pre",
    taskId: "task_120000",
    timestamp: "2026-03-05T12:00:00Z",
    plan: ["Implement changes", "Run verification"],
    assumptions: [
      "Existing code follows established patterns and conventions",
      "Test suite is comprehensive and passing",
      "Required dependencies are available",
    ],
    confidence: 0.7,
    expectedVerification: ["lint", "typecheck", "test", "build"],
    ...overrides,
  });

  const makeTaskState = (overrides?: Partial<TaskReflectionState>): TaskReflectionState => ({
    taskId: "task_120000",
    description: "Add error handling",
    startedAt: "2026-03-05T12:00:00Z",
    preReflection: makePreReflection(),
    verificationResults: [],
    filesModified: ["src/api.ts"],
    toolCallCount: 10,
    correctionCount: 0,
    ...overrides,
  });

  it("creates a successful PostReflection when no issues", () => {
    const pre = makePreReflection();
    const state = makeTaskState();

    const post = generatePostReflection(pre, state);

    expect(post.version).toBe(1);
    expect(post.phase).toBe("post");
    expect(post.taskId).toBe("task_120000");
    expect(post.actualOutcome.success).toBe(true);
    expect(post.preReflectionRef).toBe("reflection-pre-task_120000.json");
    expect(post.assumptionsValidated!.length).toBe(3);
    expect(post.assumptionsInvalidated!.length).toBe(0);
    expect(post.confidence!).toBeGreaterThan(pre.confidence);
  });

  it("invalidates pattern assumption on lint failure", () => {
    const pre = makePreReflection();
    const state = makeTaskState({
      verificationResults: [
        { type: "lint", passed: false, timestamp: "2026-03-05T12:05:00Z" },
      ],
    });

    const post = generatePostReflection(pre, state);

    expect(post.actualOutcome.success).toBe(false);
    expect(post.actualOutcome.failureStage).toBe("lint");
    expect(post.assumptionsInvalidated).toContain(
      "Existing code follows established patterns and conventions"
    );
    expect(post.confidence!).toBeLessThan(pre.confidence);
  });

  it("invalidates test assumption on test failure", () => {
    const pre = makePreReflection();
    const state = makeTaskState({
      verificationResults: [
        { type: "test", passed: false, timestamp: "2026-03-05T12:05:00Z" },
      ],
    });

    const post = generatePostReflection(pre, state);

    expect(post.assumptionsInvalidated).toContain(
      "Test suite is comprehensive and passing"
    );
  });

  it("invalidates dependency assumption on build failure", () => {
    const pre = makePreReflection();
    const state = makeTaskState({
      verificationResults: [
        { type: "build", passed: false, timestamp: "2026-03-05T12:05:00Z" },
      ],
    });

    const post = generatePostReflection(pre, state);

    expect(post.assumptionsInvalidated).toContain(
      "Required dependencies are available"
    );
  });

  it("invalidates pattern assumption on user corrections", () => {
    const pre = makePreReflection();
    const state = makeTaskState({ correctionCount: 2 });

    const post = generatePostReflection(pre, state);

    expect(post.actualOutcome.success).toBe(true);
    expect(post.assumptionsInvalidated).toContain(
      "Existing code follows established patterns and conventions"
    );
  });

  it("generates next steps for failures", () => {
    const pre = makePreReflection();
    const state = makeTaskState({
      verificationResults: [
        { type: "test", passed: false, timestamp: "2026-03-05T12:05:00Z" },
      ],
    });

    const post = generatePostReflection(pre, state);

    expect(post.nextSteps).toBeDefined();
    expect(post.nextSteps!.some((s) => /test/i.test(s))).toBe(true);
  });

  it("notes high correction count in outcome", () => {
    const pre = makePreReflection();
    const state = makeTaskState({ correctionCount: 4 });

    const post = generatePostReflection(pre, state);

    expect(post.actualOutcome.summary).toContain("4 corrections");
  });

  it("clamps confidence to valid range", () => {
    const pre = makePreReflection({ confidence: 0.1 });
    const state = makeTaskState({
      verificationResults: [
        { type: "lint", passed: false, timestamp: "2026-03-05T12:05:00Z" },
      ],
      correctionCount: 5,
    });

    const post = generatePostReflection(pre, state);

    expect(post.confidence).toBeGreaterThanOrEqual(0);
    expect(post.confidence).toBeLessThanOrEqual(1);
  });
});

describe("writeReflection", () => {
  it("writes pre-reflection to correct path", () => {
    const pre: PreReflection = {
      version: 1,
      phase: "pre",
      taskId: "task_120000",
      timestamp: "2026-03-05T12:00:00Z",
      plan: ["step 1"],
      assumptions: ["assumption 1"],
      confidence: 0.7,
    };

    writeReflection("/mock/run", pre, {});

    expect(mockSafeWriteJson).toHaveBeenCalledWith(
      "/mock/run/reflection-pre-task_120000.json",
      pre,
      {}
    );
  });

  it("writes post-reflection to correct path", () => {
    const post = {
      version: 1 as const,
      phase: "post" as const,
      taskId: "task_120000",
      timestamp: "2026-03-05T12:10:00Z",
      preReflectionRef: "reflection-pre-task_120000.json",
      actualOutcome: { success: true, summary: "Done" },
    };

    writeReflection("/mock/run", post, {});

    expect(mockSafeWriteJson).toHaveBeenCalledWith(
      "/mock/run/reflection-post-task_120000.json",
      post,
      {}
    );
  });
});

describe("readPreReflection", () => {
  it("reads from correct path", () => {
    readPreReflection("/mock/run", "task_120000", {});

    expect(mockSafeReadJson).toHaveBeenCalledWith(
      "/mock/run/reflection-pre-task_120000.json",
      {}
    );
  });
});

describe("formatReflectionSummary", () => {
  it("formats a successful reflection", () => {
    const post = {
      version: 1 as const,
      phase: "post" as const,
      taskId: "task_120000",
      timestamp: "2026-03-05T12:10:00Z",
      preReflectionRef: "reflection-pre-task_120000.json",
      actualOutcome: { success: true, summary: "Task completed successfully" },
      assumptionsValidated: ["Code follows patterns"],
      assumptionsInvalidated: [],
      confidence: 0.85,
    };

    const summary = formatReflectionSummary(post);

    expect(summary).toContain("task_120000");
    expect(summary).toContain("Task completed successfully");
    expect(summary).toContain("Validated");
    expect(summary).toContain("85%");
  });

  it("formats a failed reflection with invalidated assumptions", () => {
    const post = {
      version: 1 as const,
      phase: "post" as const,
      taskId: "task_120000",
      timestamp: "2026-03-05T12:10:00Z",
      preReflectionRef: "reflection-pre-task_120000.json",
      actualOutcome: {
        success: false,
        summary: "Verification failed: lint",
        failureStage: "lint" as const,
      },
      assumptionsValidated: [],
      assumptionsInvalidated: ["Code follows patterns"],
      confidence: 0.5,
    };

    const summary = formatReflectionSummary(post);

    expect(summary).toContain("Invalidated");
    expect(summary).toContain("Code follows patterns");
    expect(summary).toContain("50%");
  });
});
