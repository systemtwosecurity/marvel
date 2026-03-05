// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Hook Metrics Collection
 *
 * Lightweight in-memory metrics for daemon hook invocations.
 * Used by the dashboard and health endpoints.
 */

export interface HookCall {
  timestamp: number;
  durationMs: number;
  status: "ok" | "error" | "timeout";
  requestId: string;
  transport: "http" | "socket";
}

export interface HookMetrics {
  totalCalls: number;
  totalErrors: number;
  totalDurationMs: number;
  lastCalledAt: number | null;
  recentCalls: HookCall[];
}

export interface DaemonMetrics {
  startedAt: number;
  pid: number;
  projectDir: string;
  daemonId: string;
  httpPort: number | null;
  socketPath: string;
  hooks: Record<string, HookMetrics>;
  activeSessions: string[];
}

const MAX_RECENT_CALLS = 50;

const hookMetrics: Record<string, HookMetrics> = {};
let daemonStartedAt = Date.now();
let httpPort: number | null = null;

export function initMetrics(): void {
  daemonStartedAt = Date.now();
}

export function setHttpPort(port: number): void {
  httpPort = port;
}

export function getHttpPort(): number | null {
  return httpPort;
}

function ensureHookMetrics(hookType: string): HookMetrics {
  if (!hookMetrics[hookType]) {
    hookMetrics[hookType] = {
      totalCalls: 0,
      totalErrors: 0,
      totalDurationMs: 0,
      lastCalledAt: null,
      recentCalls: [],
    };
  }
  return hookMetrics[hookType];
}

export function recordHookCall(
  hookType: string,
  durationMs: number,
  status: "ok" | "error" | "timeout",
  requestId: string,
  transport: "http" | "socket",
): void {
  const m = ensureHookMetrics(hookType);
  m.totalCalls++;
  if (status !== "ok") m.totalErrors++;
  m.totalDurationMs += durationMs;
  m.lastCalledAt = Date.now();

  m.recentCalls.push({
    timestamp: Date.now(),
    durationMs,
    status,
    requestId,
    transport,
  });

  // Trim to last N calls
  if (m.recentCalls.length > MAX_RECENT_CALLS) {
    m.recentCalls = m.recentCalls.slice(-MAX_RECENT_CALLS);
  }
}

export function getMetricsSnapshot(
  daemonId: string,
  socketPath: string,
  activeSessions: Set<string>,
): DaemonMetrics {
  return {
    startedAt: daemonStartedAt,
    pid: process.pid,
    projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    daemonId,
    httpPort,
    socketPath,
    hooks: { ...hookMetrics },
    activeSessions: Array.from(activeSessions),
  };
}

export function getAllRecentCalls(): Array<HookCall & { hookType: string }> {
  const all: Array<HookCall & { hookType: string }> = [];
  for (const [hookType, m] of Object.entries(hookMetrics)) {
    for (const call of m.recentCalls) {
      all.push({ ...call, hookType });
    }
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all.slice(0, MAX_RECENT_CALLS);
}
