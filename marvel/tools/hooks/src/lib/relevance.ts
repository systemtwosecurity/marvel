// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Relevance Scoring
 *
 * Calculates relevance of packs to file operations.
 */

import * as path from "path";
import type { LoadedPack, Guidance } from "../types.js";

/**
 * Simple glob pattern matching for sensitive_paths.
 * Supports:
 *   - `**` for any number of directories
 *   - `*` for any characters within a path segment
 *   - Literal strings
 *
 * @param pattern - Glob pattern like "src/app/** /page.tsx"
 * @param filePath - File path to test
 * @returns true if the pattern matches the file path
 */
function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize paths to use forward slashes
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // If no glob characters, use simple includes check
  if (!normalizedPattern.includes("*")) {
    return normalizedPath.includes(normalizedPattern);
  }

  // Convert glob pattern to regex
  // Escape regex special chars except * which we handle specially
  let regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
    .replace(/\*\*/g, "<<<GLOBSTAR>>>") // Temp placeholder for **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/<<<GLOBSTAR>>>/g, ".*"); // ** matches anything including /

  // Pattern should match anywhere in the path unless it starts with /
  if (!regexStr.startsWith("/")) {
    regexStr = ".*" + regexStr;
  }

  try {
    const regex = new RegExp(regexStr);
    return regex.test(normalizedPath);
  } catch {
    // If regex is invalid, fall back to includes
    return normalizedPath.includes(normalizedPattern);
  }
}

// Scoring weights
const WEIGHTS = {
  FILE_PATTERN_MATCH: 15,
  EXTENSION_MATCH: 5,
  SENSITIVE_PATH: 20,
  RECENT_CORRECTION: 20,
  CATEGORY_MATCH: 8,
  DEPENDENCY_BOOST: 3,
};

const MAX_PACKS = 4;

/**
 * Keyword-to-category mapping for file path boosting.
 * When a file path contains a keyword, packs with the matching category get a boost.
 */
// Path keyword to category mapping for file path boosting.
// Projects should extend this map when adding domain-specific packs.
const PATH_KEYWORD_CATEGORIES: Record<string, string[]> = {
  test: ["testing", "test-quality"],
  spec: ["testing", "test-quality"],
  auth: ["security", "auth"],
  middleware: ["security", "auth"],
  config: ["configuration"],
  env: ["configuration"],
  schema: ["database", "schema"],
  migration: ["database", "schema"],
};

/**
 * Calculate relevance score for a pack given a file path.
 */
export function calculateRelevance(
  pack: LoadedPack,
  filePath: string,
  recentGuidance: Guidance[]
): number {
  // Check excludes_paths first — if the file is in an excluded path, score 0
  const excludesPaths = pack.metadata.excludes_paths || [];
  if (excludesPaths.length > 0) {
    const normalizedFile = filePath.replace(/\\/g, "/");
    for (const excludePath of excludesPaths) {
      if (normalizedFile.includes(excludePath)) {
        return 0;
      }
    }
  }

  let score = 0;
  const signals: string[] = [];

  const ext = path.extname(filePath).toLowerCase();
  const packExtensions = pack.metadata.applies_to?.extensions || [];

  // Extension match
  if (packExtensions.includes(ext)) {
    score += WEIGHTS.EXTENSION_MATCH;
    signals.push("extension_match");
  }

  // Check code paths
  const codePaths = pack.metadata.references?.code_paths || [];
  for (const codePath of codePaths) {
    if (filePath.includes(codePath)) {
      score += WEIGHTS.FILE_PATTERN_MATCH;
      signals.push("code_path_match");
      break;
    }
  }

  // Check sensitive paths (supports glob patterns like "src/app/**/page.tsx")
  const sensitivePaths = pack.metadata.sensitive_paths || [];
  for (const sensitivePath of sensitivePaths) {
    if (matchGlob(sensitivePath, filePath)) {
      score += WEIGHTS.SENSITIVE_PATH;
      signals.push("sensitive_path");
      break;
    }
  }

  // Recent corrections boost
  const packCategories = pack.metadata.categories || [];
  const relevantCorrections = recentGuidance.filter(
    (g) =>
      g.type === "correction" &&
      g.category &&
      packCategories.includes(g.category)
  );

  if (relevantCorrections.length > 0) {
    // Cap at 3x multiplier
    const multiplier = Math.min(relevantCorrections.length, 3);
    score += WEIGHTS.RECENT_CORRECTION * multiplier;
    signals.push(`recent_corrections:${multiplier}`);
  }

  // Category keyword match from recent guidance
  for (const guidance of recentGuidance) {
    if (guidance.category && packCategories.includes(guidance.category)) {
      score += WEIGHTS.CATEGORY_MATCH;
      signals.push("category_match");
      break;
    }
  }

  // Path keyword → category boost
  const normalizedPath = filePath.toLowerCase();
  for (const [keyword, categories] of Object.entries(PATH_KEYWORD_CATEGORIES)) {
    if (normalizedPath.includes(keyword)) {
      const overlap = categories.some((cat) => packCategories.includes(cat));
      if (overlap) {
        score += WEIGHTS.CATEGORY_MATCH;
        signals.push(`path_keyword:${keyword}`);
        break;
      }
    }
  }

  return score;
}

interface ScoredPack {
  pack: LoadedPack;
  score: number;
}

// Packs that scored only via extension match (no path, sensitive, or correction signal)
// need a higher threshold to avoid injecting noise for generic .ts files.
const MIN_STRONG_RELEVANCE_SCORE = 10;
const MIN_WEAK_RELEVANCE_SCORE = 20;

/**
 * Check if a pack has a "strong" relevance signal beyond just file extension.
 * A pack is strongly relevant if the file matches its code_paths, sensitive_paths,
 * or the pack was boosted by recent corrections.
 */
function hasStrongSignal(pack: LoadedPack, filePath: string, recentGuidance: Guidance[]): boolean {
  const codePaths = pack.metadata.references?.code_paths || [];
  for (const codePath of codePaths) {
    if (filePath.includes(codePath)) return true;
  }

  const sensitivePaths = pack.metadata.sensitive_paths || [];
  for (const sensitivePath of sensitivePaths) {
    if (matchGlob(sensitivePath, filePath)) return true;
  }

  const packCategories = pack.metadata.categories || [];
  const hasCorrection = recentGuidance.some(
    (g) => g.type === "correction" && g.category && packCategories.includes(g.category)
  );
  if (hasCorrection) return true;

  return false;
}

/**
 * Select top packs by relevance score.
 * Packs with only weak signals (extension match) need a higher minimum score.
 */
export function selectTopPacks(scored: ScoredPack[], filePath?: string, recentGuidance?: Guidance[]): LoadedPack[] {
  return scored
    .filter((s) => {
      const strong = filePath && recentGuidance
        ? hasStrongSignal(s.pack, filePath, recentGuidance)
        : true;
      const threshold = strong ? MIN_STRONG_RELEVANCE_SCORE : MIN_WEAK_RELEVANCE_SCORE;
      return s.score >= threshold;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PACKS)
    .map((s) => s.pack);
}