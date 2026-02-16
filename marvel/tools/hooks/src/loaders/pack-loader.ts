// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Pack Loader
 *
 * Loads pack metadata and lessons with caching.
 */

import * as fs from "fs";
import * as path from "path";
import type { PackMetadata, LoadedPack, Lesson } from "../types.js";

interface CacheEntry {
  pack: LoadedPack;
  loadedAt: number;
  packJsonMtime: number;
  lessonsJsonlMtime: number;
}

const packCache = new Map<string, CacheEntry>();

function getFileMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function loadLessons(lessonsPath: string): Lesson[] {
  if (!fs.existsSync(lessonsPath)) {
    return [];
  }

  const content = fs.readFileSync(lessonsPath, "utf-8").trim();
  if (!content) {
    return [];
  }

  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        // Validate required Lesson fields
        if (
          typeof parsed.title !== "string" ||
          !parsed.title.trim() ||
          typeof parsed.actionable !== "string" ||
          !parsed.actionable.trim()
        ) {
          console.error(
            `[marvel] Skipping malformed lesson at line ${index + 1} in ${lessonsPath}: missing or empty title/actionable`
          );
          return null;
        }
        return parsed as unknown as Lesson;
      } catch {
        return null;
      }
    })
    .filter((lesson): lesson is Lesson => lesson !== null);
}

function loadPack(packDir: string): LoadedPack | null {
  const packJsonPath = path.join(packDir, "pack.json");
  const lessonsPath = path.join(packDir, "lessons.jsonl");
  const guardrailsPath = path.join(packDir, "guardrails.md");

  if (!fs.existsSync(packJsonPath)) {
    return null;
  }

  const packName = path.basename(packDir);
  const packJsonMtime = getFileMtime(packJsonPath);
  const lessonsJsonlMtime = getFileMtime(lessonsPath);

  // Check cache
  const cached = packCache.get(packName);
  if (
    cached &&
    cached.packJsonMtime === packJsonMtime &&
    cached.lessonsJsonlMtime === lessonsJsonlMtime
  ) {
    return cached.pack;
  }

  // Load fresh
  try {
    const metadata = JSON.parse(
      fs.readFileSync(packJsonPath, "utf-8")
    ) as PackMetadata;
    const lessons = loadLessons(lessonsPath);

    const pack: LoadedPack = {
      metadata,
      lessons,
      guardrailsPath,
      loadedAt: Date.now(),
    };

    // Update cache
    packCache.set(packName, {
      pack,
      loadedAt: Date.now(),
      packJsonMtime,
      lessonsJsonlMtime,
    });

    return pack;
  } catch {
    return null;
  }
}

/**
 * Load all packs from the marvel/packs directory.
 */
export async function loadAllPacks(marvelRoot: string): Promise<LoadedPack[]> {
  const packsDir = path.join(marvelRoot, "packs");

  if (!fs.existsSync(packsDir)) {
    return [];
  }

  const packDirs = fs
    .readdirSync(packsDir)
    .filter((name) => !name.startsWith("_"))
    .map((name) => path.join(packsDir, name))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });

  const packs: LoadedPack[] = [];

  for (const packDir of packDirs) {
    const pack = loadPack(packDir);
    if (pack) {
      packs.push(pack);
    }
  }

  return packs;
}