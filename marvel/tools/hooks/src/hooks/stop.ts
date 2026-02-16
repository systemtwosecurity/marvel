// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Stop Hook
 *
 * Finalizes trace, archives guidance, and triggers reflection with
 * concrete promotion candidates when thresholds are met.
 */

import * as path from "path";
import type { StopHookInput, SyncHookJSONOutput } from "../sdk-types.js";
import type { Guidance, RunState, InjectionRecord, LessonOutcome, Lesson, ToolCallRecord } from "../types.js";
import { findMarvelRoot, findRunDir } from "../lib/paths.js";
import {
  safeParseJsonl,
  safeReadJson,
  safeWriteJson,
  safeWriteJsonl,
  safeAppendFile,
} from "../lib/file-ops.js";
import { logDebug, buildHookContext, type LogContext } from "../lib/logger.js";
import { findSecurityCandidates, findDomainCandidates } from "../lib/promote.js";

const REFLECTION_CORRECTION_THRESHOLD = 1;

function readGuidance(runDir: string, context: LogContext): Guidance[] {
  const guidancePath = path.join(runDir, "guidance.jsonl");
  return safeParseJsonl<Guidance>(guidancePath, context);
}

function countCorrectionsByCategory(
  guidance: Guidance[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of guidance) {
    if (g.type === "correction" && g.category) {
      counts[g.category] = (counts[g.category] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Archive current run's guidance to marvel/guidance-archive.jsonl
 * so it survives across sessions within the same worktree.
 */
function archiveGuidance(
  guidance: Guidance[],
  marvelRoot: string,
  context: LogContext
): void {
  if (guidance.length === 0) return;

  const archivePath = path.join(marvelRoot, "guidance-archive.jsonl");
  const lines = guidance.map((g) => JSON.stringify(g)).join("\n") + "\n";
  safeAppendFile(archivePath, lines, context);
  logDebug(`Archived ${guidance.length} guidance entries`, context);
}

/**
 * Build a set of files that had tool failures after injection.
 * A tool failure after injection is a weaker negative signal (0.5 weight)
 * compared to an explicit user correction (1.0 weight).
 */
function getToolFailureFiles(
  runDir: string,
  injections: InjectionRecord[],
  context: LogContext
): Set<string> {
  const toolCalls = safeParseJsonl<ToolCallRecord>(
    path.join(runDir, "tool_calls.jsonl"),
    context
  );
  if (toolCalls.length === 0) return new Set();

  const failureFiles = new Set<string>();
  const injectionFiles = new Set(injections.map((inj) => inj.file));

  for (const call of toolCalls) {
    if (!call.success && call.input_summary) {
      // Check if the failed tool call was on a file that had an injection
      for (const injFile of injectionFiles) {
        if (call.input_summary.includes(injFile)) {
          failureFiles.add(injFile);
        }
      }
    }
  }

  return failureFiles;
}

/**
 * Correlate injection records with correction guidance to compute per-lesson outcomes.
 * Uses two signals: explicit user corrections (weight 1.0) and tool failures after injection (weight 0.5).
 */
function correlateOutcomes(
  runDir: string,
  guidance: Guidance[],
  context: LogContext
): void {
  const injections = safeParseJsonl<InjectionRecord>(
    path.join(runDir, "injections.jsonl"),
    context
  );
  if (injections.length === 0) return;

  const corrections = guidance.filter((g) => g.type === "correction");

  // Get tool failure files as a secondary negative signal
  const toolFailureFiles = getToolFailureFiles(runDir, injections, context);

  if (corrections.length === 0 && toolFailureFiles.size === 0) {
    // No corrections and no failures — all injections were successful
    // Still write outcomes so /marvel-health can count injection_count
    const outcomes: LessonOutcome[] = [];
    const lessonCounts = new Map<string, { pack: string; count: number }>();
    for (const inj of injections) {
      for (let i = 0; i < inj.lessons_injected.length; i++) {
        const title = inj.lessons_injected[i];
        const pack = inj.packs_injected[0] || "unknown";
        const existing = lessonCounts.get(title);
        if (existing) {
          existing.count++;
        } else {
          lessonCounts.set(title, { pack, count: 1 });
        }
      }
    }
    for (const [title, { pack, count }] of lessonCounts) {
      outcomes.push({ lesson_title: title, pack, injected: count, followed_by_correction: 0 });
    }
    const outcomesPath = path.join(runDir, "lesson-outcomes.jsonl");
    const lines = outcomes.map((o) => JSON.stringify(o)).join("\n") + "\n";
    safeAppendFile(outcomesPath, lines, context);
    logDebug(`Wrote ${outcomes.length} lesson outcomes (0 corrections, 0 tool failures)`, context);
    return;
  }

  // Build a set of (file, category) pairs from corrections
  const correctionFiles = new Set(corrections.map((c) => c.preceding_file).filter(Boolean));
  const correctionCategories = new Set(corrections.map((c) => c.category).filter(Boolean));

  // Count per-lesson: was it injected, and was it followed by a correction or tool failure?
  const lessonStats = new Map<string, { pack: string; injected: number; corrected: number }>();
  for (const inj of injections) {
    const hadExplicitCorrection =
      correctionFiles.has(inj.file) ||
      inj.packs_injected.some((p) => correctionCategories.has(p));

    const hadToolFailure = toolFailureFiles.has(inj.file);

    // Explicit correction = 1.0 weight, tool failure alone = 0.5 weight
    let correctionWeight = 0;
    if (hadExplicitCorrection) {
      correctionWeight = 1;
    } else if (hadToolFailure) {
      correctionWeight = 0.5;
    }

    for (const title of inj.lessons_injected) {
      const existing = lessonStats.get(title);
      if (existing) {
        existing.injected++;
        existing.corrected += correctionWeight;
      } else {
        lessonStats.set(title, {
          pack: inj.packs_injected[0] || "unknown",
          injected: 1,
          corrected: correctionWeight,
        });
      }
    }
  }

  const outcomes: LessonOutcome[] = [];
  for (const [title, stats] of lessonStats) {
    outcomes.push({
      lesson_title: title,
      pack: stats.pack,
      injected: stats.injected,
      followed_by_correction: stats.corrected,
    });
  }

  const outcomesPath = path.join(runDir, "lesson-outcomes.jsonl");
  const lines = outcomes.map((o) => JSON.stringify(o)).join("\n") + "\n";
  safeAppendFile(outcomesPath, lines, context);
  logDebug(`Wrote ${outcomes.length} lesson outcomes (${corrections.length} corrections, ${toolFailureFiles.size} tool failure files)`, context);
}

/**
 * Update lesson utility scores in pack lessons.jsonl files based on session outcomes.
 * Closes the feedback loop: session outcomes → lesson scores → better injection selection.
 *
 * Uses time-based decay so old scores don't dominate:
 *   existing_weight = max(0.5, 1 - (days_since_last_session / 90))
 *   new_utility = weighted average of existing and session utility
 */
function updateLessonUtilityScores(
  runDir: string,
  marvelRoot: string,
  context: LogContext
): void {
  const outcomesPath = path.join(runDir, "lesson-outcomes.jsonl");
  const outcomes = safeParseJsonl<LessonOutcome>(outcomesPath, context);
  if (outcomes.length === 0) return;

  // Group outcomes by pack
  const outcomesByPack = new Map<string, LessonOutcome[]>();
  for (const outcome of outcomes) {
    const existing = outcomesByPack.get(outcome.pack);
    if (existing) {
      existing.push(outcome);
    } else {
      outcomesByPack.set(outcome.pack, [outcome]);
    }
  }

  const now = new Date();

  for (const [packName, packOutcomes] of outcomesByPack) {
    const lessonsPath = path.join(marvelRoot, "packs", packName, "lessons.jsonl");
    const lessons = safeParseJsonl<Lesson>(lessonsPath, context);
    if (lessons.length === 0) continue;

    // Build a lookup of outcomes by lesson title
    const outcomeMap = new Map<string, LessonOutcome>();
    for (const o of packOutcomes) {
      const existing = outcomeMap.get(o.lesson_title);
      if (existing) {
        existing.injected += o.injected;
        existing.followed_by_correction += o.followed_by_correction;
      } else {
        outcomeMap.set(o.lesson_title, { ...o });
      }
    }

    let updated = false;
    for (const lesson of lessons) {
      const outcome = outcomeMap.get(lesson.title);
      if (!outcome) continue;

      const existingInjections = lesson.injection_count ?? 0;
      const existingCorrections = lesson.correction_count ?? 0;
      const existingUtility = lesson.utility_score ?? 0.5;

      // Compute session utility: 1 - (corrections / injections)
      const sessionUtility = outcome.injected > 0
        ? 1 - (outcome.followed_by_correction / outcome.injected)
        : 1;

      // Time-based decay for existing scores
      let existingWeight = 1;
      if (lesson.last_injected) {
        const daysSinceLast = (now.getTime() - new Date(lesson.last_injected).getTime()) / (1000 * 60 * 60 * 24);
        existingWeight = Math.max(0.5, 1 - (daysSinceLast / 90));
      }

      // Weighted average of existing and session utility
      const weightedExisting = existingWeight * existingInjections;
      const totalWeight = weightedExisting + outcome.injected;
      const newUtility = totalWeight > 0
        ? (existingUtility * weightedExisting + sessionUtility * outcome.injected) / totalWeight
        : existingUtility;

      lesson.utility_score = Math.round(newUtility * 1000) / 1000;
      lesson.injection_count = existingInjections + outcome.injected;
      lesson.correction_count = existingCorrections + outcome.followed_by_correction;
      lesson.last_injected = now.toISOString();
      updated = true;
    }

    if (updated) {
      safeWriteJsonl(lessonsPath, lessons, context);
      logDebug(`Updated utility scores for ${packName} (${outcomeMap.size} lessons)`, context);
    }
  }
}

/**
 * Build a concrete reflection message with actual promotion candidates.
 * Surfaces top candidates inline rather than requiring /marvel-reflect.
 */
async function buildConcreteReflection(
  categoryCounts: Record<string, number>,
  context: LogContext
): Promise<string | null> {
  const totalCorrections = Object.values(categoryCounts).reduce(
    (a, b) => a + b,
    0
  );
  const hasCorrections = totalCorrections >= REFLECTION_CORRECTION_THRESHOLD;

  // Check for security candidates regardless of correction threshold
  const security = findSecurityCandidates(context);
  const hasSecurity = security.candidates.length > 0;

  // Check domain candidates if any corrections exist
  let domainCandidateLines: string[] = [];
  if (hasCorrections) {
    const marvelRoot = findMarvelRoot();
    if (marvelRoot) {
      const domain = await findDomainCandidates(marvelRoot, context);
      // Show top 3 candidates inline with their generalized titles
      for (const c of domain.candidates.slice(0, 3)) {
        domainCandidateLines.push(
          `- **${c.suggestedLesson.title}** → \`${c.suggestedPack}\` pack\n  ${c.suggestedLesson.actionable}`
        );
      }
    }
  }

  if (!hasSecurity && domainCandidateLines.length === 0) {
    return null;
  }

  const lines: string[] = [
    `Session learnings ready for promotion (${totalCorrections} correction${totalCorrections !== 1 ? "s" : ""} this session):`,
    "",
  ];

  if (hasSecurity) {
    const patterns = security.candidates
      .slice(0, 5)
      .map((c) => c.rule.pattern)
      .join(", ");
    lines.push(
      `**Security:** ${security.candidates.length} rules (${patterns})`
    );
    lines.push("");
  }

  if (domainCandidateLines.length > 0) {
    lines.push(`**Lesson candidates:**`);
    lines.push(...domainCandidateLines);
    lines.push("");
  }

  lines.push(`Run /marvel-reflect to review and promote these candidates.`);

  return lines.join("\n");
}

export async function handleStop(input: StopHookInput): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("stop", input);
  const runDir = findRunDir();
  if (!runDir) {
    logDebug("Run directory not found, skipping hook", context);
    return {};
  }

  // Finalize run state
  const runJsonPath = path.join(runDir, "run.json");
  const runState = safeReadJson<RunState>(runJsonPath, context);
  if (runState) {
    runState.endedAt = new Date().toISOString();
    safeWriteJson(runJsonPath, runState, context);
  }

  // Read and archive guidance
  const guidance = readGuidance(runDir, context);
  const marvelRoot = findMarvelRoot();
  if (marvelRoot && guidance.length > 0) {
    archiveGuidance(guidance, marvelRoot, context);
  }

  // Correlate injections with corrections for outcome tracking
  correlateOutcomes(runDir, guidance, context);

  // Update lesson utility scores based on session outcomes
  if (marvelRoot) {
    updateLessonUtilityScores(runDir, marvelRoot, context);
  }

  // Build concrete reflection with actual candidates
  const categoryCounts = countCorrectionsByCategory(guidance);
  const reflectionPrompt = await buildConcreteReflection(categoryCounts, context);

  if (reflectionPrompt) {
    return {
      systemMessage: reflectionPrompt,
    };
  }

  return {};
}