// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { escapeForPromptTemplate } from "../promote.js";

describe("escapeForPromptTemplate", () => {
  it("escapes backslash-then-quote correctly", () => {
    // Input: \" should become \\\" (escaped backslash + escaped quote)
    const result = escapeForPromptTemplate('a\\"b');
    expect(result).toBe('a\\\\\\"b');
  });

  it("escapes newlines", () => {
    expect(escapeForPromptTemplate("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage returns", () => {
    expect(escapeForPromptTemplate("line1\rline2")).toBe("line1\\rline2");
  });

  it("escapes tabs", () => {
    expect(escapeForPromptTemplate("col1\tcol2")).toBe("col1\\tcol2");
  });

  it("escapes double quotes", () => {
    expect(escapeForPromptTemplate('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes backslashes", () => {
    expect(escapeForPromptTemplate("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("handles empty string", () => {
    expect(escapeForPromptTemplate("")).toBe("");
  });

  it("passes through plain text unchanged", () => {
    expect(escapeForPromptTemplate("hello world")).toBe("hello world");
  });

  it("escapes category with special characters", () => {
    const result = escapeForPromptTemplate('code-quality "strict"');
    expect(result).toBe('code-quality \\"strict\\"');
  });
});
