// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunState } from "../../types.js";
import type { UserPromptSubmitHookSpecificOutput } from "../../sdk-types.js";

// Mock dependencies before importing the module under test
vi.mock("../paths.js", () => ({
  findRunDir: vi.fn(),
  findMarvelRoot: vi.fn(),
}));

vi.mock("../file-ops.js", () => ({
  safeReadJson: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue("12345"),
  };
});

import { compileMarvelStatus } from "../marvel-status.js";
import { findRunDir } from "../paths.js";
import { safeReadJson } from "../file-ops.js";
import type { LogContext } from "../logger.js";

const mockFindRunDir = vi.mocked(findRunDir);
const mockSafeReadJson = vi.mocked(safeReadJson);

const context: LogContext = { hookType: "user-prompt-submit" };

function getStatusContext(result: ReturnType<typeof compileMarvelStatus>): string | undefined {
  return (result.hookSpecificOutput as UserPromptSubmitHookSpecificOutput | undefined)?.additionalContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("compileMarvelStatus", () => {
  it("returns hookSpecificOutput with <marvel-status> wrapper", () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue({
      runId: "run_123",
      startedAt: new Date().toISOString(),
      activePacks: ["pack-a"],
      toolCallCount: 5,
      correctionCount: 1,
      recentActivity: [],
    } satisfies RunState);

    const result = compileMarvelStatus(context);
    const ctx = getStatusContext(result);

    expect(ctx).toBeDefined();
    expect(ctx).toContain("<marvel-status>");
    expect(ctx).toContain("</marvel-status>");
  });

  it("includes run ID and tool call count", () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue({
      runId: "run_abc",
      startedAt: new Date().toISOString(),
      activePacks: [],
      toolCallCount: 42,
      correctionCount: 3,
      recentActivity: [],
    } satisfies RunState);

    const result = compileMarvelStatus(context);
    const ctx = getStatusContext(result);

    expect(ctx).toContain("run_abc");
    expect(ctx).toContain("Tool calls: 42");
    expect(ctx).toContain("Corrections: 3");
  });

  it("includes active pack count and names", () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue({
      runId: "run_packs",
      startedAt: new Date().toISOString(),
      activePacks: ["code-standards", "ui-patterns"],
      toolCallCount: 0,
      correctionCount: 0,
      recentActivity: [],
    } satisfies RunState);

    const result = compileMarvelStatus(context);
    const ctx = getStatusContext(result);

    expect(ctx).toContain("Active packs: 2");
    expect(ctx).toContain("code-standards");
    expect(ctx).toContain("ui-patterns");
  });

  it("handles missing run dir gracefully", () => {
    mockFindRunDir.mockReturnValue(null);

    const result = compileMarvelStatus(context);
    const ctx = getStatusContext(result);

    expect(ctx).toContain("Run directory: not found");
  });

  it("handles missing run state gracefully", () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue(null);

    const result = compileMarvelStatus(context);
    const ctx = getStatusContext(result);

    expect(ctx).toContain("Run state: not found");
  });

  it("includes duration", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue({
      runId: "run_dur",
      startedAt: fiveMinAgo,
      activePacks: [],
      toolCallCount: 0,
      correctionCount: 0,
      recentActivity: [],
    } satisfies RunState);

    const result = compileMarvelStatus(context);
    const ctx = getStatusContext(result);

    expect(ctx).toContain("Duration: 5m");
  });
});