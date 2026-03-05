// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Reflection Generation
 *
 * Generates PreReflections before task execution and PostReflections after,
 * creating a prediction-validation learning loop. Assumptions declared in
 * pre-reflections are explicitly validated or invalidated in post-reflections.
 */

import * as path from "path";
import type {
  PreReflection,
  PostReflection,
  TaskReflectionState,
  ReflectionRisk,
  ActualOutcome,
} from "../types.js";
import { safeWriteJson, safeReadJson } from "./file-ops.js";
import { logDebug, type LogContext } from "./logger.js";

// Sensitive path patterns that increase risk
const SENSITIVE_PATTERNS = [
  /auth/i,
  /security/i,
  /middleware/i,
  /migration/i,
  /\.env/,
  /secret/i,
  /credential/i,
  /token/i,
];

// Assumption templates mapped to pack categories
const PACK_ASSUMPTIONS: Record<string, string> = {
  "code-quality": "Existing code follows established patterns and conventions",
  testing: "Test suite is comprehensive and passing",
  security: "Security constraints and validation are in place",
  "git-workflow": "Git workflow conventions are followed",
};

// Standard assumptions always included
const BASE_ASSUMPTIONS = [
  "Required dependencies are available",
  "No concurrent modifications to target files",
];

/**
 * Generate a task ID from the current timestamp.
 */
export function generateTaskId(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `task_${hh}${mm}${ss}`;
}

/**
 * Generate a PreReflection based on the task description and active packs.
 */
export function generatePreReflection(
  taskId: string,
  taskDescription: string,
  activePacks: string[]
): PreReflection {
  const plan = buildPlan(taskDescription);
  const assumptions = buildAssumptions(activePacks);
  const risks = detectRisks(taskDescription);
  const unknowns = detectUnknowns(taskDescription);
  const confidence = calculateConfidence(risks, activePacks);

  return {
    version: 1,
    phase: "pre",
    taskId,
    timestamp: new Date().toISOString(),
    plan,
    assumptions,
    risks,
    unknowns,
    confidence,
    expectedVerification: ["lint", "typecheck", "test", "build"],
  };
}

/**
 * Generate a PostReflection by comparing actual outcomes against a PreReflection.
 */
export function generatePostReflection(
  preReflection: PreReflection,
  taskState: TaskReflectionState
): PostReflection {
  const outcome = determineOutcome(taskState);
  const { validated, invalidated } = validateAssumptions(
    preReflection.assumptions,
    taskState
  );
  const analysis = buildAnalysis(outcome, validated, invalidated, taskState);
  const nextSteps = buildNextSteps(outcome, invalidated);
  const confidenceDelta = calculateConfidenceDelta(outcome, taskState);

  return {
    version: 1,
    phase: "post",
    taskId: preReflection.taskId,
    timestamp: new Date().toISOString(),
    preReflectionRef: `reflection-pre-${preReflection.taskId}.json`,
    actualOutcome: outcome,
    assumptions: preReflection.assumptions,
    assumptionsValidated: validated,
    assumptionsInvalidated: invalidated,
    analysis,
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
    confidence: Math.max(0, Math.min(1, preReflection.confidence + confidenceDelta)),
  };
}

/**
 * Write a reflection to the run directory.
 */
export function writeReflection(
  runDir: string,
  reflection: PreReflection | PostReflection,
  context: LogContext
): boolean {
  const filename = `reflection-${reflection.phase}-${reflection.taskId}.json`;
  const filePath = path.join(runDir, filename);
  const ok = safeWriteJson(filePath, reflection, context);
  if (ok) {
    logDebug(`Wrote ${filename}`, context);
  }
  return ok;
}

/**
 * Read a PreReflection from the run directory.
 */
export function readPreReflection(
  runDir: string,
  taskId: string,
  context: LogContext
): PreReflection | null {
  const filename = `reflection-pre-${taskId}.json`;
  const filePath = path.join(runDir, filename);
  return safeReadJson<PreReflection>(filePath, context);
}

/**
 * Format a reflection summary for the stop hook message.
 */
export function formatReflectionSummary(post: PostReflection): string {
  const lines: string[] = [];

  lines.push(`**Reflection (${post.taskId}):** ${post.actualOutcome.summary}`);

  if (post.assumptionsValidated && post.assumptionsValidated.length > 0) {
    lines.push(
      `  Validated: ${post.assumptionsValidated.map((a) => `"${a}"`).join(", ")}`
    );
  }
  if (post.assumptionsInvalidated && post.assumptionsInvalidated.length > 0) {
    lines.push(
      `  Invalidated: ${post.assumptionsInvalidated.map((a) => `"${a}"`).join(", ")}`
    );
  }
  if (post.confidence !== undefined) {
    lines.push(`  Confidence: ${(post.confidence * 100).toFixed(0)}%`);
  }

  return lines.join("\n");
}

// --- Internal helpers ---

function buildPlan(description: string): string[] {
  const plan: string[] = [];
  const lower = description.toLowerCase();

  if (/add|create|implement|build/.test(lower)) {
    plan.push("Understand requirements from task description");
    plan.push("Identify target files and modules");
    plan.push("Implement changes");
  } else if (/fix|bug|patch|resolve/.test(lower)) {
    plan.push("Reproduce and understand the issue");
    plan.push("Identify root cause");
    plan.push("Implement fix");
  } else if (/refactor|clean|reorganize/.test(lower)) {
    plan.push("Understand current structure");
    plan.push("Plan refactoring approach");
    plan.push("Apply changes incrementally");
  } else {
    plan.push("Analyze task requirements");
    plan.push("Implement changes");
  }

  plan.push("Run verification (lint, typecheck, test)");
  return plan;
}

