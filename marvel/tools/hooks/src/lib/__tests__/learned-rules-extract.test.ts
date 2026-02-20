// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { extractPattern, isPatternSafe } from "../learned-rules.js";

describe("extractPattern — compound commands", () => {
  it("cd /path && npx drizzle-kit → npx drizzle-kit", () => {
    const { pattern } = extractPattern("cd /path/to/project && npx drizzle-kit push");
    expect(pattern).toBe("npx drizzle-kit");
  });

  it("source .env && pnpm tsx scripts/foo.ts → pnpm tsx", () => {
    const { pattern } = extractPattern("source .env && pnpm tsx scripts/foo.ts");
    expect(pattern).toBe("pnpm tsx");
  });

  it("# comment\\ncat file → cat", () => {
    const { pattern } = extractPattern("# this is a comment\ncat file.txt");
    expect(pattern).toBe("cat");
  });

  it("set -e && source .env && npx vitest run → npx vitest", () => {
    const { pattern } = extractPattern("set -e && source .env && npx vitest run");
    expect(pattern).toBe("npx vitest");
  });

  it("export FOO=bar && git status → git status", () => {
    const { pattern } = extractPattern("export FOO=bar && git status");
    expect(pattern).toBe("git status");
  });
});

describe("extractPattern — flag-subcommands", () => {
  it("node -e '...' → node -e", () => {
    const { pattern, type } = extractPattern('node -e "console.log(1)"');
    expect(pattern).toBe("node -e");
    expect(type).toBe("prefix");
  });

  it("node --eval '...' → node --eval", () => {
    const { pattern } = extractPattern('node --eval "process.exit(0)"');
    expect(pattern).toBe("node --eval");
  });

  it("python -c '...' → python -c", () => {
    const { pattern } = extractPattern("python -c 'import sys; print(sys.version)'");
    expect(pattern).toBe("python -c");
  });

  it("python3 -m http.server → python3 -m", () => {
    const { pattern } = extractPattern("python3 -m http.server 8000");
    expect(pattern).toBe("python3 -m");
  });

  it("ruby -e '...' → ruby -e", () => {
    const { pattern } = extractPattern("ruby -e 'puts 42'");
    expect(pattern).toBe("ruby -e");
  });

  it("perl -e '...' → perl -e", () => {
    const { pattern } = extractPattern("perl -e 'print 42'");
    expect(pattern).toBe("perl -e");
  });
});

describe("extractPattern — npx as subcommand prefix", () => {
  it("npx drizzle-kit push → npx drizzle-kit", () => {
    const { pattern } = extractPattern("npx drizzle-kit push");
    expect(pattern).toBe("npx drizzle-kit");
  });

  it("npx vitest run → npx vitest", () => {
    const { pattern } = extractPattern("npx vitest run");
    expect(pattern).toBe("npx vitest");
  });
});

describe("extractPattern — absolute paths to project-relative", () => {
  it("converts absolute path under project root to relative prefix", () => {
    const originalEnv = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = "/Users/test/project";
    try {
      const { pattern } = extractPattern("rm /Users/test/project/backend/src/file.ts");
      expect(pattern).toBe("rm backend/");
    } finally {
      process.env.CLAUDE_PROJECT_DIR = originalEnv;
    }
  });
});

describe("extractPattern — gh as subcommand prefix", () => {
  it("gh pr list → gh pr", () => {
    const { pattern, type } = extractPattern("gh pr list");
    expect(pattern).toBe("gh pr");
    expect(type).toBe("prefix");
  });

  it("gh issue view 123 → gh issue", () => {
    const { pattern } = extractPattern("gh issue view 123");
    expect(pattern).toBe("gh issue");
  });

  it("gh api repos/owner/repo → gh api", () => {
    const { pattern } = extractPattern("gh api repos/owner/repo");
    expect(pattern).toBe("gh api");
  });
});

describe("isPatternSafe", () => {
  it("accepts gh pr (5 chars)", () => {
    const result = isPatternSafe("gh pr", "gh");
    expect(result.safe).toBe(true);
  });

  it("accepts node -e (6 chars)", () => {
    const result = isPatternSafe("node -e", "node");
    expect(result.safe).toBe(true);
  });

  it("rejects bare npx (3 chars)", () => {
    const result = isPatternSafe("npx", "npx");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("too short");
  });

  it("rejects sudo", () => {
    const result = isPatternSafe("sudo rm -rf", "sudo");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("sudo");
  });

  it("accepts npx drizzle-kit (14 chars)", () => {
    const result = isPatternSafe("npx drizzle-kit", "npx");
    expect(result.safe).toBe(true);
  });

  it("rejects bare rm without subcommand", () => {
    const result = isPatternSafe("rm", "rm");
    expect(result.safe).toBe(false);
  });

  it("accepts rm backend/ (11 chars, has path context)", () => {
    const result = isPatternSafe("rm backend/", "rm");
    expect(result.safe).toBe(true);
  });
});