// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import type { SyncHookJSONOutput } from "../sdk-types.js";

/**
 * Build an appropriate timeout response based on hook type.
 * For pre-tool-use security hooks, returns a fail-ask response
 * instead of empty {} (which would mean passthrough/allow).
 */
export function buildTimeoutResponse(hookType: string, isSecurity: boolean): SyncHookJSONOutput {
  if (isSecurity && hookType === "pre-tool-use") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Security evaluation timed out",
      },
    } as SyncHookJSONOutput;
  }
  return {};
}
