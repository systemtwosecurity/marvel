// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Pending Decisions Tracker
 *
 * Tracks Bash commands that received "ask" decisions and are awaiting user response.
 * When a command later appears in PostToolUse, we know the user approved it.
 *
 * Uses in-memory storage with automatic cleanup of stale entries.
 */

import type { LogContext } from "./logger.js";
import { logDebug } from "./logger.js";

interface PendingDecision {
  command: string;
  description?: string;
  timestamp: number;
  reason: string;
}

// In-memory map of pending decisions
// Key: normalized command string
const pendingDecisions = new Map<string, PendingDecision>();

// How long to keep pending decisions (5 minutes)
const PENDING_TTL_MS = 5 * 60 * 1000;

// Cleanup interval (1 minute)
const CLEANUP_INTERVAL_MS = 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Normalize a command for use as a map key.
 * Trims whitespace and collapses multiple spaces.
 */
function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/**
 * Start the cleanup timer if not already running.
 */
function ensureCleanupTimer(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const cutoff = now - PENDING_TTL_MS;

    for (const [key, decision] of pendingDecisions.entries()) {
      if (decision.timestamp < cutoff) {
        pendingDecisions.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent process exit
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

/**
 * Add a command to the pending decisions set.
 * Called when PreToolUse returns "ask" for a Bash command.
 */
export function addPendingDecision(
  command: string,
  reason: string,
  description?: string,
  context?: LogContext
): void {
  ensureCleanupTimer();

  const key = normalizeCommand(command);
  const decision: PendingDecision = {
    command,
    description,
    timestamp: Date.now(),
    reason,
  };

  pendingDecisions.set(key, decision);
  logDebug(`Added pending decision for command: ${key.slice(0, 50)}...`, context);
}

/**
 * Check if a command has a pending decision and consume it.
 * Returns the pending decision if found (and removes it), null otherwise.
 *
 * Called from PostToolUse to check if a Bash command was previously "ask".
 */
export function consumePendingDecision(
  command: string,
  context?: LogContext
): PendingDecision | null {
  const key = normalizeCommand(command);
  const decision = pendingDecisions.get(key);

  if (!decision) {
    return null;
  }

  // Check if still within TTL
  const now = Date.now();
  if (now - decision.timestamp > PENDING_TTL_MS) {
    pendingDecisions.delete(key);
    return null;
  }

  // Consume the decision (remove from pending)
  pendingDecisions.delete(key);
  logDebug(`Consumed pending decision for command: ${key.slice(0, 50)}...`, context);

  return decision;
}

/**
 * Check if a command has a pending decision without consuming it.
 */
export function hasPendingDecision(command: string): boolean {
  const key = normalizeCommand(command);
  const decision = pendingDecisions.get(key);

  if (!decision) {
    return false;
  }

  // Check if still within TTL
  const now = Date.now();
  if (now - decision.timestamp > PENDING_TTL_MS) {
    pendingDecisions.delete(key);
    return false;
  }

  return true;
}

/**
 * Get the count of pending decisions (for debugging/stats).
 */
export function getPendingCount(): number {
  return pendingDecisions.size;
}

/**
 * Clear all pending decisions (useful for testing).
 */
export function clearPendingDecisions(): void {
  pendingDecisions.clear();
}