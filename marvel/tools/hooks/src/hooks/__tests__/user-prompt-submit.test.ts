// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserPromptSubmitHookInput, SyncHookJSONOutput, UserPromptSubmitHookSpecificOutput } from "../../sdk-types.js";

vi.mock("../../lib/paths.js", () => ({
  findRunDir: vi.fn().mockReturnValue("/mock/run/dir"),
  findMarvelRoot: vi.fn(),
}));

vi.mock("../../lib/file-ops.js", () => ({
  safeReadJson: vi.fn().mockReturnValue(null),
  safeWriteJson: vi.fn().mockReturnValue(true),
  safeAppendFile: vi.fn().mockReturnValue(true),
}));

vi.mock("../../lib/guidance.js", () => ({
  detectGuidanceType: vi.fn().mockReturnValue("unknown"),
  detectCategory: vi.fn().mockReturnValue("general"),
}));

vi.mock("../../lib/redact.js", () => ({
  redactSensitive: vi.fn((s: string) => s),
}));

vi.mock("../../lib/marvel-status.js", () => ({
  compileMarvelStatus: vi.fn().mockReturnValue({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: "<marvel-status>mock status</marvel-status>",
    },
  } satisfies SyncHookJSONOutput),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(""),
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

import { handleUserPromptSubmit } from "../user-prompt-submit.js";
import { compileMarvelStatus } from "../../lib/marvel-status.js";
import { safeReadJson, safeAppendFile } from "../../lib/file-ops.js";

const mockSafeReadJson = vi.mocked(safeReadJson);
const mockSafeAppendFile = vi.mocked(safeAppendFile);

const mockCompileMarvelStatus = vi.mocked(compileMarvelStatus);

function makeInput(prompt: string): UserPromptSubmitHookInput {
  return {
    hook_event_name: "UserPromptSubmit",
    session_id: "test-session",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    prompt,
  };
}

function getAdditionalContext(result: SyncHookJSONOutput): string | undefined {
  return (result.hookSpecificOutput as UserPromptSubmitHookSpecificOutput | undefined)?.additionalContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCompileMarvelStatus.mockReturnValue({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: "<marvel-status>mock status</marvel-status>",
    },
  });
});

describe("handleUserPromptSubmit - status detection", () => {
  it('"marvel status" triggers status output', async () => {
    const result = await handleUserPromptSubmit(makeInput("marvel status"));
    const ctx = getAdditionalContext(result);
    expect(ctx).toContain("<marvel-status>");
    expect(mockCompileMarvelStatus).toHaveBeenCalled();
  });

  it('"marvel info" triggers status output', async () => {
    const result = await handleUserPromptSubmit(makeInput("marvel info"));
    const ctx = getAdditionalContext(result);
    expect(ctx).toContain("<marvel-status>");
  });

  it('"marvel health" triggers status output', async () => {
    const result = await handleUserPromptSubmit(makeInput("marvel health"));
    const ctx = getAdditionalContext(result);
    expect(ctx).toContain("<marvel-status>");
  });

  it('"/marvel status" triggers status output', async () => {
    const result = await handleUserPromptSubmit(makeInput("/marvel status"));
    const ctx = getAdditionalContext(result);
    expect(ctx).toContain("<marvel-status>");
  });

  it('"marvel-status" triggers status output', async () => {
    const result = await handleUserPromptSubmit(makeInput("marvel-status"));
    const ctx = getAdditionalContext(result);
    expect(ctx).toContain("<marvel-status>");
  });

  it("does NOT trigger for embedded status text", async () => {
    const result = await handleUserPromptSubmit(
      makeInput("I need marvel status report for the client")
    );
    expect(mockCompileMarvelStatus).not.toHaveBeenCalled();
    expect(getAdditionalContext(result)).toBeUndefined();
  });

  it("returns {} for short prompts", async () => {
    const result = await handleUserPromptSubmit(makeInput("hi"));
    expect(result).toEqual({});
  });

  it("returns {} for normal prompts", async () => {
    const result = await handleUserPromptSubmit(
      makeInput("Please add a new component")
    );
    expect(result).toEqual({});
  });
});

describe("handleUserPromptSubmit - before/after pair capture", () => {
  it("captures preceding context from lastInjection when correction detected", async () => {
    const { detectGuidanceType } = await import("../../lib/guidance.js");
    vi.mocked(detectGuidanceType).mockReturnValue("correction");

    mockSafeReadJson.mockReturnValue({
      runId: "run_test",
      startedAt: "2026-02-12T00:00:00Z",
      activePacks: [],
      toolCallCount: 5,
      correctionCount: 0,
      recentActivity: [],
      lastInjection: {
        file: "src/app/emails/EmailsPageContent.tsx",
        packs: ["api-contracts", "async-patterns"],
        relevanceScores: [],
        lessons: ["Validate API responses"],
      },
    });

    await handleUserPromptSubmit(makeInput("No, use useQuery instead of fetch"));

    // Verify guidance was appended with preceding context
    expect(mockSafeAppendFile).toHaveBeenCalled();
    const appendedLine = mockSafeAppendFile.mock.calls[0][1] as string;
    const guidance = JSON.parse(appendedLine.trim());
    expect(guidance.preceding_file).toBe("src/app/emails/EmailsPageContent.tsx");
    expect(guidance.preceding_injections).toEqual(["api-contracts", "async-patterns"]);
    expect(guidance.preceding_tool).toBe("Edit");
  });

  it("omits preceding context when no lastInjection exists", async () => {
    const { detectGuidanceType } = await import("../../lib/guidance.js");
    vi.mocked(detectGuidanceType).mockReturnValue("correction");

    mockSafeReadJson.mockReturnValue(null);

    await handleUserPromptSubmit(makeInput("No, use useQuery instead"));

    expect(mockSafeAppendFile).toHaveBeenCalled();
    const appendedLine = mockSafeAppendFile.mock.calls[0][1] as string;
    const guidance = JSON.parse(appendedLine.trim());
    expect(guidance.preceding_file).toBeUndefined();
    expect(guidance.preceding_injections).toBeUndefined();
    expect(guidance.preceding_tool).toBeUndefined();
  });
});