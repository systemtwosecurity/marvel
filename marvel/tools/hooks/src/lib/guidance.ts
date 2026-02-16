// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Guidance Detection
 *
 * Detects correction and direction patterns in user prompts.
 */

import type { GuidanceType } from "../types.js";

// Category keywords for classification.
// Projects should customize this map by adding packs with relevant keywords.
// These are generic starter categories that ship with MARVEL.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "code-quality": [
    "typescript",
    "type",
    "interface",
    "async",
    "await",
    "promise",
    "validation",
    "error",
    "pattern",
    "import",
    "export",
  ],
  "git-workflow": [
    "git",
    "commit",
    "branch",
    "merge",
    "rebase",
    "push",
    "pull",
    "worktree",
  ],
  "testing": [
    "test",
    "mock",
    "assert",
    "coverage",
    "fixture",
    "vitest",
    "jest",
    "expect",
  ],
  "security": [
    "auth",
    "security",
    "cors",
    "sanitize",
    "validate",
    "injection",
    "xss",
    "csrf",
  ],
};

// Direction patterns (explicit instructions)
const DIRECTION_PATTERNS = [
  /always\s+/i,
  /never\s+/i,
  /make\s+sure\s+/i,
  /remember\s+to\s+/i,
  /from\s+now\s+on\s+/i,
  /going\s+forward\s+/i,
];

/**
 * Detect the type of guidance in a user prompt.
 */
export function detectGuidanceType(
  prompt: string,
  correctionPatterns: RegExp[]
): GuidanceType {
  const normalizedPrompt = prompt.trim().toLowerCase();

  // Check for corrections first (highest priority)
  for (const pattern of correctionPatterns) {
    if (pattern.test(prompt)) {
      return "correction";
    }
  }

  // Check for explicit directions
  for (const pattern of DIRECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      return "direction";
    }
  }

  // Check for task boundaries
  if (/^(help|can you|please).*?(add|create|build|fix|implement)/i.test(prompt)) {
    return "task_start";
  }

  if (/^(thanks|done|perfect|looks good|ship it|lgtm)/i.test(prompt)) {
    return "task_end";
  }

  // Check for approvals/rejections
  if (/^(yes|yeah|yep|correct|right|exactly)/i.test(prompt)) {
    return "approval";
  }

  if (/^(no|nope|wrong|incorrect)/i.test(prompt)) {
    return "rejection";
  }

  return "unknown";
}

/**
 * Detect the category of guidance based on keywords.
 */
export function detectCategory(prompt: string): string | undefined {
  const normalizedPrompt = prompt.toLowerCase();

  let bestCategory: string | undefined;
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter((kw) => normalizedPrompt.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}