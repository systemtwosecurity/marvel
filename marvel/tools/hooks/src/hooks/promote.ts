// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Promote Hook
 *
 * Finds promotion candidates from security and domain pipelines.
 * Returns structured output for calling skills to present to the user.
 */

import type { SyncHookJSONOutput } from "../sdk-types.js";
import { buildHookContext } from "../lib/logger.js";
import { generatePromotionReport } from "../lib/promote.js";

export async function handlePromote(input: Record<string, unknown>): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("promote", input);
  const report = await generatePromotionReport(context);

  const lines: string[] = [];

  // Security candidates summary
  if (report.security.candidates.length > 0) {
    lines.push(`## Security Promotion Candidates`);
    lines.push(``);
    lines.push(
      `Found ${report.security.candidates.length} learned rules ready for promotion to allowlist.json:`
    );
    lines.push(``);
    for (const c of report.security.candidates) {
      lines.push(
        `- **${c.rule.pattern}** (${c.rule.type}) — seen ${c.frequency}x, reason: ${c.rule.reason}`
      );
    }
    if (report.security.duplicates > 0) {
      lines.push(``);
      lines.push(`_${report.security.duplicates} duplicates filtered._`);
    }
    if (report.security.unsafe > 0) {
      lines.push(`_${report.security.unsafe} unsafe patterns excluded._`);
    }
    lines.push(``);
  } else {
    lines.push(`No security candidates for promotion.`);
    lines.push(``);
  }

  // Domain candidates summary
  if (report.domain.candidates.length > 0) {
    lines.push(`## Domain Lesson Candidates`);
    lines.push(``);
    lines.push(
      `Found ${report.domain.candidates.length} corrections/directions from ${report.domain.totalGuidance} total guidance entries:`
    );
    lines.push(``);
    for (const c of report.domain.candidates) {
      lines.push(
        `- **${c.suggestedLesson.title}** → \`${c.suggestedPack}\` pack (confidence: ${c.confidence})`
      );
    }
    lines.push(``);
  } else {
    lines.push(
      `No domain lesson candidates (${report.domain.totalGuidance} guidance entries reviewed).`
    );
    lines.push(``);
  }

  const hasCandidates =
    report.security.candidates.length > 0 || report.domain.candidates.length > 0;

  if (hasCandidates) {
    lines.push(`---`);
    lines.push(
      `Review the candidates above. Approve, edit, or skip each one. Approved items will be written to their target files.`
    );
  }

  return {
    systemMessage: lines.join("\n"),
  };
}