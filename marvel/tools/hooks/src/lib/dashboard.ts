// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Dashboard HTML Template
 *
 * Self-contained HTML page styled with Tailwind CSS 4 (CDN).
 * Shows daemon status, hook metrics, active sessions, and recent activity.
 */

import type { DaemonMetrics } from "./metrics.js";
import { getAllRecentCalls } from "./metrics.js";

function formatUptime(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTime(ts: number | null): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    ok: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
    timeout: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };
  const c = colors[status] || colors.ok;
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c}">${status}</span>`;
}

function transportBadge(transport: string): string {
  const c =
    transport === "http"
      ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
      : "bg-purple-500/20 text-purple-400 border-purple-500/30";
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c}">${transport}</span>`;
}

export function renderDashboard(metrics: DaemonMetrics): string {
  const recentCalls = getAllRecentCalls();

  const hookRows = Object.entries(metrics.hooks)
    .sort(([, a], [, b]) => b.totalCalls - a.totalCalls)
    .map(([hookType, m]) => {
      const avgMs =
        m.totalCalls > 0
          ? formatDuration(m.totalDurationMs / m.totalCalls)
          : "-";
      const errorRate =
        m.totalCalls > 0
          ? `${((m.totalErrors / m.totalCalls) * 100).toFixed(1)}%`
          : "0%";
      return `
        <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
          <td class="px-4 py-3 font-mono text-sm text-zinc-200">${hookType}</td>
          <td class="px-4 py-3 text-sm text-zinc-400 text-right">${m.totalCalls.toLocaleString()}</td>
          <td class="px-4 py-3 text-sm text-zinc-400 text-right">${avgMs}</td>
          <td class="px-4 py-3 text-sm text-right ${m.totalErrors > 0 ? "text-red-400" : "text-zinc-500"}">${m.totalErrors} (${errorRate})</td>
          <td class="px-4 py-3 text-sm text-zinc-500 text-right">${formatTime(m.lastCalledAt)}</td>
        </tr>`;
    })
    .join("");

  const activityRows = recentCalls
    .slice(0, 30)
    .map(
      (call) => `
      <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
        <td class="px-4 py-2 text-xs text-zinc-500 font-mono">${formatTime(call.timestamp)}</td>
        <td class="px-4 py-2 text-sm text-zinc-300 font-mono">${call.hookType}</td>
        <td class="px-4 py-2 text-sm text-zinc-400 text-right">${formatDuration(call.durationMs)}</td>
        <td class="px-4 py-2 text-center">${statusBadge(call.status)}</td>
        <td class="px-4 py-2 text-center">${transportBadge(call.transport)}</td>
        <td class="px-4 py-2 text-xs text-zinc-600 font-mono truncate max-w-32">${call.requestId}</td>
      </tr>`,
    )
    .join("");

  const sessionItems = metrics.activeSessions
    .map(
      (sid) =>
        `<div class="px-3 py-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50 font-mono text-sm text-zinc-300 truncate">${sid}</div>`,
    )
    .join("");

  const totalCalls = Object.values(metrics.hooks).reduce(
    (sum, m) => sum + m.totalCalls,
    0,
  );
  const totalErrors = Object.values(metrics.hooks).reduce(
    (sum, m) => sum + m.totalErrors,
    0,
  );

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="5">
  <title>MARVEL Daemon Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen">
  <div class="max-w-7xl mx-auto px-6 py-8">

    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full bg-emerald-400 pulse-dot"></div>
          <h1 class="text-2xl font-bold tracking-tight">MARVEL Daemon</h1>
        </div>
        <span class="text-sm text-zinc-500 font-mono">${metrics.daemonId}</span>
      </div>
      <div class="text-sm text-zinc-500">Auto-refreshes every 5s</div>
    </div>

    <!-- Status Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Uptime</div>
        <div class="text-2xl font-semibold text-zinc-100">${formatUptime(metrics.startedAt)}</div>
        <div class="text-xs text-zinc-600 mt-1">PID ${metrics.pid}</div>
      </div>
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Total Hook Calls</div>
        <div class="text-2xl font-semibold text-zinc-100">${totalCalls.toLocaleString()}</div>
        <div class="text-xs ${totalErrors > 0 ? "text-red-400" : "text-zinc-600"} mt-1">${totalErrors} errors</div>
      </div>
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Active Sessions</div>
        <div class="text-2xl font-semibold text-zinc-100">${metrics.activeSessions.length}</div>
        <div class="text-xs text-zinc-600 mt-1">${Object.keys(metrics.hooks).length} hook types active</div>
      </div>
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">Transport</div>
        <div class="text-lg font-semibold text-zinc-100">
          ${metrics.httpPort ? `HTTP :${metrics.httpPort}` : "Socket only"}
        </div>
        <div class="text-xs text-zinc-600 mt-1 font-mono truncate" title="${metrics.socketPath}">${metrics.socketPath.split("/").pop()}</div>
      </div>
    </div>

    <!-- Two column layout -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

      <!-- Hook Metrics Table -->
      <div class="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div class="px-5 py-4 border-b border-zinc-800">
          <h2 class="text-lg font-semibold">Hook Metrics</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
                <th class="px-4 py-3 text-left">Hook Type</th>
                <th class="px-4 py-3 text-right">Calls</th>
                <th class="px-4 py-3 text-right">Avg Latency</th>
                <th class="px-4 py-3 text-right">Errors</th>
                <th class="px-4 py-3 text-right">Last Called</th>
              </tr>
            </thead>
            <tbody>${hookRows || '<tr><td colspan="5" class="px-4 py-8 text-center text-zinc-600">No hook activity yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <!-- Active Sessions -->
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div class="px-5 py-4 border-b border-zinc-800">
          <h2 class="text-lg font-semibold">Active Sessions</h2>
        </div>
        <div class="p-4 space-y-2 max-h-80 overflow-y-auto">
          ${sessionItems || '<div class="text-zinc-600 text-sm text-center py-4">No active sessions</div>'}
        </div>

        <div class="px-5 py-4 border-t border-zinc-800">
          <h3 class="text-sm font-semibold text-zinc-400 mb-2">Project</h3>
          <div class="text-xs font-mono text-zinc-500 break-all">${metrics.projectDir}</div>
        </div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div class="px-5 py-4 border-b border-zinc-800">
        <h2 class="text-lg font-semibold">Recent Activity</h2>
        <p class="text-xs text-zinc-500 mt-1">Last ${recentCalls.length} hook invocations</p>
      </div>
      <div class="overflow-x-auto max-h-96 overflow-y-auto">
        <table class="w-full">
          <thead class="sticky top-0 bg-zinc-900">
            <tr class="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <th class="px-4 py-3 text-left">Time</th>
              <th class="px-4 py-3 text-left">Hook</th>
              <th class="px-4 py-3 text-right">Duration</th>
              <th class="px-4 py-3 text-center">Status</th>
              <th class="px-4 py-3 text-center">Transport</th>
              <th class="px-4 py-3 text-left">Request ID</th>
            </tr>
          </thead>
          <tbody>${activityRows || '<tr><td colspan="6" class="px-4 py-8 text-center text-zinc-600">No activity yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div class="mt-8 text-center text-xs text-zinc-700">
      MARVEL Hooks Daemon &middot; Started ${new Date(metrics.startedAt).toLocaleString()}
    </div>
  </div>
</body>
</html>`;
}
