// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs before importing module under test
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue("{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

vi.mock("../paths.js", () => ({
  getTempDir: vi.fn().mockReturnValue("/mock/tmp/mhd-501"),
}));

vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
}));

import * as fs from "fs";
import {
  detectPreCommitCheck,
  recordPreCommitSuccess,
  checkPreCommitRequirements,
  checkMergeRequirements,
  resetPreCommitStatus,
  invalidatePreCommitChecks,
  loadSessionState,
  saveSessionState,
  type SessionState,
} from "../session-state.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);

function makeSessionState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: "test-session-123",
    startedAt: new Date().toISOString(),
    preCommit: {
      lintPassed: false,
      testPassed: false,
      buildPassed: false,
      typecheckPassed: false,
    },
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

let savedEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_SESSION_ID = "test-session-123";
  // Default: no existing state file
  mockExistsSync.mockReturnValue(false);
});

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env.CLAUDE_SESSION_ID;
  } else {
    process.env.CLAUDE_SESSION_ID = savedEnv;
  }
});

describe("detectPreCommitCheck", () => {
  it("detects lint commands", () => {
    expect(detectPreCommitCheck("pnpm lint")).toBe("lint");
    expect(detectPreCommitCheck("pnpm lint:all")).toBe("lint");
    expect(detectPreCommitCheck("pnpm eslint")).toBe("lint");
    expect(detectPreCommitCheck("pnpm run lint")).toBe("lint");
    expect(detectPreCommitCheck("pnpm run lint:all")).toBe("lint");
  });

  it("detects test commands", () => {
    expect(detectPreCommitCheck("pnpm test")).toBe("test");
    expect(detectPreCommitCheck("pnpm vitest")).toBe("test");
    expect(detectPreCommitCheck("pnpm jest")).toBe("test");
    expect(detectPreCommitCheck("pnpm run test")).toBe("test");
  });

  it("detects build commands", () => {
    expect(detectPreCommitCheck("pnpm build:all")).toBe("build");
    expect(detectPreCommitCheck("pnpm build:web")).toBe("build");
    expect(detectPreCommitCheck("pnpm build:backend")).toBe("build");
    expect(detectPreCommitCheck("pnpm build:shared")).toBe("build");
  });

  it("detects typecheck commands", () => {
    expect(detectPreCommitCheck("pnpm typecheck")).toBe("typecheck");
    expect(detectPreCommitCheck("pnpm typecheck:all")).toBe("typecheck");
    expect(detectPreCommitCheck("pnpm tsc")).toBe("typecheck");
    expect(detectPreCommitCheck("pnpm run typecheck")).toBe("typecheck");
    expect(detectPreCommitCheck("pnpm run typecheck:all")).toBe("typecheck");
  });

  it("rejects non-matching commands", () => {
    expect(detectPreCommitCheck("pnpm dev")).toBeNull();
    expect(detectPreCommitCheck("pnpm install")).toBeNull();
    expect(detectPreCommitCheck("git commit")).toBeNull();
    expect(detectPreCommitCheck("npm lint")).toBeNull();
    expect(detectPreCommitCheck("pnpm build")).toBeNull(); // bare build does NOT count
    expect(detectPreCommitCheck("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(detectPreCommitCheck("  pnpm lint  ")).toBe("lint");
    expect(detectPreCommitCheck("\tpnpm test")).toBe("test");
  });
});

describe("recordPreCommitSuccess", () => {
  it("records lint success and writes state", () => {
    const result = recordPreCommitSuccess("pnpm lint");
    expect(result).toBe("lint");
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1] as string
    ) as SessionState;
    expect(writtenJson.preCommit.lintPassed).toBe(true);
    expect(writtenJson.preCommit.lintTimestamp).toBeDefined();
  });

  it("records typecheck success", () => {
    const result = recordPreCommitSuccess("pnpm typecheck");
    expect(result).toBe("typecheck");

    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1] as string
    ) as SessionState;
    expect(writtenJson.preCommit.typecheckPassed).toBe(true);
  });

  it("records test success", () => {
    const result = recordPreCommitSuccess("pnpm test");
    expect(result).toBe("test");

    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1] as string
    ) as SessionState;
    expect(writtenJson.preCommit.testPassed).toBe(true);
  });

  it("returns null for non-precommit commands", () => {
    const result = recordPreCommitSuccess("pnpm dev");
    expect(result).toBeNull();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("checkPreCommitRequirements", () => {
  it("returns ready when lint and typecheck pass", () => {
    const state = makeSessionState({
      preCommit: {
        lintPassed: true,
        lintTimestamp: new Date().toISOString(),
        testPassed: false,
        buildPassed: false,
        typecheckPassed: true,
        typecheckTimestamp: new Date().toISOString(),
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    const result = checkPreCommitRequirements();
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("returns missing when lint has not passed", () => {
    const state = makeSessionState({
      preCommit: {
        lintPassed: false,
        testPassed: false,
        buildPassed: false,
        typecheckPassed: true,
        typecheckTimestamp: new Date().toISOString(),
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    const result = checkPreCommitRequirements();
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("lint");
  });

  it("returns missing when neither lint nor typecheck passed", () => {
    // Default fresh state — nothing has passed
    const result = checkPreCommitRequirements();
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("lint");
    expect(result.missing).toContain("typecheck");
  });
});

describe("checkMergeRequirements", () => {
  it("returns ready when lint, typecheck, and test pass", () => {
    const state = makeSessionState({
      preCommit: {
        lintPassed: true,
        lintTimestamp: new Date().toISOString(),
        testPassed: true,
        testTimestamp: new Date().toISOString(),
        buildPassed: false,
        typecheckPassed: true,
        typecheckTimestamp: new Date().toISOString(),
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    const result = checkMergeRequirements();
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("reports test as missing even when lint and typecheck pass", () => {
    const state = makeSessionState({
      preCommit: {
        lintPassed: true,
        lintTimestamp: new Date().toISOString(),
        testPassed: false,
        buildPassed: false,
        typecheckPassed: true,
        typecheckTimestamp: new Date().toISOString(),
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    const result = checkMergeRequirements();
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("test");
    expect(result.missing).not.toContain("lint");
    expect(result.missing).not.toContain("typecheck");
  });

  it("reports all missing when nothing has passed", () => {
    const result = checkMergeRequirements();
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("lint");
    expect(result.missing).toContain("typecheck");
    expect(result.missing).toContain("test");
  });
});

describe("resetPreCommitStatus", () => {
  it("clears all flags", () => {
    const state = makeSessionState({
      preCommit: {
        lintPassed: true,
        lintTimestamp: new Date().toISOString(),
        testPassed: true,
        testTimestamp: new Date().toISOString(),
        buildPassed: true,
        buildTimestamp: new Date().toISOString(),
        typecheckPassed: true,
        typecheckTimestamp: new Date().toISOString(),
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    resetPreCommitStatus();

    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1] as string
    ) as SessionState;
    expect(writtenJson.preCommit.lintPassed).toBe(false);
    expect(writtenJson.preCommit.testPassed).toBe(false);
    expect(writtenJson.preCommit.buildPassed).toBe(false);
    expect(writtenJson.preCommit.typecheckPassed).toBe(false);
  });
});

describe("invalidatePreCommitChecks", () => {
  it("clears specified checks only", () => {
    const state = makeSessionState({
      preCommit: {
        lintPassed: true,
        lintTimestamp: new Date().toISOString(),
        testPassed: true,
        testTimestamp: new Date().toISOString(),
        buildPassed: true,
        buildTimestamp: new Date().toISOString(),
        typecheckPassed: true,
        typecheckTimestamp: new Date().toISOString(),
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    invalidatePreCommitChecks(["lint", "typecheck", "test"]);

    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1] as string
    ) as SessionState;
    expect(writtenJson.preCommit.lintPassed).toBe(false);
    expect(writtenJson.preCommit.typecheckPassed).toBe(false);
    expect(writtenJson.preCommit.testPassed).toBe(false);
    // build was not invalidated
    expect(writtenJson.preCommit.buildPassed).toBe(true);
  });
});

describe("session ID from environment", () => {
  it("uses CLAUDE_SESSION_ID when set", () => {
    process.env.CLAUDE_SESSION_ID = "my-real-session";

    const state = loadSessionState();
    expect(state.sessionId).toBe("my-real-session");
  });

  it("falls back to 'unknown' when CLAUDE_SESSION_ID is not set", () => {
    delete process.env.CLAUDE_SESSION_ID;

    const state = loadSessionState();
    expect(state.sessionId).toBe("unknown");
  });

  it("prefers context.sessionId over process.env.CLAUDE_SESSION_ID", () => {
    process.env.CLAUDE_SESSION_ID = "env-session";

    const state = loadSessionState({ sessionId: "context-session" });
    expect(state.sessionId).toBe("context-session");
  });

  it("uses process.env when context has no sessionId", () => {
    process.env.CLAUDE_SESSION_ID = "env-session";

    const state = loadSessionState({ hookType: "test" });
    expect(state.sessionId).toBe("env-session");
  });
});

describe("cross-session isolation", () => {
  it("different session IDs produce different file paths", () => {
    process.env.CLAUDE_SESSION_ID = "session-aaa";
    recordPreCommitSuccess("pnpm lint");
    const firstPath = mockWriteFileSync.mock.calls[0][0] as string;

    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);

    process.env.CLAUDE_SESSION_ID = "session-bbb";
    recordPreCommitSuccess("pnpm lint");
    const secondPath = mockWriteFileSync.mock.calls[0][0] as string;

    expect(firstPath).not.toBe(secondPath);
    expect(firstPath).toContain("session-aaa");
    expect(secondPath).toContain("session-bbb");
  });

  it("does not load state from a different session", () => {
    const stateA = makeSessionState({ sessionId: "session-aaa" });
    process.env.CLAUDE_SESSION_ID = "session-bbb";

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(stateA));

    const loaded = loadSessionState();
    // Session ID mismatch — should create fresh state, not reuse stateA
    expect(loaded.sessionId).toBe("session-bbb");
    expect(loaded.preCommit.lintPassed).toBe(false);
  });
});

describe("saveSessionState", () => {
  it("writes JSON with mode 0o600", () => {
    const state = makeSessionState();
    saveSessionState(state);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, , options] = mockWriteFileSync.mock.calls[0];
    expect(options).toEqual({ mode: 0o600 });
  });

  it("updates lastUpdated timestamp", () => {
    const state = makeSessionState({ lastUpdated: "2020-01-01T00:00:00.000Z" });
    saveSessionState(state);

    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1] as string
    ) as SessionState;
    expect(writtenJson.lastUpdated).not.toBe("2020-01-01T00:00:00.000Z");
  });
});