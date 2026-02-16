#!/usr/bin/env node
// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0
/**
 * Batch analysis of security decisions.
 * Run at end of day to review decisions and identify improvements.
 *
 * Usage:
 *   pnpm analyze-decisions [--since=YYYY-MM-DD] [--json]
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { getSecurityDir } from "../lib/paths.js";

interface Decision {
  timestamp: string;
  command: string;
  description: string | null;
  decision: "allow" | "deny" | "ask";
  reasoning: string;
  durationMs: number;
  model: string;
}

interface AnalysisResult {
  period: { start: string; end: string };
  summary: {
    total: number;
    allowed: number;
    denied: number;
    asked: number;
    avgDurationMs: number;
  };
  slowest: Decision[];
  byDecision: {
    allow: Decision[];
    deny: Decision[];
    ask: Decision[];
  };
  patterns: {
    command: string;
    count: number;
    decisions: Record<string, number>;
  }[];
}

function parseArgs(): { since: Date | null; json: boolean; help: boolean } {
  const args = process.argv.slice(2);
  let since: Date | null = null;
  let json = false;
  let help = false;

  for (const arg of args) {
    if (arg.startsWith("--since=")) {
      since = new Date(arg.slice(8));
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  return { since, json, help };
}

function printHelp(): void {
  console.log(`
Security Decision Analyzer

Analyzes security decisions logged during Claude Code sessions to help
identify patterns, slow decisions, and opportunities for rule improvements.

Usage:
  pnpm analyze-decisions [options]

Options:
  --since=YYYY-MM-DD  Only analyze decisions after this date
  --json              Output raw JSON instead of formatted report
  --help, -h          Show this help message

Output:
  - Summary statistics (total, by decision type, avg latency)
  - Slowest decisions (potential optimization targets)
  - Decisions grouped by type for review
  - Command patterns with mixed decisions (rule candidates)

Files:
  Reads from: marvel/security/decisions.jsonl
`);
}

async function loadDecisions(filePath: string, since: Date | null): Promise<Decision[]> {
  const decisions: Decision[] = [];

  if (!fs.existsSync(filePath)) {
    return decisions;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const decision = JSON.parse(line) as Decision;
      if (since && new Date(decision.timestamp) < since) {
        continue;
      }
      decisions.push(decision);
    } catch {
      // Skip malformed lines
    }
  }

  return decisions;
}

function extractCommandPrefix(command: string): string {
  // Extract the base command for pattern grouping
  const parts = command.trim().split(/\s+/);
  const base = parts[0];

  // For common tools, include subcommand
  if (["git", "pnpm", "npm", "yarn", "docker", "kubectl"].includes(base) && parts.length > 1) {
    return `${base} ${parts[1]}`;
  }

  return base;
}

function analyzeDecisions(decisions: Decision[]): AnalysisResult {
  if (decisions.length === 0) {
    return {
      period: { start: "", end: "" },
      summary: { total: 0, allowed: 0, denied: 0, asked: 0, avgDurationMs: 0 },
      slowest: [],
      byDecision: { allow: [], deny: [], ask: [] },
      patterns: [],
    };
  }

  // Sort by timestamp
  decisions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const summary = {
    total: decisions.length,
    allowed: decisions.filter((d) => d.decision === "allow").length,
    denied: decisions.filter((d) => d.decision === "deny").length,
    asked: decisions.filter((d) => d.decision === "ask").length,
    avgDurationMs: Math.round(
      decisions.reduce((sum, d) => sum + d.durationMs, 0) / decisions.length
    ),
  };

  // Find slowest decisions
  const slowest = [...decisions]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);

  // Group by decision type
  const byDecision = {
    allow: decisions.filter((d) => d.decision === "allow"),
    deny: decisions.filter((d) => d.decision === "deny"),
    ask: decisions.filter((d) => d.decision === "ask"),
  };

  // Find command patterns
  const patternMap = new Map<string, { count: number; decisions: Record<string, number> }>();
  for (const d of decisions) {
    const prefix = extractCommandPrefix(d.command);
    const existing = patternMap.get(prefix) || { count: 0, decisions: {} };
    existing.count++;
    existing.decisions[d.decision] = (existing.decisions[d.decision] || 0) + 1;
    patternMap.set(prefix, existing);
  }

  // Convert to array and filter for patterns with multiple decisions types (rule candidates)
  const patterns = Array.from(patternMap.entries())
    .map(([command, data]) => ({ command, ...data }))
    .filter((p) => Object.keys(p.decisions).length > 1 || p.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    period: {
      start: decisions[0].timestamp,
      end: decisions[decisions.length - 1].timestamp,
    },
    summary,
    slowest,
    byDecision,
    patterns,
  };
}

function formatReport(analysis: AnalysisResult): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("                   SECURITY DECISION ANALYSIS                   ");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  if (analysis.summary.total === 0) {
    lines.push("No decisions found for the specified period.");
    return lines.join("\n");
  }

  // Period
  lines.push(`Period: ${analysis.period.start.slice(0, 10)} to ${analysis.period.end.slice(0, 10)}`);
  lines.push("");

  // Summary
  lines.push("SUMMARY");
  lines.push("───────────────────────────────────────────────────────────────");
  lines.push(`Total decisions:    ${analysis.summary.total}`);
  lines.push(`  ✓ Allowed:        ${analysis.summary.allowed} (${Math.round((analysis.summary.allowed / analysis.summary.total) * 100)}%)`);
  lines.push(`  ✗ Denied:         ${analysis.summary.denied} (${Math.round((analysis.summary.denied / analysis.summary.total) * 100)}%)`);
  lines.push(`  ? Asked user:     ${analysis.summary.asked} (${Math.round((analysis.summary.asked / analysis.summary.total) * 100)}%)`);
  lines.push(`  Avg latency:      ${analysis.summary.avgDurationMs}ms`);
  lines.push("");

  // Slowest decisions
  if (analysis.slowest.length > 0) {
    lines.push("SLOWEST DECISIONS (optimization targets)");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const d of analysis.slowest) {
      lines.push(`  ${d.durationMs}ms | ${d.decision.padEnd(5)} | ${d.command.slice(0, 50)}`);
    }
    lines.push("");
  }

  // Patterns needing rules
  if (analysis.patterns.length > 0) {
    lines.push("COMMAND PATTERNS (rule candidates)");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const p of analysis.patterns) {
      const decisionStr = Object.entries(p.decisions)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(`  ${p.count.toString().padStart(3)}x | ${p.command.padEnd(20)} | ${decisionStr}`);
    }
    lines.push("");
  }

  // Denied commands (review for false positives)
  if (analysis.byDecision.deny.length > 0) {
    lines.push("DENIED COMMANDS (review for false positives)");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const d of analysis.byDecision.deny.slice(0, 10)) {
      lines.push(`  ${d.command.slice(0, 60)}`);
      lines.push(`    Reason: ${d.reasoning.slice(0, 50)}`);
    }
    lines.push("");
  }

  // Asked commands (candidates for rules)
  if (analysis.byDecision.ask.length > 0) {
    lines.push("ASKED USER (candidates for allow/deny rules)");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const d of analysis.byDecision.ask.slice(0, 10)) {
      lines.push(`  ${d.command.slice(0, 60)}`);
      lines.push(`    Reason: ${d.reasoning.slice(0, 50)}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const { since, json, help } = parseArgs();

  if (help) {
    printHelp();
    process.exit(0);
  }

  // Find decisions file
  const decisionsPath = path.join(getSecurityDir(), "decisions.jsonl");

  const decisions = await loadDecisions(decisionsPath, since);
  const analysis = analyzeDecisions(decisions);

  if (json) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    console.log(formatReport(analysis));
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});