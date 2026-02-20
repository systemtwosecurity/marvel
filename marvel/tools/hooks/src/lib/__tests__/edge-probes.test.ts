// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Edge-case tests for learned-rules safety validation.
 *
 * Documents current behavior for bare SUBCOMMAND_PREFIXES commands
 * and LLM-suggested overly broad patterns.
 *
 * GAP 1: isPatternSafe does not check SUBCOMMAND_PREFIXES — bare commands
 *        like "docker" (6 chars) pass all safety checks, even though
 *        "docker rm -f" and "docker system prune" are very different from
 *        "docker build".
 *
 * GAP 2: When an LLM-suggested pattern fails isPatternSafe, addLearnedRule
 *        returns null without falling back to extractPattern. This means the
 *        command can never converge (never skips the LLM).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { isPatternSafe, addLearnedRule, extractPattern, clearSessionRules } from "../learned-rules.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

beforeEach(() => { clearSessionRules(); });

describe("GAP 1: bare SUBCOMMAND_PREFIXES pass isPatternSafe", () => {
  // These commands are in SUBCOMMAND_PREFIXES, meaning they have subcommands
  // that completely change their behavior (docker build vs docker rm -f).
  // Currently, bare patterns pass safety checks because they are not in
  // REQUIRES_SUBCOMMAND and meet MIN_PATTERN_LENGTH.

  it("isPatternSafe('docker', 'docker') — currently safe (6 chars)", () => {
    const result = isPatternSafe("docker", "docker");
    // GAP: docker is in SUBCOMMAND_PREFIXES but passes — allows ALL docker commands
    expect(result.safe).toBe(true);
  });

  it("isPatternSafe('kubectl', 'kubectl') — currently safe (7 chars)", () => {
    const result = isPatternSafe("kubectl", "kubectl");
    expect(result.safe).toBe(true);
  });

  it("isPatternSafe('cargo', 'cargo') — currently safe (5 chars)", () => {
    const result = isPatternSafe("cargo", "cargo");
    expect(result.safe).toBe(true);
  });

  it("isPatternSafe('systemctl', 'systemctl') — currently safe (9 chars)", () => {
    const result = isPatternSafe("systemctl", "systemctl");
    expect(result.safe).toBe(true);
  });

  // Two-token subcommand patterns ARE specific enough — these should stay safe
  it("isPatternSafe('docker compose', 'docker') — safe (specific)", () => {
    const result = isPatternSafe("docker compose", "docker");
    expect(result.safe).toBe(true);
  });

  it("isPatternSafe('kubectl get', 'kubectl') — safe (specific)", () => {
    const result = isPatternSafe("kubectl get", "kubectl");
    expect(result.safe).toBe(true);
  });
});

describe("GAP 1 impact: LLM-suggested overly broad patterns accepted", () => {
  it("addLearnedRule with suggested 'docker' for 'docker compose up -d' — accepted", () => {
    // GAP: LLM suggestion of bare "docker" is accepted, auto-allowing ALL docker commands
    const rule = addLearnedRule("docker compose up -d", undefined, {
      type: "prefix", pattern: "docker", reason: "docker commands"
    });
    expect(rule).not.toBeNull();
    expect(rule!.pattern).toBe("docker");
    // This means docker rm -f, docker system prune, etc. would all be auto-allowed
  });

  it("addLearnedRule with suggested 'kubectl' for 'kubectl get pods' — accepted", () => {
    const rule = addLearnedRule("kubectl get pods", undefined, {
      type: "prefix", pattern: "kubectl", reason: "k8s management"
    });
    expect(rule).not.toBeNull();
    expect(rule!.pattern).toBe("kubectl");
  });

  // extractPattern would give a better, more specific result
  it("extractPattern('docker compose up -d') gives specific 'docker compose'", () => {
    const result = extractPattern("docker compose up -d");
    expect(result.pattern).toBe("docker compose");
  });

  it("extractPattern('kubectl get pods') gives specific 'kubectl get'", () => {
    const result = extractPattern("kubectl get pods");
    expect(result.pattern).toBe("kubectl get");
  });
});

describe("GAP 2: no fallback to extractPattern when LLM suggestion rejected", () => {
  it("addLearnedRule with rejected 'sudo apt' has no fallback — returns null", () => {
    // LLM suggests "sudo apt" → isPatternSafe rejects (sudo is DANGEROUS_BASE_COMMANDS)
    // addLearnedRule returns null — no fallback to extractPattern
    const rule = addLearnedRule("sudo apt update", undefined, {
      type: "prefix", pattern: "sudo apt", reason: "package management"
    });
    expect(rule).toBeNull();
    // For sudo, null IS correct — sudo should never be learned
  });

  it("extractPattern-only path works fine for safe commands", () => {
    // Without a suggestedRule, extractPattern is used and produces good results
    const rule = addLearnedRule("docker compose up -d");
    expect(rule).not.toBeNull();
    expect(rule!.pattern).toBe("docker compose");
  });
});
