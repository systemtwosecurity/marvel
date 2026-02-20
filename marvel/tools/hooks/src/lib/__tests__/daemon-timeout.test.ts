// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { buildTimeoutResponse } from "../timeout-response.js";

describe("buildTimeoutResponse", () => {
  it("returns fail-ask for pre-tool-use security timeout", () => {
    const result = buildTimeoutResponse("pre-tool-use", true);
    expect(result).toHaveProperty("hookSpecificOutput");
    const output = (result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
    expect(output.hookEventName).toBe("PreToolUse");
    expect(output.permissionDecision).toBe("ask");
    expect(output.permissionDecisionReason).toBe("Security evaluation timed out");
  });

  it("returns empty object for permission-request security timeout", () => {
    const result = buildTimeoutResponse("permission-request", true);
    expect(result).toEqual({});
  });

  it("returns empty object for non-security hooks", () => {
    const result = buildTimeoutResponse("stop", false);
    expect(result).toEqual({});
  });

  it("returns empty object for session-start", () => {
    const result = buildTimeoutResponse("session-start", false);
    expect(result).toEqual({});
  });
});
