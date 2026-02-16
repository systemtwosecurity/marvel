// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreCompactHookInput } from "../../sdk-types.js";
import type { RunState } from "../../types.js";

vi.mock("../../lib/paths.js", () => ({
  findRunDir: vi.fn(),
  findMarvelRoot: vi.fn(),
}));

vi.mock("../../lib/file-ops.js", () => ({
  safeReadJson: vi.fn(),
  safeWriteJson: vi.fn().mockReturnValue(true),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

import { handlePreCompact } from "../pre-compact.js";
import { findRunDir } from "../../lib/paths.js";
import { safeReadJson, safeWriteJson } from "../../lib/file-ops.js";

const mockFindRunDir = vi.mocked(findRunDir);
const mockSafeReadJson = vi.mocked(safeReadJson);
const mockSafeWriteJson = vi.mocked(safeWriteJson);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handlePreCompact", () => {
  it("creates snapshot and appends compaction event", async () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    const runState: RunState = {
      runId: "run_123",
      startedAt: new Date().toISOString(),
      activePacks: [],
      toolCallCount: 10,
      correctionCount: 0,
      recentActivity: [],
    };
    mockSafeReadJson.mockReturnValue(runState);

    const result = await handlePreCompact({} as unknown as PreCompactHookInput);

    expect(result).toEqual({
      hookSpecificOutput: {
        additionalContext: expect.stringContaining("Run ID run_123"),
      },
    });

    // Should write snapshot
    expect(mockSafeWriteJson).toHaveBeenCalledTimes(2);
    const snapshotCall = mockSafeWriteJson.mock.calls[0];
    expect(snapshotCall[0]).toMatch(/snapshot-.*\.json$/);
    expect(snapshotCall[1]).toEqual(runState);

    // Should write updated run state with compaction event
    const runStateCall = mockSafeWriteJson.mock.calls[1];
    expect(runStateCall[0]).toBe("/mock/run/dir/run.json");
    const updatedState = runStateCall[1] as RunState;
    expect(updatedState.recentActivity).toHaveLength(1);
    expect(updatedState.recentActivity[0].type).toBe("compaction");
  });

  it("handles missing run dir gracefully", async () => {
    mockFindRunDir.mockReturnValue(null);

    const result = await handlePreCompact({} as unknown as PreCompactHookInput);

    expect(result).toEqual({});
    expect(mockSafeWriteJson).not.toHaveBeenCalled();
  });

  it("handles missing run state gracefully", async () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue(null);

    const result = await handlePreCompact({} as unknown as PreCompactHookInput);

    expect(result).toEqual({});
    expect(mockSafeWriteJson).not.toHaveBeenCalled();
  });
});