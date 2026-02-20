// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Promotion Engine
 *
 * Finds and commits promotion candidates from:
 * 1. Security: learned.jsonl to allowlist.json
 * 2. Domain: guidance.jsonl to packs lessons.jsonl
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import type {
  ExternalRule,
  RuleFile,
  Guidance,
  Lesson,
  PromotionCandidate,
  LessonCandidate,
  PromotionReport,
} from "../types.js";
import type { LogContext } from "./logger.js";
import { logDebug, logWarn } from "./logger.js";
import {
  safeParseJsonl,
  safeReadJson,
  safeWriteJson,
  safeAppendFile,
} from "./file-ops.js";
import { matchesAllowlist } from "./external-rules.js";
import { isPatternSafe } from "./learned-rules.js";
import { redactSensitive } from "./redact.js";
import { loadAllPacks } from "../loaders/pack-loader.js";
import { findMarvelRoot, getSecurityDir } from "./paths.js";

interface LearnedRuleEntry {
  id: string;
  type: "regex" | "prefix" | "contains";
  pattern: string;
  reason: string;
  learnedAt: string;
  approvedCommand: string;
  sessionId?: string;
}

// ─── Security Candidates ────────────────────────────────────────

/**
 * Find security rule candidates for promotion from learned.jsonl → allowlist.json.
 */
export function findSecurityCandidates(
  context: LogContext
): { candidates: PromotionCandidate[]; duplicates: number; unsafe: number } {
  const learnedPath = path.join(getSecurityDir(), "learned.jsonl");

  const entries = safeParseJsonl<LearnedRuleEntry>(learnedPath, context);
  if (entries.length === 0) {
    return { candidates: [], duplicates: 0, unsafe: 0 };
  }

  // Group by pattern to deduplicate and count frequency
  const byPattern = new Map<string, { entries: LearnedRuleEntry[]; rule: ExternalRule }>();
  for (const entry of entries) {
    const key = `${entry.type}:${entry.pattern}`;
    if (!byPattern.has(key)) {
      byPattern.set(key, {
        entries: [],
        rule: { id: entry.id, type: entry.type, pattern: entry.pattern, reason: entry.reason },
      });
    }
    byPattern.get(key)!.entries.push(entry);
  }

  let duplicates = 0;
  let unsafe = 0;
  const candidates: PromotionCandidate[] = [];

  for (const [, { entries: group, rule }] of byPattern) {
    // Count duplicates (beyond the first)
    if (group.length > 1) {
      duplicates += group.length - 1;
    }

    // Filter out rules already in allowlist
    if (matchesAllowlist(rule.pattern, context)) {
      duplicates++;
      continue;
    }

    // Filter out unsafe patterns
    const baseCommand = rule.pattern.trim().split(/\s+/)[0];
    const safetyCheck = isPatternSafe(rule.pattern, baseCommand);
    if (!safetyCheck.safe) {
      unsafe++;
      continue;
    }

    const sorted = group.sort((a, b) => a.learnedAt.localeCompare(b.learnedAt));
    // Redact historical secrets from candidate output
    const redactedRule: ExternalRule = {
      ...rule,
      pattern: redactSensitive(rule.pattern),
      reason: redactSensitive(rule.reason),
    };
    candidates.push({
      source: "learned",
      rule: redactedRule,
      frequency: group.length,
      firstSeen: sorted[0].learnedAt,
      lastSeen: sorted[sorted.length - 1].learnedAt,
    });
  }

  // Sort by frequency desc
  candidates.sort((a, b) => b.frequency - a.frequency);

  logDebug(
    `Found ${candidates.length} security candidates (${duplicates} dupes, ${unsafe} unsafe)`,
    context
  );
  return { candidates, duplicates, unsafe };
}

// ─── Lesson Generalization ──────────────────────────────────────

const GENERALIZE_PROMPT = `You are a coding standards editor. Given a specific correction from a development session, extract the general, reusable rule that applies to any similar situation.

Specific correction: "{content}"
Category: {category}

Return ONLY valid JSON (no markdown fences):
{"title":"imperative rule in under 10 words","description":"why this matters in 1-2 sentences","actionable":"what to do concretely in any instance of this pattern"}`;

const GENERALIZE_TIMEOUT_MS = 8000;
const GENERALIZE_MODEL = "haiku";

/**
 * Escape a string for safe interpolation into a prompt template.
 * Uses JSON.stringify internals to correctly handle all special characters
 * (backslashes, quotes, newlines, tabs, control chars, etc.).
 */