function buildAssumptions(activePacks: string[]): string[] {
  const assumptions = [...BASE_ASSUMPTIONS];

  for (const pack of activePacks) {
    const assumption = PACK_ASSUMPTIONS[pack];
    if (assumption) {
      assumptions.push(assumption);
    }
  }

  return assumptions;
}

function detectRisks(description: string): ReflectionRisk[] {
  const risks: ReflectionRisk[] = [];

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(description)) {
      risks.push({
        risk: `Task involves sensitive area: ${pattern.source}`,
        mitigation: "Review changes carefully before committing",
        likelihood: "medium",
      });
    }
  }

  if (/delete|remove|drop/.test(description.toLowerCase())) {
    risks.push({
      risk: "Task involves destructive operations",
      mitigation: "Verify nothing is broken after removal",
      likelihood: "medium",
    });
  }

  return risks;
}

function detectUnknowns(description: string): string[] {
  const unknowns: string[] = [];

  if (description.length < 30) {
    unknowns.push("Task description is brief — may need clarification");
  }

  return unknowns;
}

function calculateConfidence(
  risks: ReflectionRisk[],
  activePacks: string[]
): number {
  let confidence = 0.7;

  // Risk adjustments
  for (const risk of risks) {
    if (risk.likelihood === "high") confidence -= 0.15;
    else if (risk.likelihood === "medium") confidence -= 0.1;
    else confidence -= 0.05;
  }

  // Pack coverage boost
  confidence += Math.min(activePacks.length * 0.02, 0.08);

  return Math.max(0.1, Math.min(1, Math.round(confidence * 100) / 100));
}

function determineOutcome(taskState: TaskReflectionState): ActualOutcome {
  // Check verification results for failures
  const failures = taskState.verificationResults.filter((v) => !v.passed);

  if (failures.length > 0) {
    const lastFailure = failures[failures.length - 1];
    return {
      success: false,
      summary: `Verification failed: ${lastFailure.type}`,
      failureReason: `${lastFailure.type} did not pass`,
      failureStage: lastFailure.type,
    };
  }

  // Check for high correction count as a signal of difficulty
  if (taskState.correctionCount >= 3) {
    return {
      success: true,
      summary: `Task completed with ${taskState.correctionCount} corrections`,
    };
  }

  return {
    success: true,
    summary: "Task completed successfully",
  };
}

function validateAssumptions(
  assumptions: string[],
  taskState: TaskReflectionState
): { validated: string[]; invalidated: string[] } {
  const validated: string[] = [];
  const invalidated: string[] = [];

  const failedTypes = new Set(
    taskState.verificationResults.filter((v) => !v.passed).map((v) => v.type)
  );
  const hadCorrections = taskState.correctionCount > 0;

  for (const assumption of assumptions) {
    const lower = assumption.toLowerCase();

    if (lower.includes("patterns") || lower.includes("conventions")) {
      if (failedTypes.has("lint") || failedTypes.has("typecheck")) {
        invalidated.push(assumption);
      } else if (hadCorrections) {
        invalidated.push(assumption);
      } else {
        validated.push(assumption);
      }
    } else if (lower.includes("test")) {
      if (failedTypes.has("test")) {
        invalidated.push(assumption);
      } else {
        validated.push(assumption);
      }
    } else if (lower.includes("dependencies")) {
      if (failedTypes.has("build")) {
        invalidated.push(assumption);
      } else {
        validated.push(assumption);
      }
    } else if (lower.includes("security") || lower.includes("validation")) {
      if (hadCorrections && taskState.correctionCount >= 2) {
        invalidated.push(assumption);
      } else {
        validated.push(assumption);
      }
    } else {
      // Default: no evidence against → validated
      validated.push(assumption);
    }
  }

  return { validated, invalidated };
}

function buildAnalysis(
  outcome: ActualOutcome,
  validated: string[],
  invalidated: string[],
  taskState: TaskReflectionState
): string {
  const parts: string[] = [];

  if (outcome.success) {
    parts.push("Task completed successfully.");
  } else {
    parts.push(`Task had issues: ${outcome.failureReason || "unknown"}.`);
  }

  if (invalidated.length > 0) {
    parts.push(
      `${invalidated.length} assumption(s) were invalidated, suggesting areas for improvement.`
    );
  }

  if (taskState.correctionCount > 0) {
    parts.push(
      `${taskState.correctionCount} user correction(s) during execution.`
    );
  }

  if (validated.length === taskState.preReflection.assumptions.length) {
    parts.push("All assumptions held — high confidence in this area.");
  }

  return parts.join(" ");
}

function buildNextSteps(
  outcome: ActualOutcome,
  invalidated: string[]
): string[] {
  const steps: string[] = [];

  if (outcome.failureStage === "lint") {
    steps.push("Fix linting errors before proceeding");
  }
  if (outcome.failureStage === "test") {
    steps.push("Update or fix failing tests");
  }
  if (outcome.failureStage === "build") {
    steps.push("Resolve build errors — check dependencies and imports");
  }
  if (outcome.failureStage === "typecheck") {
    steps.push("Fix type errors");
  }

  if (invalidated.length > 0 && steps.length === 0) {
    steps.push("Review invalidated assumptions for lessons to capture");
  }

  return steps;
}

function calculateConfidenceDelta(
  outcome: ActualOutcome,
  taskState: TaskReflectionState
): number {
  let delta = 0;

  if (outcome.success) {
    delta += 0.15;
    if (taskState.correctionCount > 0) {
      delta -= 0.1; // Success but with corrections
    }
  } else {
    delta -= 0.2;
  }

  // Additional penalty for multiple corrections
  if (taskState.correctionCount >= 3) {
    delta -= 0.1;
  }

  return delta;
}
