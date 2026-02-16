// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
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

import {
  handleSubagentStart,
  handleSubagentStop,
  handleNotification,
  handleTeammateIdle,
  handleTaskCompleted,
} from "../lifecycle-hooks.js";
import { findRunDir } from "../../lib/paths.js";
import { safeReadJson, safeWriteJson } from "../../lib/file-ops.js";

const mockFindRunDir = vi.mocked(findRunDir);
const mockSafeReadJson = vi.mocked(safeReadJson);
const mockSafeWriteJson = vi.mocked(safeWriteJson);

function makeRunState(overrides?: Partial<RunState>): RunState {
  return {
    runId: "run_test",
    startedAt: new Date().toISOString(),
    activePacks: [],
    toolCallCount: 0,
    correctionCount: 0,
    recentActivity: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lifecycle hooks", () => {
  // Each handler accepts its specific SDK type, but for testing we pass
  // minimal objects via `as any` since only `logActivity` internals matter.
  const handlers = [
    { name: "handleSubagentStart", fn: handleSubagentStart, type: "subagent_start" },
    { name: "handleSubagentStop", fn: handleSubagentStop, type: "subagent_stop" },
    { name: "handleNotification", fn: handleNotification, type: "notification" },
    { name: "handleTeammateIdle", fn: handleTeammateIdle, type: "teammate_idle" },
    { name: "handleTaskCompleted", fn: handleTaskCompleted, type: "task_completed" },
  ] as const;

  for (const { name, fn, type } of handlers) {
    describe(name, () => {
      it(`appends ${type} to recentActivity`, async () => {
        mockFindRunDir.mockReturnValue("/mock/run/dir");
        mockSafeReadJson.mockReturnValue(makeRunState());

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (fn as any)({});

        expect(result).toEqual({});
        expect(mockSafeWriteJson).toHaveBeenCalledOnce();
        const writeCall = mockSafeWriteJson.mock.calls[0];
        const updatedState = writeCall[1] as RunState;
        expect(updatedState.recentActivity).toHaveLength(1);
        expect(updatedState.recentActivity[0].type).toBe(type);
      });

      it("returns {} when run dir not found", async () => {
        mockFindRunDir.mockReturnValue(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (fn as any)({});
        expect(result).toEqual({});
        expect(mockSafeWriteJson).not.toHaveBeenCalled();
      });

      it("returns {} when run state not found", async () => {
        mockFindRunDir.mockReturnValue("/mock/run/dir");
        mockSafeReadJson.mockReturnValue(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (fn as any)({});
        expect(result).toEqual({});
        expect(mockSafeWriteJson).not.toHaveBeenCalled();
      });
    });
  }

  it("caps recentActivity at 20 entries", async () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    const existing = Array.from({ length: 20 }, (_, i) => ({
      type: "tool_call" as const,
      timestamp: new Date().toISOString(),
      data: { seq: i },
    }));
    mockSafeReadJson.mockReturnValue(makeRunState({ recentActivity: existing }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (handleSubagentStart as any)({});

    const writeCall = mockSafeWriteJson.mock.calls[0];
    const updatedState = writeCall[1] as RunState;
    expect(updatedState.recentActivity).toHaveLength(20);
    expect(updatedState.recentActivity[19].type).toBe("subagent_start");
  });
});