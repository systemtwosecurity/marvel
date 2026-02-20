// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { IEvalWsServer } from "../eval-ws-server.js";

/**
 * Test-specific mock types.
 *
 * MockEvalServer satisfies IEvalWsServer structurally (vi.fn() is callable,
 * matching method signatures) while also exposing mock assertion APIs.
 *
 * MockChildProcess captures only what agent-evaluator.ts actually uses
 * from Node's ChildProcess, so plain objects satisfy it without casts.
 */
interface MockEvalServer extends IEvalWsServer {
  start: Mock;
  evaluate: Mock;
  close: Mock;
}

interface MockChildProcess {
  on: Mock;
  kill: Mock;
  pid?: number;
  stdout: { on: Mock } | null;
  stderr: { on: Mock } | null;
  emit: (event: string, ...args: unknown[]) => void;
}

// --- Module mocks ---

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// vitest 4: constructor mock must use `function`, not arrow, to support `new`.
// Return type satisfies IEvalWsServer (no private fields → no cast needed).
vi.mock("../eval-ws-server.js", () => ({
  EvalWsServer: vi.fn(function (): MockEvalServer {
    return {
      start: vi.fn(),
      evaluate: vi.fn(),
      close: vi.fn(),
      isAlive: false,
      totalCostUsd: 0,
      port: 0,
      sessionId: "",
    };
  }),
}));

vi.mock("../evaluation-schemas.js", () => ({
  SECURITY_DECISION_SCHEMA: { type: "object" },
  isValidSecurityDecision: vi.fn(),
}));

vi.mock("../security-llm.js", () => ({
  escapeForPrompt: vi.fn((s: string) => s),
  logDecision: vi.fn(),
  logSuggestion: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// --- Imports (resolved to mocks after vi.mock) ---

import { analyzeWithAgent, shutdownEvalSession, warmupEvalSession } from "../agent-evaluator.js";
import { EvalWsServer } from "../eval-ws-server.js";
import { isValidSecurityDecision } from "../evaluation-schemas.js";
import { logDecision } from "../security-llm.js";
import { spawn } from "node:child_process";
import * as fs from "fs";

// --- Mock bindings ---
//
// vi.mock replaces module exports with vi.fn() at runtime, but TypeScript
// still types them as the original signatures. We re-type at the binding
// site using Mock (the actual runtime type) so all downstream usage is
// properly typed without per-call casts.

const mockEvalWsServer = vi.mocked(EvalWsServer) as unknown as Mock;
const mockSpawn = vi.mocked(spawn) as unknown as Mock;
const mockIsValid = vi.mocked(isValidSecurityDecision);
const mockLogDecision = vi.mocked(logDecision);
const mockFs = vi.mocked(fs);

// --- Helpers (zero casts) ---

function createMockServer(overrides: Partial<MockEvalServer> = {}): MockEvalServer {
  const mockServer: MockEvalServer = {
    start: vi.fn().mockResolvedValue(12345),
    evaluate: vi.fn(),
    close: vi.fn(),
    isAlive: true,
    totalCostUsd: 0,
    port: 12345,
    sessionId: "",
    ...overrides,
  };

  mockEvalWsServer.mockImplementation(function () { return mockServer; });
  return mockServer;
}

function createMockProcess(): MockChildProcess {
  const events = new Map<string, ((...args: unknown[]) => void)[]>();
  const mockProcess: MockChildProcess = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(handler);
      return mockProcess;
    }),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    emit: (event: string, ...args: unknown[]) => {
      const handlers = events.get(event) || [];
      for (const h of handlers) h(...args);
    },
  };
  mockSpawn.mockReturnValue(mockProcess);
  return mockProcess;
}

// --- Tests ---

beforeEach(async () => {
  vi.clearAllMocks();
  await shutdownEvalSession();
  mockFs.existsSync.mockReturnValue(false);
});

