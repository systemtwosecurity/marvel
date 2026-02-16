// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { summarize, getInputSummary, MAX_SUMMARY_LENGTH } from "../tool-summary.js";

describe("summarize", () => {
  it("returns empty string for null", () => {
    expect(summarize(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(summarize(undefined)).toBe("");
  });

  it("returns string as-is when under max length", () => {
    expect(summarize("hello")).toBe("hello");
  });

  it("truncates strings over max length", () => {
    const long = "a".repeat(300);
    const result = summarize(long);
    expect(result.length).toBe(MAX_SUMMARY_LENGTH);
    expect(result.endsWith("...")).toBe(true);
  });

  it("respects custom max length", () => {
    const result = summarize("hello world", 8);
    expect(result).toBe("hello...");
    expect(result.length).toBe(8);
  });

  it("serializes objects to JSON", () => {
    expect(summarize({ key: "value" })).toBe('{"key":"value"}');
  });

  it("serializes arrays to JSON", () => {
    expect(summarize([1, 2, 3])).toBe("[1,2,3]");
  });
});

describe("getInputSummary", () => {
  it("returns empty string for empty input", () => {
    expect(getInputSummary({})).toBe("");
  });

  it("extracts file_path", () => {
    expect(getInputSummary({ tool_input: { file_path: "/src/index.ts" } })).toBe("/src/index.ts");
  });

  it("extracts path when file_path not present", () => {
    expect(getInputSummary({ tool_input: { path: "/src/components" } })).toBe("/src/components");
  });

  it("extracts command", () => {
    expect(getInputSummary({ tool_input: { command: "pnpm build" } })).toBe("pnpm build");
  });

  it("extracts pattern", () => {
    expect(getInputSummary({ tool_input: { pattern: "*.ts" } })).toBe("*.ts");
  });

  it("serializes full tool_input as fallback", () => {
    expect(getInputSummary({ tool_input: { other: "data" } })).toBe('{"other":"data"}');
  });
});