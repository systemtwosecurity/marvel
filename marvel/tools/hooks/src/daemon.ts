#!/usr/bin/env node
// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0
/**
 * MARVEL Hooks Daemon
 *
 * Per-project daemon for low-latency hook invocation.
 * Keyed on CLAUDE_PROJECT_DIR hash — one daemon per project directory.
 *
 * Multi-session aware:
 *   - Tracks active session_ids in a Set
 *   - First session-start does full init; subsequent ones return cached result
 *   - session-end removes from the set; eval shutdown + daemon stop only when
 *     the last session leaves (set becomes empty)
 *   - If the daemon survives a crash and a new session connects to an empty set,
 *     the cached result is cleared and a fresh init runs
 *
 * WARNING: Do NOT use CLAUDE_CODE_SESSION_ID for daemon scoping — it is unique
 * per subagent, not inherited from parent. Using it causes a daemon-per-subagent
 * leak (discovered during testing: 73 zombie daemons from one session).
 */

import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { handleSessionStart } from "./hooks/session-start.js";
import { handleUserPromptSubmit } from "./hooks/user-prompt-submit.js";
import { handlePreToolUse, clearInjectionCache } from "./hooks/pre-tool-use.js";
import { handlePostToolUse } from "./hooks/post-tool-use.js";
import { handleStop } from "./hooks/stop.js";
import { handlePermissionRequest } from "./hooks/permission-request.js";
import { handlePreCompact } from "./hooks/pre-compact.js";
import { handlePostToolUseFailure } from "./hooks/post-tool-use-failure.js";
import { handleSubagentStart, handleSubagentStop, handleNotification, handleTeammateIdle, handleTaskCompleted } from "./hooks/lifecycle-hooks.js";
import { handlePostCompactAgents } from "./hooks/post-compact-agents.js";
import { clearSession } from "./lib/agent-registry.js";
import { shutdownEvalSession, warmupEvalSession } from "./lib/agent-evaluator.js";
import {
  buildHookContext,
  generateRequestId,
  logDebug,
  logError,
  logWarn,
} from "./lib/logger.js";
import { getTempDir } from "./lib/paths.js";
import { buildTimeoutResponse } from "./lib/timeout-response.js";
import type { SyncHookJSONOutput } from "./sdk-types.js";

// Per-daemon paths derived from daemon_id (project hash).
// Short prefixes ("p-" for files, "mhd-{uid}" for dir) keep the full socket
// path well under the macOS sun_path limit of 104 bytes.  The original
// "marvel-hooks-{uid}/marvel-hooks-project-{hash}" naming pushed paths to
// 104+ chars on macOS TMPDIR (/var/folders/…/T/) causing EINVAL on connect.
function getSocketPath(daemonId: string): string {
  return path.join(getTempDir(), `p-${daemonId}.sock`);
}

