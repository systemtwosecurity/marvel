// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { calculateRelevance, selectTopPacks } from "../relevance.js";
import type { LoadedPack, Guidance } from "../../types.js";

function makePack(overrides: Partial<LoadedPack["metadata"]> = {}): LoadedPack {
  return {
    metadata: {
      name: "test-pack",
      version: "1.0.0",
      owner: "test",
      description: "Test pack",
      categories: ["test"],
      applies_to: { extensions: [".ts"] },
      ...overrides,
    },
    lessons: [],
    guardrailsPath: "/mock/guardrails.md",
    loadedAt: Date.now(),
  };
}

function makeGuidance(overrides: Partial<Guidance> = {}): Guidance {
  return {
    id: "g_test",
    timestamp: new Date().toISOString(),
    run_id: "run_test",
    type: "correction",
    content: "test correction",
    confidence: 0.8,
    ...overrides,
  };
}

describe("calculateRelevance", () => {
  describe("excludes_paths", () => {
    it("returns 0 when file matches excludes_paths", () => {
      const pack = makePack({
        excludes_paths: ["marvel/", "node_modules/"],
        references: { code_paths: ["src/"] },
      });
      const score = calculateRelevance(
        pack,
        "/project/marvel/tools/hooks/src/lib/relevance.ts",
        []
      );
      expect(score).toBe(0);
    });

    it("returns 0 for node_modules exclusion", () => {
      const pack = makePack({
        excludes_paths: ["node_modules/"],
      });
      const score = calculateRelevance(
        pack,
        "/project/node_modules/@tanstack/react-query/index.ts",
        []
      );
      expect(score).toBe(0);
    });

    it("scores normally when file does not match excludes_paths", () => {
      const pack = makePack({
        excludes_paths: ["marvel/", "node_modules/"],
        references: { code_paths: ["src/app/"] },
      });
      const score = calculateRelevance(
        pack,
        "/project/src/app/page.tsx",
        []
      );
      expect(score).toBeGreaterThan(0);
    });

    it("scores normally when excludes_paths is empty", () => {
      const pack = makePack({
        excludes_paths: [],
      });
      const score = calculateRelevance(
        pack,
        "/project/marvel/tools/hooks/src/lib/foo.ts",
        []
      );
      // Extension match only = 5
      expect(score).toBe(5);
    });

    it("scores normally when excludes_paths is undefined", () => {
      const pack = makePack();
      const score = calculateRelevance(
        pack,
        "/project/marvel/tools/hooks/src/lib/foo.ts",
        []
      );
      expect(score).toBe(5);
    });
  });

  describe("scoring signals", () => {
    it("scores extension match only as 5", () => {
      const pack = makePack();
      const score = calculateRelevance(pack, "/project/src/foo.ts", []);
      expect(score).toBe(5);
    });

    it("scores code_path match + extension as 20", () => {
      const pack = makePack({
        references: { code_paths: ["src/hooks/"] },
      });
      const score = calculateRelevance(pack, "/project/src/hooks/useFoo.ts", []);
      expect(score).toBe(20); // 5 (ext) + 15 (code_path)
    });

    it("scores sensitive_path match + extension as 25", () => {
      const pack = makePack({
        applies_to: { extensions: [".ts", ".tsx"] },
        sensitive_paths: ["src/app/**/page.tsx"],
      });
      const score = calculateRelevance(
        pack,
        "/project/src/app/dashboard/page.tsx",
        []
      );
      expect(score).toBe(25); // 5 (ext) + 20 (sensitive)
    });

    it("boosts for recent corrections in pack category", () => {
      const pack = makePack({ categories: ["async"] });
      const guidance = makeGuidance({ category: "async" });
      const score = calculateRelevance(pack, "/project/src/foo.ts", [guidance]);
      // 5 (ext) + 20 (correction) + 8 (category_match)
      expect(score).toBe(33);
    });
  });
});

describe("selectTopPacks", () => {
  it("filters out packs below strong threshold (10) when they have path match", () => {
    const pack = makePack({
      references: { code_paths: ["src/app/"] },
    });
    const scored = [{ pack, score: 9 }];
    const result = selectTopPacks(scored, "/project/src/app/page.ts", []);
    expect(result).toHaveLength(0);
  });

  it("allows packs at strong threshold (10) with path match", () => {
    const pack = makePack({
      references: { code_paths: ["src/app/"] },
    });
    const scored = [{ pack, score: 10 }];
    const result = selectTopPacks(scored, "/project/src/app/page.ts", []);
    expect(result).toHaveLength(1);
  });

  it("filters extension-only packs below weak threshold (20)", () => {
    // Pack with no code_paths or sensitive_paths matching the file
    const pack = makePack({
      references: { code_paths: ["backend/src/routes/"] },
      sensitive_paths: ["backend/src/middleware/"],
    });
    // Score of 15 is above strong threshold but below weak threshold
    const scored = [{ pack, score: 15 }];
    const result = selectTopPacks(scored, "/project/marvel/tools/hooks/src/foo.ts", []);
    expect(result).toHaveLength(0);
  });

  it("allows extension-only packs at weak threshold (20)", () => {
    const pack = makePack({
      references: { code_paths: ["backend/src/routes/"] },
    });
    const scored = [{ pack, score: 20 }];
    const result = selectTopPacks(scored, "/project/marvel/tools/hooks/src/foo.ts", []);
    expect(result).toHaveLength(1);
  });

  it("returns max 4 packs sorted by score", () => {
    const packs = Array.from({ length: 6 }, (_, i) =>
      makePack({ name: `pack-${i}`, references: { code_paths: ["src/"] } })
    );
    const scored = packs.map((pack, i) => ({ pack, score: 30 - i }));
    const result = selectTopPacks(scored, "/project/src/foo.ts", []);
    expect(result).toHaveLength(4);
    expect(result[0].metadata.name).toBe("pack-0");
    expect(result[3].metadata.name).toBe("pack-3");
  });

  it("falls back to strong threshold when filePath not provided", () => {
    const pack = makePack();
    const scored = [{ pack, score: 10 }];
    const result = selectTopPacks(scored);
    expect(result).toHaveLength(1);
  });
});