export function escapeForPromptTemplate(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Generalize raw guidance text into a reusable lesson using an LLM.
 * Falls back to verbatim guidance on any failure (fail-open).
 */
function generalizeLessonWithLLM(
  content: string,
  category: string,
  context: LogContext
): { title: string; description: string; actionable: string } | null {
  const prompt = GENERALIZE_PROMPT
    .replace("{content}", escapeForPromptTemplate(content))
    .replace("{category}", escapeForPromptTemplate(category));

  try {
    const result = spawnSync(
      "claude",
      ["-p", prompt, "--model", GENERALIZE_MODEL, "--output-format", "json", "--tools", ""],
      {
        timeout: GENERALIZE_TIMEOUT_MS,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        input: "",
        env: {
          ...process.env,
          MARVEL_SECURITY_EVAL: "1",
          CLAUDE_PROJECT_DIR: undefined,
          MAX_THINKING_TOKENS: undefined,
        },
      }
    );

    if (result.error || result.status !== 0 || !result.stdout) {
      logDebug("LLM generalization failed — using verbatim", context);
      return null;
    }

    // Parse the JSON response — claude --output-format json wraps in {"result": "..."}
    let responseText = result.stdout;
    try {
      const jsonWrapper = JSON.parse(result.stdout) as { result?: string };
      if (jsonWrapper.result) {
        responseText = jsonWrapper.result;
      }
    } catch {
      // Not wrapped, use as-is
    }

    // Remove markdown code fences if present
    const fenceMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      responseText = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(responseText.trim()) as {
      title?: string;
      description?: string;
      actionable?: string;
    };

    if (!parsed.title?.trim() || !parsed.description?.trim() || !parsed.actionable?.trim()) {
      logDebug("LLM returned incomplete generalization — using verbatim", context);
      return null;
    }

    logDebug(`Generalized lesson: "${parsed.title}"`, context);
    return {
      title: parsed.title.trim(),
      description: parsed.description.trim(),
      actionable: parsed.actionable.trim(),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarn(`LLM generalization error: ${msg}`, context);
    return null;
  }
}

// ─── Domain Candidates ──────────────────────────────────────────

/**
 * Find domain lesson candidates for promotion from guidance → pack lessons.
 */
export async function findDomainCandidates(
  marvelRoot: string,
  context: LogContext
): Promise<{ candidates: LessonCandidate[]; totalGuidance: number }> {
  // Collect guidance from all run dirs
  const allGuidance: Guidance[] = [];

  // Read from individual run dirs
  const runsDir = path.join(marvelRoot, "runs");
  if (fs.existsSync(runsDir)) {
    try {
      const runDirs = fs
        .readdirSync(runsDir)
        .filter((name) => name.startsWith("run_"))
        .map((name) => path.join(runsDir, name));

      for (const runDir of runDirs) {
        const guidancePath = path.join(runDir, "guidance.jsonl");
        const items = safeParseJsonl<Guidance>(guidancePath, context);
        allGuidance.push(...items);
      }
    } catch {
      // runs dir may not be readable
    }
  }

  // Read from archive file (persisted across sessions)
  const archivePath = path.join(marvelRoot, "guidance-archive.jsonl");
  const archived = safeParseJsonl<Guidance>(archivePath, context);
  allGuidance.push(...archived);

  if (allGuidance.length === 0) {
    return { candidates: [], totalGuidance: 0 };
  }

  // Filter to corrections and directions only
  const actionable = allGuidance.filter(
    (g) => g.type === "correction" || g.type === "direction"
  );

  // Deduplicate by content similarity (exact match for now)
  const seen = new Set<string>();
  const unique: Guidance[] = [];
  for (const g of actionable) {
    const key = g.content.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(g);
    }
  }

  // Load existing packs to check for duplicates
  const packs = await loadAllPacks(marvelRoot);
  const existingLessons = new Set<string>();
  for (const pack of packs) {
    for (const lesson of pack.lessons) {
      existingLessons.add(lesson.actionable.trim().toLowerCase());
    }
  }

  const candidates: LessonCandidate[] = [];

  for (const g of unique) {
    // Skip if already exists as a lesson
    if (existingLessons.has(g.content.trim().toLowerCase())) {
      continue;
    }

    // Determine target pack from category
    const suggestedPack = g.category || "code-standards-typescript";

    // Check pack actually exists
    const packExists = packs.some((p) => p.metadata.name === suggestedPack);
    if (!packExists) {
      continue;
    }

    // Transform guidance → lesson (generalize with LLM if available)
    const generalized = generalizeLessonWithLLM(g.content, g.category || "general", context);
    const fallbackTitle = g.content.split(/[.!?\n]/)[0].trim().slice(0, 80);
    const suggestedLesson: Lesson = {
      timestamp: new Date().toISOString(),
      run_id: g.run_id,
      category: g.category || "general",
      title: generalized?.title || fallbackTitle,
      description: generalized?.description || g.content,
      actionable: generalized?.actionable || g.content,
    };

    candidates.push({
      guidance: g,
      suggestedPack,
      suggestedLesson,
      confidence: g.confidence,
    });
  }

  // Sort by confidence desc
  candidates.sort((a, b) => b.confidence - a.confidence);

  logDebug(
    `Found ${candidates.length} domain candidates from ${allGuidance.length} total guidance`,
    context
  );
  return { candidates, totalGuidance: allGuidance.length };
}

// ─── Commit Promotions ──────────────────────────────────────────

/**
 * Commit approved security rules to allowlist.json.
 */
export function commitSecurityPromotions(
  rules: ExternalRule[],
  context: LogContext
): { added: number } {
  if (rules.length === 0) {
    return { added: 0 };
  }

  const allowlistPath = path.join(getSecurityDir(), "allowlist.json");

  const existing = safeReadJson<RuleFile>(allowlistPath, context) || { rules: [] };
  const existingIds = new Set(existing.rules.map((r) => r.id));

  let added = 0;
  for (const rule of rules) {
    // Generate a promotion-prefixed ID to avoid conflicts
    const promotedRule: ExternalRule = {
      ...rule,
      id: existingIds.has(rule.id) ? `promoted-${Date.now()}-${rule.id}` : rule.id,
    };
    existing.rules.push(promotedRule);
    added++;
  }

  safeWriteJson(allowlistPath, existing, context);
  logDebug(`Committed ${added} security promotions`, context);

  // Clean promoted entries from learned.jsonl
  cleanPromotedFromLearned(rules, context);

  return { added };
}

/**
 * Remove promoted rules from learned.jsonl to avoid re-suggesting.
 */
function cleanPromotedFromLearned(
  promotedRules: ExternalRule[],
  context: LogContext
): void {
  const learnedPath = path.join(getSecurityDir(), "learned.jsonl");

  const entries = safeParseJsonl<LearnedRuleEntry>(learnedPath, context);
  if (entries.length === 0) return;

  const promotedPatterns = new Set(promotedRules.map((r) => `${r.type}:${r.pattern}`));
  const remaining = entries.filter(
    (e) => !promotedPatterns.has(`${e.type}:${e.pattern}`)
  );

  // Rewrite the file with remaining entries
  const content = remaining.map((e) => JSON.stringify(e)).join("\n") + (remaining.length ? "\n" : "");
  try {
    fs.writeFileSync(learnedPath, content, { mode: 0o600 });
    logDebug(`Cleaned ${entries.length - remaining.length} promoted entries from learned.jsonl`, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to clean learned.jsonl: ${message}`, context);
  }
}

/**
 * Commit approved domain lessons to their pack's lessons.jsonl.
 */
export function commitDomainPromotions(
  lessons: LessonCandidate[],
  marvelRoot: string,
  context: LogContext
): { added: number } {
  if (lessons.length === 0) {
    return { added: 0 };
  }

  let added = 0;
  for (const candidate of lessons) {
    const lessonsPath = path.join(
      marvelRoot,
      "packs",
      candidate.suggestedPack,
      "lessons.jsonl"
    );

    const line = JSON.stringify(candidate.suggestedLesson) + "\n";
    if (safeAppendFile(lessonsPath, line, context)) {
      added++;
    }
  }

  logDebug(`Committed ${added} domain promotions`, context);
  return { added };
}

// ─── Full Report ────────────────────────────────────────────────

/**
 * Generate a full promotion report (security + domain).
 */
export async function generatePromotionReport(
  context: LogContext
): Promise<PromotionReport> {
  const marvelRoot = findMarvelRoot();
  const security = findSecurityCandidates(context);
  const domain = marvelRoot
    ? await findDomainCandidates(marvelRoot, context)
    : { candidates: [], totalGuidance: 0 };

  return {
    security,
    domain,
  };
}