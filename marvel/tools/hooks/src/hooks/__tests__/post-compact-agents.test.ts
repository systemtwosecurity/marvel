// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BaseHookInput } from "../../sdk-types.js";
import type { SerializedAgentState, AgentEntry } from "../../lib/agent-registry.js";

vi.mock("../../lib/agent-registry.js", () => ({
  getSessionAgents: vi.fn(),
  getTeamState: vi.fn(),
}));

vi.mock("../../lib/paths.js", () => ({
  getTempDir: vi.fn().mockReturnValue("/tmp/mhd-501"),
  findRunDir: vi.fn(),
  findMarvelRoot: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  buildHookContext: vi.fn().mockReturnValue({ hookType: "post-compact-agents" }),
  generateRequestId: vi.fn().mockReturnValue("req_test"),
}));

vi.mock("../../lib/file-ops.js", () => ({
  safeReadJson: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    unlinkSync: vi.fn(),
  };
});

import { handlePostCompactAgents } from "../post-compact-agents.js";
import { getSessionAgents, getTeamState } from "../../lib/agent-registry.js";
import { safeReadJson } from "../../lib/file-ops.js";
import * as fs from "fs";

const mockGetSessionAgents = vi.mocked(getSessionAgents);
const mockGetTeamState = vi.mocked(getTeamState);
const mockSafeReadJson = vi.mocked(safeReadJson);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);

function makeInput(sessionId: string): BaseHookInput {
  return {
    session_id: sessionId,
    transcript_path: "/tmp/transcript",
    cwd: "/project",
  } as BaseHookInput;
}

function makeAgent(overrides?: Partial<AgentEntry>): AgentEntry {
  return {
    id: "agent-1",
    agentType: "Plan",
    sessionId: "sess-1",
    status: "running",
    launchTime: new Date().toISOString(),
    resultSummary: null,
    errorMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionAgents.mockReturnValue([]);
  mockGetTeamState.mockReturnValue(null);
  mockSafeReadJson.mockReturnValue(null);
});

describe("handlePostCompactAgents", () => {
  it("returns {} when no agents in registry or file", async () => {
    const result = await handlePostCompactAgents(makeInput("sess-1"));
    expect(result).toEqual({});
  });

  it("returns {} when no session_id in input", async () => {
    const result = await handlePostCompactAgents({} as BaseHookInput);
    expect(result).toEqual({});
  });

  it("injects context from daemon registry (primary path)", async () => {
    mockGetSessionAgents.mockReturnValue([
      makeAgent({ id: "agent-a", status: "completed", resultSummary: "Found 3 approaches" }),
      makeAgent({ id: "agent-b", status: "running" }),
    ]);

    const result = await handlePostCompactAgents(makeInput("sess-1"));

    expect(result.hookSpecificOutput).toBeDefined();
    const ctx = (result as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("agent-a");
    expect(ctx).toContain("completed");
    expect(ctx).toContain("Found 3 approaches");
    expect(ctx).toContain("agent-b");
    expect(ctx).toContain("running");
    expect(ctx).toContain("TaskOutput");
  });

  it("falls back to temp file when registry empty", async () => {
    mockGetSessionAgents.mockReturnValue([]);
    const serialized: SerializedAgentState = {
      version: 1,
      sessionId: "sess-1",
      timestamp: new Date().toISOString(),
      agents: [makeAgent({ id: "agent-from-file", status: "running" })],
      teamState: null,
    };
    mockSafeReadJson.mockReturnValue(serialized);

    const result = await handlePostCompactAgents(makeInput("sess-1"));

    const ctx = (result as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("agent-from-file");
  });

  it("handles malformed temp file gracefully", async () => {
    mockGetSessionAgents.mockReturnValue([]);
    // Return object missing required fields
    mockSafeReadJson.mockReturnValue({ bad: "data" });

    const result = await handlePostCompactAgents(makeInput("sess-1"));
    expect(result).toEqual({});
  });

  it("cleans up temp file after processing", async () => {
    mockGetSessionAgents.mockReturnValue([makeAgent()]);
    mockExistsSync.mockReturnValue(true);

    await handlePostCompactAgents(makeInput("sess-1"));

    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("agents-sess-1.json"),
    );
  });

  it("includes team state when present", async () => {
    mockGetSessionAgents.mockReturnValue([makeAgent()]);
    mockGetTeamState.mockReturnValue({
      name: "my-team",
      members: [{ teammateName: "alice", teamName: "my-team", firstSeen: new Date().toISOString() }],
    });

    const result = await handlePostCompactAgents(makeInput("sess-1"));

    const ctx = (result as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("my-team");
  });

  it("includes errored agent info", async () => {
    mockGetSessionAgents.mockReturnValue([
      makeAgent({ id: "agent-err", status: "errored", errorMessage: "Connection timeout" }),
    ]);

    const result = await handlePostCompactAgents(makeInput("sess-1"));

    const ctx = (result as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("errored");
    expect(ctx).toContain("Connection timeout");
  });

  it("respects token budget for 10 agents", async () => {
    const agents = Array.from({ length: 10 }, (_, i) =>
      makeAgent({
        id: `agent-${i}`,
        agentType: "Plan",
        status: "completed",
        resultSummary: `Result for agent ${i} with a reasonably long description of findings`,
      }),
    );
    mockGetSessionAgents.mockReturnValue(agents);

    const result = await handlePostCompactAgents(makeInput("sess-1"));

    const ctx = (result as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeLessThanOrEqual(2000);
  });
});
