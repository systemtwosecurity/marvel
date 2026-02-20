// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { isSafeRegexPattern } from "../learned-rules.js";

describe("isSafeRegexPattern", () => {
  it("accepts plain literal strings", () => {
    expect(isSafeRegexPattern("git status")).toBe(true);
    expect(isSafeRegexPattern("pnpm install")).toBe(true);
    expect(isSafeRegexPattern("cat foo/bar")).toBe(true);
    expect(isSafeRegexPattern("npm run test")).toBe(true);
  });

  it("rejects each regex metacharacter", () => {
    const metacharacters = [".", "^", "$", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "\\"];
    for (const char of metacharacters) {
      expect(isSafeRegexPattern(`abc${char}def`)).toBe(false);
    }
  });

  it("rejects ReDoS pattern (a+)+", () => {
    expect(isSafeRegexPattern("(a+)+")).toBe(false);
  });

  it("rejects ReDoS pattern (a|aa)+", () => {
    expect(isSafeRegexPattern("(a|aa)+")).toBe(false);
  });

  it("rejects ReDoS pattern (a{1,99}){1,99}", () => {
    expect(isSafeRegexPattern("(a{1,99}){1,99}")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeRegexPattern("")).toBe(false);
  });

  it("rejects strings longer than 512 chars", () => {
    expect(isSafeRegexPattern("a".repeat(513))).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isSafeRegexPattern(null)).toBe(false);
    expect(isSafeRegexPattern(undefined)).toBe(false);
    expect(isSafeRegexPattern(42)).toBe(false);
    expect(isSafeRegexPattern({})).toBe(false);
    expect(isSafeRegexPattern([])).toBe(false);
  });

  it("accepts string at exactly 512 chars", () => {
    expect(isSafeRegexPattern("a".repeat(512))).toBe(true);
  });
});
