// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PostToolUseFailureHookInput } from "../../sdk-types.js";
import type { RunState } from "../../types.js";

vi.mock("../../lib/paths.js", () => ({
  findRunDir: vi.fn(),
  findMarvelRoot: vi.fn(),
}));

vi.mock("../../lib/file-ops.js", () => ({
  safeReadJson: vi.fn(),
  safeWriteJson: vi.fn().mockReturnValue(true),
  safeAppendFile: vi.fn().mockReturnValue(true),
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

import { handlePostToolUseFailure } from "../post-tool-use-failure.js";
import { findRunDir } from "../../lib/paths.js";
import { safeReadJson, safeWriteJson, safeAppendFile } from "../../lib/file-ops.js";

const mockFindRunDir = vi.mocked(findRunDir);
const mockSafeReadJson = vi.mocked(safeReadJson);
const mockSafeWriteJson = vi.mocked(safeWriteJson);
const mockSafeAppendFile = vi.mocked(safeAppendFile);

// Helper to create partial inputs with SDK type cast
function input(partial: Record<string, unknown>): PostToolUseFailureHookInput {
  return partial as unknown as PostToolUseFailureHookInput;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handlePostToolUseFailure", () => {
  it("appends to tool_calls.jsonl with success: false", async () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue({
      runId: "run_123",
      startedAt: new Date().toISOString(),
      activePacks: [],
      toolCallCount: 5,
      correctionCount: 0,
      recentActivity: [],
    } satisfies RunState);

    await handlePostToolUseFailure(input({
      tool_name: "Bash",
      tool_input: { command: "pnpm build" },
    }));

    expect(mockSafeAppendFile).toHaveBeenCalledOnce();
    const appendCall = mockSafeAppendFile.mock.calls[0];
    expect(appendCall[0]).toBe("/mock/run/dir/tool_calls.jsonl");
    const record = JSON.parse(appendCall[1].trim());
    expect(record.success).toBe(false);
    expect(record.tool).toBe("Bash");
    expect(record.sequence).toBe(6);
  });

  it("increments toolCallCount", async () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue({
      runId: "run_123",
      startedAt: new Date().toISOString(),
      activePacks: [],
      toolCallCount: 3,
      correctionCount: 0,
      recentActivity: [],
    } satisfies RunState);

    await handlePostToolUseFailure(input({
      tool_name: "Edit",
      tool_input: { file_path: "/src/app.ts" },
    }));

    const writeCall = mockSafeWriteJson.mock.calls[0];
    const updatedState = writeCall[1] as RunState;
    expect(updatedState.toolCallCount).toBe(4);
  });

  it("appends tool_failure to recentActivity", async () => {
    mockFindRunDir.mockReturnValue("/mock/run/dir");
    mockSafeReadJson.mockReturnValue({
      runId: "run_123",
      startedAt: new Date().toISOString(),
      activePacks: [],
      toolCallCount: 0,
      correctionCount: 0,
      recentActivity: [],
    } satisfies RunState);

    await handlePostToolUseFailure(input({
      tool_name: "Write",
      tool_input: { file_path: "/src/lib.ts" },
    }));

    const writeCall = mockSafeWriteJson.mock.calls[0];
    const updatedState = writeCall[1] as RunState;
    expect(updatedState.recentActivity).toHaveLength(1);
    expect(updatedState.recentActivity[0].type).toBe("tool_failure");
    expect(updatedState.recentActivity[0].data.tool).toBe("Write");
  });

  it("handles missing tool_name gracefully", async () => {
    const result = await handlePostToolUseFailure(input({}));
    expect(result).toEqual({});
    expect(mockSafeAppendFile).not.toHaveBeenCalled();
  });

  it("handles missing run dir gracefully", async () => {
    mockFindRunDir.mockReturnValue(null);

    const result = await handlePostToolUseFailure(input({ tool_name: "Bash" }));
    expect(result).toEqual({});
    expect(mockSafeAppendFile).not.toHaveBeenCalled();
  });
});