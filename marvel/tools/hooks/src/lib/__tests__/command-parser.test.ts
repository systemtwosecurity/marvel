// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  stripLeadingComments,
  splitCompoundCommand,
  isPreambleCommand,
  extractMeaningfulCommand,
  getAllSegments,
  toProjectRelativePath,
} from "../command-parser.js";

describe("stripLeadingComments", () => {
  it("removes leading comment lines", () => {
    expect(stripLeadingComments("# this is a comment\ncat file")).toBe("cat file");
  });

  it("removes multiple leading comment lines", () => {
    expect(stripLeadingComments("# line 1\n# line 2\necho hello")).toBe("echo hello");
  });

  it("removes blank lines before the command", () => {
    expect(stripLeadingComments("\n\n# comment\nls")).toBe("ls");
  });

  it("is a no-op when there are no comments", () => {
    expect(stripLeadingComments("git status")).toBe("git status");
  });

  it("preserves inline comments in the command", () => {
    expect(stripLeadingComments("cat file # inline comment")).toBe("cat file # inline comment");
  });
});

describe("splitCompoundCommand", () => {
  it("splits on &&", () => {
    expect(splitCompoundCommand("cd /tmp && ls")).toEqual(["cd /tmp", "ls"]);
  });

  it("splits on ||", () => {
    expect(splitCompoundCommand("test -f x || echo missing")).toEqual(["test -f x", "echo missing"]);
  });

  it("splits on ;", () => {
    expect(splitCompoundCommand("echo a; echo b")).toEqual(["echo a", "echo b"]);
  });

  it("handles mixed operators", () => {
    expect(splitCompoundCommand("cd /tmp && ls; echo done || true")).toEqual([
      "cd /tmp", "ls", "echo done", "true",
    ]);
  });

  it("respects single-quoted strings", () => {
    expect(splitCompoundCommand("echo '&& not split'")).toEqual(["echo '&& not split'"]);
  });

  it("respects double-quoted strings", () => {
    expect(splitCompoundCommand('echo "a && b"')).toEqual(['echo "a && b"']);
  });

  it("respects $(...) subshells", () => {
    expect(splitCompoundCommand("echo $(cd /tmp && pwd)")).toEqual(["echo $(cd /tmp && pwd)"]);
  });

  it("returns single segment for simple commands", () => {
    expect(splitCompoundCommand("git status")).toEqual(["git status"]);
  });

  it("does not split on single pipe", () => {
    expect(splitCompoundCommand("cat file | grep foo")).toEqual(["cat file | grep foo"]);
  });
});

describe("isPreambleCommand", () => {
  it("identifies cd as preamble", () => {
    expect(isPreambleCommand("cd /some/path")).toBe(true);
  });

  it("identifies set as preamble", () => {
    expect(isPreambleCommand("set -e")).toBe(true);
  });

  it("identifies source as preamble", () => {
    expect(isPreambleCommand("source .env")).toBe(true);
  });

  it("identifies dot-source as preamble", () => {
    expect(isPreambleCommand(". .env")).toBe(true);
  });

  it("identifies export as preamble", () => {
    expect(isPreambleCommand("export FOO=bar")).toBe(true);
  });

  it("identifies bare VAR=value as preamble", () => {
    expect(isPreambleCommand("NODE_ENV=production")).toBe(true);
  });

  it("rejects git as non-preamble", () => {
    expect(isPreambleCommand("git status")).toBe(false);
  });

  it("rejects npx as non-preamble", () => {
    expect(isPreambleCommand("npx drizzle-kit push")).toBe(false);
  });

  it("rejects pnpm as non-preamble", () => {
    expect(isPreambleCommand("pnpm test:run")).toBe(false);
  });
});

describe("extractMeaningfulCommand", () => {
  it("extracts npx from cd+npx compound", () => {
    const result = extractMeaningfulCommand("cd /path/to/project && npx drizzle-kit push");
    expect(result).not.toBeNull();
    expect(result!.executable).toBe("npx");
    expect(result!.args[0]).toBe("drizzle-kit");
  });

  it("skips set+source preamble to find npx", () => {
    const result = extractMeaningfulCommand("set -e && source .env && npx vitest run");
    expect(result).not.toBeNull();
    expect(result!.executable).toBe("npx");
    expect(result!.args[0]).toBe("vitest");
  });

  it("strips leading comments before parsing", () => {
    const result = extractMeaningfulCommand("# this is a comment\ncat file.txt");
    expect(result).not.toBeNull();
    expect(result!.executable).toBe("cat");
  });

  it("handles node -e with inline script", () => {
    const result = extractMeaningfulCommand('node -e "console.log(1)"');
    expect(result).not.toBeNull();
    expect(result!.executable).toBe("node");
    expect(result!.args[0]).toBe("-e");
  });

  it("handles source+pnpm tsx", () => {
    const result = extractMeaningfulCommand("source .env && pnpm tsx scripts/foo.ts");
    expect(result).not.toBeNull();
    expect(result!.executable).toBe("pnpm");
    expect(result!.args[0]).toBe("tsx");
  });

  it("returns null for empty input", () => {
    expect(extractMeaningfulCommand("")).toBeNull();
  });

  it("returns null for only comments", () => {
    expect(extractMeaningfulCommand("# just a comment")).toBeNull();
  });

  it("falls back to last preamble segment if all are preamble", () => {
    const result = extractMeaningfulCommand("cd /tmp && export FOO=bar");
    expect(result).not.toBeNull();
    expect(result!.executable).toBe("export");
  });
});

describe("getAllSegments", () => {
  it("returns all segments from a compound command", () => {
    const segments = getAllSegments("cd /tmp && npx drizzle-kit push && echo done");
    expect(segments).toHaveLength(3);
    expect(segments[0].executable).toBe("cd");
    expect(segments[1].executable).toBe("npx");
    expect(segments[2].executable).toBe("echo");
  });

  it("returns empty array for empty input", () => {
    expect(getAllSegments("")).toEqual([]);
  });

  it("returns single segment for simple command", () => {
    const segments = getAllSegments("git status");
    expect(segments).toHaveLength(1);
    expect(segments[0].executable).toBe("git");
  });
});

describe("toProjectRelativePath", () => {
  it("converts absolute path under project root to relative", () => {
    expect(
      toProjectRelativePath(
        "/Users/foo/project/backend/src/file.ts",
        "/Users/foo/project"
      )
    ).toBe("backend/src/file.ts");
  });

  it("returns original path if outside project root", () => {
    expect(
      toProjectRelativePath(
        "/other/path/file.ts",
        "/Users/foo/project"
      )
    ).toBe("/other/path/file.ts");
  });

  it("handles project root with trailing slash", () => {
    expect(
      toProjectRelativePath(
        "/Users/foo/project/src/index.ts",
        "/Users/foo/project/"
      )
    ).toBe("src/index.ts");
  });

  it("returns original path when no project root available", () => {
    expect(
      toProjectRelativePath("/abs/path/file.ts", undefined)
    ).toBe("/abs/path/file.ts");
  });
});