#!/usr/bin/env node
// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0
/**
 * MARVEL CLI
 *
 * Standalone entry point for querying MARVEL status, listing packs,
 * and running promotion. Used by slash commands and skills.
 *
 * Usage:
 *   node dist/cli.bundle.js query status
 *   node dist/cli.bundle.js query packs
 *   node dist/cli.bundle.js promote
 */

import { findMarvelRoot } from "../lib/paths.js";
import { compileMarvelStatus } from "../lib/marvel-status.js";
import { loadAllPacks } from "../loaders/pack-loader.js";
import { generatePromotionReport } from "../lib/promote.js";
import type { LogContext } from "../lib/logger.js";

const args = process.argv.slice(2);

function usage(): void {
  console.log(`MARVEL CLI

Usage:
  marvel-cli query status     Show session status
  marvel-cli query packs      List loaded packs
  marvel-cli promote          Find promotion candidates
  marvel-cli help             Show this help
`);
}

function makeContext(hookType: string): LogContext {
  return {
    hookType,
    sessionId: process.env.CLAUDE_SESSION_ID,
    daemonId: process.env.MARVEL_DAEMON_ID,
  };
}

async function queryStatus(): Promise<void> {
  const context = makeContext("cli-status");
  const result = compileMarvelStatus(context);

  // Extract the text from the hook output
  const specific = result.hookSpecificOutput as
    | { additionalContext?: string }
    | undefined;
  const text = specific?.additionalContext;

  if (text) {
    // Strip XML tags for clean terminal output
    const clean = text
      .replace(/<marvel-status>\n?/, "")
      .replace(/\n?<\/marvel-status>/, "");
    console.log(clean);
  } else {
    console.log("No MARVEL session status available.");
    console.log("Ensure the MARVEL daemon is running and a session is active.");
  }
}

async function queryPacks(): Promise<void> {
  const marvelRoot = findMarvelRoot();
  if (!marvelRoot) {
    console.error("Could not find MARVEL root directory.");
    console.error("Ensure you are in a project with a marvel/ directory.");
    process.exit(1);
  }

  const packs = await loadAllPacks(marvelRoot);

  if (packs.length === 0) {
    console.log("No packs found.");
    return;
  }

  console.log(`Found ${packs.length} packs:\n`);

  for (const pack of packs) {
    const meta = pack.metadata;
    const categories = meta.categories?.join(", ") || "none";
    const extensions = meta.applies_to?.extensions?.join(", ") || "any";
    const lessonCount = pack.lessons.length;

    console.log(`  ${meta.name}`);
    console.log(`    Description: ${meta.description || "—"}`);
    console.log(`    Categories:  ${categories}`);
    console.log(`    Extensions:  ${extensions}`);
    console.log(`    Lessons:     ${lessonCount}`);
    console.log();
  }
}

async function promote(): Promise<void> {
  const context = makeContext("cli-promote");
  const report = await generatePromotionReport(context);

  const lines: string[] = [];

  // Security candidates
  if (report.security.candidates.length > 0) {
    lines.push(`Security Promotion Candidates (${report.security.candidates.length}):`);
    lines.push("");
    for (const c of report.security.candidates) {
      lines.push(
        `  - ${c.rule.pattern} (${c.rule.type}) — seen ${c.frequency}x, reason: ${c.rule.reason}`
      );
    }
    if (report.security.duplicates > 0) {
      lines.push(`  (${report.security.duplicates} duplicates filtered)`);
    }
    if (report.security.unsafe > 0) {
      lines.push(`  (${report.security.unsafe} unsafe patterns excluded)`);
    }
    lines.push("");
  } else {
    lines.push("No security candidates for promotion.");
    lines.push("");
  }

  // Domain candidates
  if (report.domain.candidates.length > 0) {
    lines.push(
      `Domain Lesson Candidates (${report.domain.candidates.length} from ${report.domain.totalGuidance} guidance entries):`
    );
    lines.push("");
    for (const c of report.domain.candidates) {
      lines.push(
        `  - ${c.suggestedLesson.title} → ${c.suggestedPack} pack (confidence: ${c.confidence})`
      );
    }
    lines.push("");
  } else {
    lines.push(
      `No domain lesson candidates (${report.domain.totalGuidance} guidance entries reviewed).`
    );
    lines.push("");
  }

  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const command = args[0];
  const subcommand = args[1];

  switch (command) {
    case "query":
      switch (subcommand) {
        case "status":
          await queryStatus();
          break;
        case "packs":
          await queryPacks();
          break;
        default:
          console.error(`Unknown query subcommand: ${subcommand}`);
          usage();
          process.exit(1);
      }
      break;

    case "promote":
      await promote();
      break;

    case "help":
    case "--help":
    case "-h":
      usage();
      break;

    default:
      if (!command) {
        usage();
      } else {
        console.error(`Unknown command: ${command}`);
        usage();
        process.exit(1);
      }
  }
}

main().catch((err: unknown) => {
  console.error("MARVEL CLI error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});