function getPidPath(daemonId: string): string {
  return path.join(getTempDir(), `p-${daemonId}.pid`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookHandler = (input: any) => SyncHookJSONOutput | Promise<SyncHookJSONOutput>;

interface HookRequest {
  hook: string;
  input: Record<string, unknown>;
  request_id?: string;
}

// ── Multi-session tracking ──────────────────────────────────────────
// The daemon is shared by all sessions in a project directory (main sessions,
// peer CLI sessions, subagents). We track active session_ids to:
//   1. Reentrancy: Only the first session-start does full init
//   2. Staleness: If activeSessions is empty when a new session-start arrives,
//      clear the cache and re-initialize (daemon survived a crash)
//   3. Shutdown: Only shut down eval when the last session leaves
const activeSessions = new Set<string>();
let sessionStartPromise: Promise<SyncHookJSONOutput> | null = null;
let sessionStartResult: SyncHookJSONOutput | null = null;

const handlers: Record<string, HookHandler> = {
  "session-start": async (input) => {
    const sid = input?.session_id as string | undefined;
    const wasEmpty = activeSessions.size === 0;
    if (sid) activeSessions.add(sid);

    // If the set was empty before this session arrived, the daemon either
    // just started or survived a previous session's crash — clear stale cache.
    if (wasEmpty && sessionStartPromise) {
      logDebug("session-start: clearing stale cache (crash recovery)", {
        hookType: "session-start",
        sessionId: sid,
      });
      sessionStartPromise = null;
      sessionStartResult = null;
    }

    if (!sessionStartPromise) {
      // First session-start — run full init. Store the promise so concurrent
      // requests can await the same initialization.
      clearInjectionCache();
      sessionStartPromise = handleSessionStart(input);
      const result = await sessionStartPromise;
      sessionStartResult = result;
      logDebug("session-start: full init (first session)", {
        hookType: "session-start",
        sessionId: sid,
      });
      // Pre-warm agent evaluation session (fire-and-forget)
      warmupEvalSession();
      return result;
    }

    // Concurrent or subsequent request — await the same promise
    // This prevents the race where concurrent requests get {} before init completes.
    if (!sessionStartResult) {
      logDebug("session-start: awaiting in-flight init", {
        hookType: "session-start",
        sessionId: sid,
      });
      return await sessionStartPromise;
    }

    // Subsequent session-start (subagent or peer) — return cached result
    logDebug("session-start: returning cached result (reentry)", {
      hookType: "session-start",
      sessionId: sid,
    });
    return sessionStartResult;
  },
  "user-prompt-submit": handleUserPromptSubmit,
  "pre-tool-use": handlePreToolUse,
  "post-tool-use": handlePostToolUse,
  stop: handleStop,
  "permission-request": handlePermissionRequest,
  "session-end": async (input) => {
    const sid = input?.session_id as string | undefined;
    if (sid) {
      activeSessions.delete(sid);
      clearSession(sid);
    }

    if (activeSessions.size === 0) {
      // Last session leaving — full cleanup + self-terminate
      logDebug("session-end: last session leaving, shutting down", {
        hookType: "session-end",
        sessionId: sid,
      });
      await shutdownEvalSession();
      sessionStartPromise = null;
      sessionStartResult = null;
      // Schedule self-termination after response is sent.
      // The 500ms delay ensures the JSON response reaches the caller (nc)
      // before the process exits and cleans up the socket.
      setTimeout(() => {
        process.kill(process.pid, "SIGTERM");
      }, 500);
    } else {
      logDebug("session-end: session leaving, daemon stays alive", {
        hookType: "session-end",
        sessionId: sid,
      });
    }
    return {};
  },
  "pre-compact": async (input) => {
    // Clear injection cache so lessons re-inject after context compaction
    clearInjectionCache();
    return handlePreCompact(input);
  },
  "post-tool-use-failure": handlePostToolUseFailure,
  "post-compact-agents": handlePostCompactAgents,
  "subagent-start": handleSubagentStart,
  "subagent-stop": handleSubagentStop,
  "notification": handleNotification,
  "teammate-idle": handleTeammateIdle,
  "task-completed": handleTaskCompleted,
};

async function handleRequest(data: string): Promise<string> {
  const fallbackRequestId = generateRequestId();
  let request: HookRequest | null = null;

  try {
    request = JSON.parse(data) as HookRequest;
  } catch (error) {
    logWarn("Failed to parse daemon request JSON", {
      requestId: fallbackRequestId,
    });
    return JSON.stringify({});
  }

  const requestId = request.request_id || fallbackRequestId;
  if (!request.hook || typeof request.hook !== "string") {
    logWarn("Daemon request missing hook type", { requestId });
    return JSON.stringify({});
  }

  const input =
    request.input && typeof request.input === "object" ? request.input : {};
  process.env.MARVEL_REQUEST_ID = requestId;

  // Session ID is passed via context (built from input.session_id by
  // buildHookContext) rather than mutating process.env, which would be
  // corrupted by concurrent async handlers interleaving.

  const context = buildHookContext(request.hook, input, { requestId });

  const handler = handlers[request.hook];
  if (!handler) {
    logWarn(`Unknown hook type: ${request.hook}`, context);
    return JSON.stringify({});
  }

  // Per-hook timeout: security hooks (pre-tool-use, permission-request) need
  // longer because they run agent evaluations (CLI spawn + Haiku thinking).
  const HANDLER_TIMEOUT_MS_DEFAULT = 9000;
  const HANDLER_TIMEOUT_MS_SECURITY = 35000; // Must exceed evaluator's 30s timeout
  const SECURITY_HOOKS = new Set(["pre-tool-use", "permission-request"]);
  const handlerTimeoutMs = SECURITY_HOOKS.has(request.hook)
    ? HANDLER_TIMEOUT_MS_SECURITY
    : HANDLER_TIMEOUT_MS_DEFAULT;

  const startTime = Date.now();
  try {
    logDebug("Daemon handling hook request", context);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const output = await Promise.race([
      Promise.resolve(handler(input)).then((result) => {
        clearTimeout(timeoutId);
        return result;
      }),
      new Promise<SyncHookJSONOutput>((resolve) => {
        timeoutId = setTimeout(() => {
          logWarn(`Handler timeout after ${handlerTimeoutMs}ms`, context);
          resolve(buildTimeoutResponse(request.hook, SECURITY_HOOKS.has(request.hook)));
        }, handlerTimeoutMs);
      }),
    ]);
    const durationMs = Date.now() - startTime;
    logDebug("Daemon handled hook request", { ...context, durationMs });
    return JSON.stringify(output || {});
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logError("Hook handler failed in daemon", error, {
      ...context,
      durationMs,
    });
    return JSON.stringify({});
  }
}

function startDaemon(daemonId: string): void {
  const socketPath = getSocketPath(daemonId);
  const pidPath = getPidPath(daemonId);

  // Guard: verify socket path fits within macOS sun_path (104 bytes incl. null)
  if (socketPath.length > 103) {
    logError(
      `Socket path too long (${socketPath.length} chars, max 103): ${socketPath}`,
      new Error("Socket path exceeds macOS sun_path limit"),
      { hookType: "daemon", daemonId },
    );
    process.exit(1);
  }

  // Remove stale socket if exists
  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (error) {
      logDebug("Failed to remove stale socket", {
        hookType: "daemon",
        daemonId,
        filePath: socketPath,
      });
    }
  }

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString();

      // Newline-delimited JSON protocol
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          const response = await handleRequest(line);
          socket.write(response + "\n");
          // Close connection after responding so nc reads the response
          // Each hook invocation opens a new connection
          socket.end();
        }
      }
    });

    socket.on("error", () => {
      // Client disconnected, ignore
    });
  });

  server.listen(socketPath, () => {
    fs.writeFileSync(pidPath, process.pid.toString(), { mode: 0o600 });
    fs.chmodSync(socketPath, 0o600);
    logDebug("Daemon listening", {
      daemonId,
      hookType: "daemon",
    });
  });

  server.on("error", (err) => {
    logError("Daemon server error", err, { daemonId, hookType: "daemon" });
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = () => {
    server.close();
    try {
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    } catch (error) {
      logDebug("Failed to clean up daemon files during shutdown", {
        hookType: "daemon",
        daemonId,
      });
    }
    logDebug("Daemon shutdown complete", { daemonId, hookType: "daemon" });
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

function stopDaemon(daemonId: string): void {
  const pidPath = getPidPath(daemonId);
  const socketPath = getSocketPath(daemonId);

  if (fs.existsSync(pidPath)) {
    try {
      const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
      process.kill(pid, "SIGTERM");
    } catch (error) {
      logDebug("Failed to kill daemon process (may already be dead)", {
        hookType: "daemon",
        daemonId,
        filePath: pidPath,
      });
    }
    try {
      fs.unlinkSync(pidPath);
    } catch (error) {
      logDebug("Failed to remove pid file", {
        hookType: "daemon",
        daemonId,
        filePath: pidPath,
      });
    }
  }

  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (error) {
      logDebug("Failed to remove socket file", {
        hookType: "daemon",
        daemonId,
        filePath: socketPath,
      });
    }
  }
}

function statusDaemon(daemonId: string): void {
  const pidPath = getPidPath(daemonId);
  const socketPath = getSocketPath(daemonId);

  if (!fs.existsSync(pidPath)) {
    console.log(`[marvel-daemon] Not running (daemon: ${daemonId})`);
    process.exit(1);
  }

  const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);

  try {
    process.kill(pid, 0); // Check if process exists
    console.log(`[marvel-daemon] Running (pid: ${pid}, daemon: ${daemonId})`);
    console.log(`[marvel-daemon] Socket: ${socketPath}`);
  } catch {
    console.log(`[marvel-daemon] Stale PID file (daemon: ${daemonId})`);
    fs.unlinkSync(pidPath);
    process.exit(1);
  }
}

// CLI
const command = process.argv[2];
const daemonId = process.argv[3];

if (!daemonId && command !== "cleanup") {
  console.error("Usage: daemon.js <start|stop|status> <daemon_id>");
  console.error("       daemon.js cleanup");
  process.exit(1);
}

switch (command) {
  case "start":
    startDaemon(daemonId);
    break;
  case "stop":
    stopDaemon(daemonId);
    break;
  case "status":
    statusDaemon(daemonId);
    break;
  case "cleanup": {
    // Clean up all stale daemons from secure temp dir (current + legacy naming)
    const tempDir = getTempDir();
    const files = fs
      .readdirSync(tempDir)
      .filter((f) => f.startsWith("p-") || f.startsWith("mhd-") || f.startsWith("marvel-hooks-"));
    let cleanedCount = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(tempDir, file));
        cleanedCount++;
      } catch (error) {
        logDebug("Failed to clean up file during cleanup", {
          hookType: "daemon",
          filePath: path.join(tempDir, file),
        });
      }
    }
    console.log(`[marvel-daemon] Cleaned up ${cleanedCount}/${files.length} files`);
    break;
  }
  default:
    console.error("Usage: daemon.js <start|stop|status|cleanup> [daemon_id]");
    process.exit(1);
}