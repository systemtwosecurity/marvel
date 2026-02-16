// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Claude Code Compatibility Checker
 *
 * Runtime verification that MARVEL is compatible with the current Claude Code version.
 * Call checkCompatibility() on hooks startup to detect version mismatches.
 */

import { execSync } from 'node:child_process';
import { CLAUDE_CODE_VERSION, getAllToolNames, getAllHookTypes } from './constants.js';

/**
 * Compatibility check result
 */
export interface CompatibilityResult {
  compatible: boolean;
  version: {
    expected: string;
    detected: string | null;
    match: boolean;
  };
  warnings: string[];
  errors: string[];
}

/**
 * Parse version string into components
 */
export function parseVersion(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two versions
 * Returns: -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;

  return 0;
}

/**
 * Detect Claude Code version from environment
 * Returns null if unable to detect
 */
export function detectClaudeCodeVersion(): string | null {
  try {
    // Try running 'claude --version'
    const output = execSync('claude --version 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    // Parse version from output (format may vary)
    const match = output.match(/(\d+\.\d+\.\d+)/);
    if (match) {
      return match[1];
    }

    return output;
  } catch {
    // Claude Code CLI not available or command failed
    return null;
  }
}

/**
 * Check if detected version is compatible with expected version
 */
export function isVersionCompatible(detected: string, expected: string): boolean {
  const vDetected = parseVersion(detected);
  const vExpected = parseVersion(expected);

  if (!vDetected || !vExpected) return false;

  // Major version must match
  if (vDetected.major !== vExpected.major) return false;

  // Minor version should be >= expected (backward compatible)
  if (vDetected.minor < vExpected.minor) return false;

  return true;
}

/**
 * Verify a tool call matches expected format
 */
export function verifyToolCall(
  toolName: string,
  _params: Record<string, unknown>,
): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check if tool name is known
  if (!getAllToolNames().includes(toolName)) {
    warnings.push(`Unknown tool: ${toolName}. May be a new Claude Code feature.`);
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Verify hook type is supported
 */
export function verifyHookType(hookType: string): boolean {
  return getAllHookTypes().includes(hookType);
}

/**
 * Run full compatibility check
 */
export function checkCompatibility(): CompatibilityResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Detect Claude Code version
  const detectedVersion = detectClaudeCodeVersion();
  const expectedVersion = CLAUDE_CODE_VERSION.full;

  let versionMatch = false;

  if (detectedVersion === null) {
    warnings.push(
      'Unable to detect Claude Code version. ' +
        'MARVEL assumes Claude Code v' +
        expectedVersion +
        '. ' +
        'If running outside Claude Code, this is expected.',
    );
  } else if (!isVersionCompatible(detectedVersion, expectedVersion)) {
    const comparison = compareVersions(detectedVersion, expectedVersion);

    if (comparison < 0) {
      errors.push(
        `Claude Code version ${detectedVersion} is older than expected ${expectedVersion}. ` +
          'Some features may not work correctly. Consider updating Claude Code.',
      );
    } else {
      warnings.push(
        `Claude Code version ${detectedVersion} is newer than expected ${expectedVersion}. ` +
          'MARVEL should still work, but check for breaking changes in Claude Code.',
      );
    }
  } else {
    versionMatch = true;
  }

  const compatible = errors.length === 0;

  return {
    compatible,
    version: {
      expected: expectedVersion,
      detected: detectedVersion,
      match: versionMatch,
    },
    warnings,
    errors,
  };
}

/**
 * Log compatibility result to console
 */
export function logCompatibilityResult(result: CompatibilityResult): void {
  if (result.compatible) {
    if (result.version.match) {
      console.log(`✓ Claude Code compatibility: v${result.version.expected}`);
    } else if (result.version.detected) {
      console.log(
        `⚠ Claude Code v${result.version.detected} (expected v${result.version.expected})`,
      );
    }
  } else {
    console.error(`✗ Claude Code compatibility check failed`);
  }

  for (const warning of result.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }

  for (const error of result.errors) {
    console.error(`  ✗ ${error}`);
  }
}

/**
 * Get a summary of all assumptions for audit purposes
 */
export function getAssumptionsSummary(): {
  category: string;
  assumptions: { name: string; value: string | number | string[] }[];
}[] {
  return [
    {
      category: 'Version',
      assumptions: [
        { name: 'Expected Version', value: CLAUDE_CODE_VERSION.full },
        { name: 'Release Date', value: CLAUDE_CODE_VERSION.releaseDate },
      ],
    },
    {
      category: 'Tools',
      assumptions: [{ name: 'Known Tool Names', value: getAllToolNames() }],
    },
    {
      category: 'Hooks',
      assumptions: [{ name: 'Known Hook Types', value: getAllHookTypes() }],
    },
  ];
}