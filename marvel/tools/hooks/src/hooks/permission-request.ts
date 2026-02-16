// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * PermissionRequest Hook
 *
 * Handles Claude Code permission requests for Bash commands.
 * Delegates to the bash-security-gate for the full security pipeline:
 *   1. External allowlist (loads marvel/security/allowlist.json)
 *   2. External denylist (loads marvel/security/denylist.json)
 *   3. Learned rules (user previously approved similar commands)
 *   4. LLM analysis with suggestions support
 */

import type { PermissionRequestHookInput, SyncHookJSONOutput } from "../sdk-types.js";
import { evaluateBashCommand } from "../lib/bash-security-gate.js";
import { allow, deny, askUser } from "../lib/security-llm.js";
import { buildHookContext } from "../lib/logger.js";

/**
 * Handle a permission request from Claude Code.
 *
 * Input format:
 * {
 *   tool_name: "Bash",
 *   tool_input: {
 *     command: "rm -rf /tmp/foo",
 *     description?: "Delete temporary files"
 *   }
 * }
 *
 * Output format:
 * {
 *   hookSpecificOutput: {
 *     hookEventName: "PermissionRequest",
 *     decision: {
 *       behavior: "allow" | "deny" | "ask",
 *       message?: "reason"
 *     }
 *   }
 * }
 */
export async function handlePermissionRequest(
  input: PermissionRequestHookInput
): Promise<SyncHookJSONOutput> {
  // Only handle Bash commands
  if (input.tool_name !== "Bash") {
    // Non-Bash tools: let user decide
    return askUser();
  }

  const toolInput = input.tool_input as Record<string, unknown> | undefined;
  const command = toolInput?.command as string | undefined;
  if (!command) {
    return askUser("No command provided");
  }

  const description = toolInput?.description as string | undefined;
  const context = buildHookContext("permission-request", input);

  const result = await evaluateBashCommand(command, description, context);

  switch (result.decision) {
    case "allow":
      return allow();
    case "deny":
      return deny(result.reason);
    case "ask":
    default:
      return askUser(result.reason);
  }
}