describe("analyzeWithAgent", () => {
  it("returns ask when config disabled", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        marvel_evaluation: {
          agent_evaluator: { enabled: false },
        },
      })
    );

    const result = await analyzeWithAgent("pnpm build");
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("disabled");
  });

  it("returns ask when server start fails", async () => {
    mockEvalWsServer.mockImplementation(function (): MockEvalServer {
      return {
        start: vi.fn().mockRejectedValue(new Error("Port in use")),
        evaluate: vi.fn(),
        close: vi.fn(),
        isAlive: false,
        totalCostUsd: 0,
        port: 0,
        sessionId: "",
      };
    });

    createMockProcess();

    const result = await analyzeWithAgent("pnpm test");
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("failed");
  });

  it("returns allow decision from successful agent evaluation", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "allow",
        reasoning: "Standard build command",
        confidence: 0.95,
        investigated: [],
      },
      costUsd: 0.005,
      durationMs: 1200,
      numTurns: 1,
    });

    mockIsValid.mockReturnValue(true);

    const result = await analyzeWithAgent("pnpm build", "Build the project");
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("Standard build command");
    expect(mockLogDecision).toHaveBeenCalled();

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({
        cwd: expect.any(String),
        env: expect.objectContaining({
          MARVEL_SECURITY_EVAL: "1",
          CLAUDE_PROJECT_DIR: "",
        }),
      })
    );
  });

  it("returns deny decision from agent evaluation", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "deny",
        reasoning: "Destructive command",
        confidence: 0.99,
        investigated: ["/etc/passwd"],
      },
      costUsd: 0.008,
      durationMs: 2000,
      numTurns: 2,
    });

    mockIsValid.mockReturnValue(true);

    const result = await analyzeWithAgent("rm -rf /");
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("Destructive command");
  });

  it("converts low-confidence deny to ask", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "deny",
        reasoning: "Might be dangerous",
        confidence: 0.6,
        investigated: [],
      },
      costUsd: 0.005,
      durationMs: 1500,
      numTurns: 1,
    });

    mockIsValid.mockReturnValue(true);

    const result = await analyzeWithAgent("rm temp-file.txt");
    expect(result.decision).toBe("ask");
    expect(result.reason).toBe("Might be dangerous");
  });

  it("does not convert high-confidence deny to ask", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "deny",
        reasoning: "Definitely dangerous",
        confidence: 0.95,
        investigated: [],
      },
      costUsd: 0.005,
      durationMs: 1500,
      numTurns: 1,
    });

    mockIsValid.mockReturnValue(true);

    const result = await analyzeWithAgent("rm -rf /");
    expect(result.decision).toBe("deny");
  });

  it("returns ask when evaluation times out", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockRejectedValue(new Error("Evaluation timeout"));

    const result = await analyzeWithAgent("some-command");
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("failed");
  });

  it("returns ask when structured output is invalid", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: { decision: "invalid", reasoning: 42 },
      costUsd: 0.005,
      durationMs: 1000,
      numTurns: 1,
    });

    mockIsValid.mockReturnValue(false);

    const result = await analyzeWithAgent("some-command");
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("failed");
  });

  it("returns ask when cost cap exceeded", async () => {
    const freshServer = createMockServer();
    createMockProcess();

    freshServer.evaluate.mockResolvedValue({
      decision: {
        decision: "allow",
        reasoning: "OK",
        confidence: 0.9,
        investigated: [],
      },
      costUsd: 0.005,
      durationMs: 1000,
      numTurns: 1,
    });
    mockIsValid.mockReturnValue(true);

    // First call initializes the session
    await analyzeWithAgent("echo hi");

    // Now set the cost over limit
    Object.defineProperty(freshServer, "totalCostUsd", { value: 0.55, writable: true });

    const result = await analyzeWithAgent("echo hello");
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("cost cap");
  });

  it("reuses existing session for second evaluation", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "allow",
        reasoning: "Safe command",
        confidence: 0.9,
        investigated: [],
      },
      costUsd: 0.005,
      durationMs: 1000,
      numTurns: 1,
    });

    mockIsValid.mockReturnValue(true);

    await analyzeWithAgent("pnpm build");
    await analyzeWithAgent("pnpm test");

    expect(mockEvalWsServer).toHaveBeenCalledTimes(1);
    expect(mockServer.evaluate).toHaveBeenCalledTimes(2);
  });

  it("includes suggested_rule in result when present", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "allow",
        reasoning: "Standard git command",
        confidence: 0.95,
        investigated: [],
        suggested_rule: {
          type: "prefix",
          pattern: "git status",
          reason: "Read-only git command",
        },
      },
      costUsd: 0.005,
      durationMs: 1000,
      numTurns: 1,
    });

    mockIsValid.mockReturnValue(true);

    const result = await analyzeWithAgent("git status");
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions?.allow).toEqual([
      { pattern: "git status", reason: "Read-only git command" },
    ]);
    // suggestedRule must flow through for the learning pipeline
    expect(result.suggestedRule).toEqual({
      type: "prefix",
      pattern: "git status",
      reason: "Read-only git command",
    });
  });
});

describe("shutdownEvalSession", () => {
  it("cleans up without errors when no session exists", async () => {
    await expect(shutdownEvalSession()).resolves.toBeUndefined();
  });

  it("cleans up server and process", async () => {
    const mockServer = createMockServer();
    const mockProcess = createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "allow",
        reasoning: "OK",
        confidence: 0.9,
        investigated: [],
      },
      costUsd: 0.005,
      durationMs: 1000,
      numTurns: 1,
    });

    mockIsValid.mockReturnValue(true);

    await analyzeWithAgent("echo test");
    await shutdownEvalSession();

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("warmupEvalSession", () => {
  it("pre-warms the evaluation session", async () => {
    const mockServer = createMockServer();
    createMockProcess();

    warmupEvalSession();

    // Warmup runs inside the eval lock — drive it forward with a subsequent lock entry
    await analyzeWithAgent("echo test").catch(() => {});

    // EvalWsServer constructor should have been called by warmup
    expect(mockEvalWsServer).toHaveBeenCalled();
    expect(mockServer.start).toHaveBeenCalled();
  });

  it("shutdown awaits in-flight warmup", async () => {
    createMockServer();
    createMockProcess();

    warmupEvalSession();
    // Shutdown should not throw even with warmup in flight
    await expect(shutdownEvalSession()).resolves.toBeUndefined();
  });
});

describe("session resume", () => {
  it("passes --resume flag after successful evaluation", async () => {
    const mockServer = createMockServer({ sessionId: "sess-abc-123" });
    createMockProcess();

    mockServer.evaluate.mockResolvedValue({
      decision: {
        decision: "allow",
        reasoning: "Safe",
        confidence: 0.9,
        investigated: [],
      },
      costUsd: 0.005,
      durationMs: 1000,
      numTurns: 1,
    });
    mockIsValid.mockReturnValue(true);

    // First evaluation captures sessionId
    await analyzeWithAgent("echo hi");

    // Force session to be re-created (simulate idle death)
    Object.defineProperty(mockServer, "isAlive", { value: false, writable: true });

    // Second eval triggers initSession which should use --resume
    await analyzeWithAgent("echo hello");

    // Find the spawn call that includes --resume
    const spawnCalls = mockSpawn.mock.calls;
    const resumeCall = spawnCalls.find(
      (call: unknown[]) => (call[1] as string[]).includes("--resume")
    );
    expect(resumeCall).toBeDefined();
    expect((resumeCall![1] as string[])).toContain("sess-abc-123");
  });
});