#!/usr/bin/env node
// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0
/**
 * Enhanced analysis of agent security evaluations.
 * Identifies consistent patterns and proposes allowlist/denylist rules.
 *
 * Usage:
 *   pnpm analyze-evaluations [--since=YYYY-MM-DD] [--auto-suggest] [--json]
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { getSecurityDir } from "../lib/paths.js";

interface AgentEvaluation {
  timestamp: string;
  command: string;
  description: string | null;
  decision: string;
  reasoning: string;
  confidence: number;
  investigated: string[];
  costUsd: number;
  durationMs: number;
  numTurns: number;
  evaluator: string;
}

interface Suggestion {
  command: string;
  suggestions: {
    allow?: Array<{ pattern: string; reason: string }>;
    deny?: Array<{ pattern: string; reason: string }>;
  };
}

interface ProposedRule {
  pattern: string;
  reason: string;
  count: number;
  avgConfidence: number;
  source: "evaluation" | "suggestion" | "both";
}

interface AnalysisResult {
  period: { start: string; end: string };
  summary: {
    total: number;
    allowed: number;
    denied: number;
    asked: number;
    avgDurationMs: number;
    avgCostUsd: number;
    totalCostUsd: number;
  };
  proposedAllowlist: ProposedRule[];
  proposedDenylist: ProposedRule[];
  patterns: {
    prefix: string;
    count: number;
    decisions: Record<string, number>;
    avgConfidence: number;
  }[];
}

function parseArgs(): { since: Date | null; autoSuggest: boolean; json: boolean; help: boolean } {
  const args = process.argv.slice(2);
  let since: Date | null = null;
  let autoSuggest = false;
  let json = false;
  let help = false;

  for (const arg of args) {
    if (arg.startsWith("--since=")) {
      since = new Date(arg.slice(8));
    } else if (arg === "--auto-suggest") {
      autoSuggest = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  return { since, autoSuggest, json, help };
}

function printHelp(): void {
  console.log(`
Agent Evaluation Analyzer

Analyzes agent security evaluations to identify consistent patterns and
propose allowlist/denylist rules for automatic future handling.

Usage:
  pnpm analyze-evaluations [options]

Options:
  --since=YYYY-MM-DD  Only analyze evaluations after this date
  --auto-suggest      Write proposed rules to proposed-allowlist.json / proposed-denylist.json
  --json              Output raw JSON instead of formatted report
  --help, -h          Show this help message

Rule proposal criteria:
  - Command prefix always gets the same decision (allow or deny)
  - Average confidence > 0.9
  - At least 3 occurrences
  - Cross-referenced with LLM suggestions for priority boosting

Files:
  Reads from: marvel/security/agent-evaluations.jsonl
              marvel/security/suggestions.jsonl (optional)
  Writes to:  marvel/security/proposed-allowlist.json (--auto-suggest)
              marvel/security/proposed-denylist.json (--auto-suggest)
`);
}

async function loadJsonl<T>(filePath: string, since: Date | null): Promise<T[]> {
  const items: T[] = [];

  if (!fs.existsSync(filePath)) {
    return items;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as T & { timestamp?: string };
      if (since && item.timestamp && new Date(item.timestamp) < since) {
        continue;
      }
      items.push(item);
    } catch {
      // Skip malformed lines
    }
  }

  return items;
}

function extractCommandPrefix(command: string): string {
  const parts = command.trim().split(/\s+/);
  const base = parts[0];

  if (["git", "pnpm", "npm", "yarn", "docker", "kubectl"].includes(base) && parts.length > 1) {
    return `${base} ${parts[1]}`;
  }

  return base;
}

function analyzeEvaluations(
  evaluations: AgentEvaluation[],
  suggestions: Suggestion[]
): AnalysisResult {
  if (evaluations.length === 0) {
    return {
      period: { start: "", end: "" },
      summary: { total: 0, allowed: 0, denied: 0, asked: 0, avgDurationMs: 0, avgCostUsd: 0, totalCostUsd: 0 },
      proposedAllowlist: [],
      proposedDenylist: [],
      patterns: [],
    };
  }

  evaluations.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const totalCost = evaluations.reduce((sum, e) => sum + e.costUsd, 0);

  const summary = {
    total: evaluations.length,
    allowed: evaluations.filter((e) => e.decision === "allow").length,
    denied: evaluations.filter((e) => e.decision === "deny").length,
    asked: evaluations.filter((e) => e.decision === "ask").length,
    avgDurationMs: Math.round(evaluations.reduce((sum, e) => sum + e.durationMs, 0) / evaluations.length),
    avgCostUsd: totalCost / evaluations.length,
    totalCostUsd: totalCost,
  };

  // Group by command prefix
  const prefixMap = new Map<string, {
    count: number;
    decisions: Record<string, number>;
    totalConfidence: number;
    commands: string[];
  }>();

  for (const e of evaluations) {
    const prefix = extractCommandPrefix(e.command);
    const existing = prefixMap.get(prefix) || { count: 0, decisions: {}, totalConfidence: 0, commands: [] };
    existing.count++;
    existing.decisions[e.decision] = (existing.decisions[e.decision] || 0) + 1;
    existing.totalConfidence += e.confidence;
    if (!existing.commands.includes(e.command)) {
      existing.commands.push(e.command);
    }
    prefixMap.set(prefix, existing);
  }

  // Build suggestion index for cross-referencing
  const suggestionIndex = new Map<string, { allow: string[]; deny: string[] }>();
  for (const s of suggestions) {
    const prefix = extractCommandPrefix(s.command);
    const existing = suggestionIndex.get(prefix) || { allow: [], deny: [] };
    if (s.suggestions.allow) {
      for (const r of s.suggestions.allow) existing.allow.push(r.pattern);
    }
    if (s.suggestions.deny) {
      for (const r of s.suggestions.deny) existing.deny.push(r.pattern);
    }
    suggestionIndex.set(prefix, existing);
  }

  const proposedAllowlist: ProposedRule[] = [];
  const proposedDenylist: ProposedRule[] = [];

  for (const [prefix, data] of prefixMap) {
    const avgConfidence = data.totalConfidence / data.count;
    const decisionKeys = Object.keys(data.decisions);

    // Only propose rules for consistent decisions with high confidence and enough data
    if (decisionKeys.length !== 1 || avgConfidence <= 0.9 || data.count < 3) {
      continue;
    }

    const decision = decisionKeys[0];
    const hasSuggestion = suggestionIndex.has(prefix);
    const source: ProposedRule["source"] = hasSuggestion ? "both" : "evaluation";

    const rule: ProposedRule = {
      pattern: prefix,
      reason: `Consistently ${decision}ed ${data.count} times (avg confidence: ${avgConfidence.toFixed(2)})`,
      count: data.count,
      avgConfidence,
      source,
    };

    if (decision === "allow") {
      proposedAllowlist.push(rule);
    } else if (decision === "deny") {
      proposedDenylist.push(rule);
    }
  }

  // Sort by count descending, then by source (both > evaluation)
  const sortRules = (a: ProposedRule, b: ProposedRule) => {
    if (a.source === "both" && b.source !== "both") return -1;
    if (b.source === "both" && a.source !== "both") return 1;
    return b.count - a.count;
  };
  proposedAllowlist.sort(sortRules);
  proposedDenylist.sort(sortRules);

  const patterns = Array.from(prefixMap.entries())
    .map(([prefix, data]) => ({
      prefix,
      count: data.count,
      decisions: data.decisions,
      avgConfidence: data.totalConfidence / data.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    period: {
      start: evaluations[0].timestamp,
      end: evaluations[evaluations.length - 1].timestamp,
    },
    summary,
    proposedAllowlist,
    proposedDenylist,
    patterns,
  };
}

function formatReport(analysis: AnalysisResult): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("              AGENT EVALUATION ANALYSIS                        ");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  if (analysis.summary.total === 0) {
    lines.push("No evaluations found for the specified period.");
    return lines.join("\n");
  }

  lines.push(`Period: ${analysis.period.start.slice(0, 10)} to ${analysis.period.end.slice(0, 10)}`);
  lines.push("");

  lines.push("SUMMARY");
  lines.push("───────────────────────────────────────────────────────────────");
  lines.push(`Total evaluations:  ${analysis.summary.total}`);
  lines.push(`  Allowed:          ${analysis.summary.allowed} (${Math.round((analysis.summary.allowed / analysis.summary.total) * 100)}%)`);
  lines.push(`  Denied:           ${analysis.summary.denied} (${Math.round((analysis.summary.denied / analysis.summary.total) * 100)}%)`);
  lines.push(`  Asked user:       ${analysis.summary.asked} (${Math.round((analysis.summary.asked / analysis.summary.total) * 100)}%)`);
  lines.push(`  Avg latency:      ${analysis.summary.avgDurationMs}ms`);
  lines.push(`  Avg cost:         $${analysis.summary.avgCostUsd.toFixed(4)}`);
  lines.push(`  Total cost:       $${analysis.summary.totalCostUsd.toFixed(4)}`);
  lines.push("");

  if (analysis.proposedAllowlist.length > 0) {
    lines.push("PROPOSED ALLOWLIST RULES");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const rule of analysis.proposedAllowlist) {
      const badge = rule.source === "both" ? " [LLM+data]" : "";
      lines.push(`  ${rule.count.toString().padStart(3)}x | conf=${rule.avgConfidence.toFixed(2)} | ${rule.pattern}${badge}`);
      lines.push(`        ${rule.reason}`);
    }
    lines.push("");
  }

  if (analysis.proposedDenylist.length > 0) {
    lines.push("PROPOSED DENYLIST RULES");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const rule of analysis.proposedDenylist) {
      const badge = rule.source === "both" ? " [LLM+data]" : "";
      lines.push(`  ${rule.count.toString().padStart(3)}x | conf=${rule.avgConfidence.toFixed(2)} | ${rule.pattern}${badge}`);
      lines.push(`        ${rule.reason}`);
    }
    lines.push("");
  }

  if (analysis.patterns.length > 0) {
    lines.push("COMMAND PATTERNS");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const p of analysis.patterns) {
      const decisionStr = Object.entries(p.decisions)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(`  ${p.count.toString().padStart(3)}x | conf=${p.avgConfidence.toFixed(2)} | ${p.prefix.padEnd(20)} | ${decisionStr}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const { since, autoSuggest, json, help } = parseArgs();

  if (help) {
    printHelp();
    process.exit(0);
  }

  const securityDir = getSecurityDir();
  const evalPath = path.join(securityDir, "agent-evaluations.jsonl");
  const suggestionsPath = path.join(securityDir, "suggestions.jsonl");

  const evaluations = await loadJsonl<AgentEvaluation>(evalPath, since);
  const suggestions = await loadJsonl<Suggestion>(suggestionsPath, since);
  const analysis = analyzeEvaluations(evaluations, suggestions);

  if (json) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    console.log(formatReport(analysis));
  }

  if (autoSuggest) {
    if (analysis.proposedAllowlist.length > 0) {
      const outPath = path.join(securityDir, "proposed-allowlist.json");
      fs.writeFileSync(outPath, JSON.stringify(analysis.proposedAllowlist, null, 2) + "\n");
      console.log(`Wrote ${analysis.proposedAllowlist.length} proposed allowlist rules to ${outPath}`);
    }
    if (analysis.proposedDenylist.length > 0) {
      const outPath = path.join(securityDir, "proposed-denylist.json");
      fs.writeFileSync(outPath, JSON.stringify(analysis.proposedDenylist, null, 2) + "\n");
      console.log(`Wrote ${analysis.proposedDenylist.length} proposed denylist rules to ${outPath}`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});