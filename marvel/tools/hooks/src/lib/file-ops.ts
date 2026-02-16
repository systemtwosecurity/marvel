// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Safe File Operations
 *
 * Helper functions that wrap file operations with consistent error handling.
 * All helpers:
 * - Log errors via logWarn() (not logError() since file ops are non-critical)
 * - Return success/failure boolean or null on error
 * - Never throw
 * - Include file path in context
 */

import * as fs from "fs";
import { logWarn, type LogContext } from "./logger.js";

/**
 * Safe append to file with logging.
 * @returns true if successful, false on error
 */
export function safeAppendFile(
  filePath: string,
  content: string,
  context: LogContext,
  mode?: fs.Mode
): boolean {
  try {
    fs.appendFileSync(filePath, content, mode !== undefined ? { mode } : undefined);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to append to file: ${message}`, {
      ...context,
      filePath,
      operation: "append",
    });
    return false;
  }
}

/**
 * Safe write file with logging.
 * @returns true if successful, false on error
 */
export function safeWriteFile(
  filePath: string,
  content: string,
  context: LogContext,
  mode?: fs.Mode
): boolean {
  try {
    fs.writeFileSync(filePath, content, mode !== undefined ? { mode } : undefined);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to write file: ${message}`, {
      ...context,
      filePath,
      operation: "write",
    });
    return false;
  }
}

/**
 * Safe read file with logging.
 * @returns file contents if successful, null on error
 */
export function safeReadFile(
  filePath: string,
  context: LogContext
): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to read file: ${message}`, {
      ...context,
      filePath,
      operation: "read",
    });
    return null;
  }
}

/**
 * Safe mkdir with logging.
 * @returns true if successful (or already exists), false on error
 */
export function safeMkdir(dirPath: string, context: LogContext, mode?: fs.Mode): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true, ...(mode !== undefined && { mode }) });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to create directory: ${message}`, {
      ...context,
      filePath: dirPath,
      operation: "mkdir",
    });
    return false;
  }
}

/**
 * Safe parse JSONL with logging.
 * Returns array of parsed items, logs parse failures for individual lines.
 * @returns array of parsed items (empty on file read error)
 */
export function safeParseJsonl<T>(filePath: string, context: LogContext): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = safeReadFile(filePath, context);
  if (content === null) {
    return [];
  }

  const lines = content.trim().split("\n").filter((line) => line.trim());
  const results: T[] = [];

  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as T);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to parse JSONL line: ${message}`, {
        ...context,
        filePath,
        operation: "parse",
      });
    }
  }

  return results;
}

/**
 * Safe read and parse JSON file with logging.
 * @returns parsed object if successful, null on error
 */
export function safeReadJson<T>(
  filePath: string,
  context: LogContext
): T | null {
  const content = safeReadFile(filePath, context);
  if (content === null) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to parse JSON: ${message}`, {
      ...context,
      filePath,
      operation: "parse",
    });
    return null;
  }
}

/**
 * Safe write JSONL file with logging.
 * Writes an array of items as newline-delimited JSON.
 * @returns true if successful, false on error
 */
export function safeWriteJsonl<T>(
  filePath: string,
  items: T[],
  context: LogContext
): boolean {
  try {
    const content = items.map((item) => JSON.stringify(item)).join("\n") + "\n";
    return safeWriteFile(filePath, content, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to serialize JSONL: ${message}`, {
      ...context,
      filePath,
      operation: "write",
    });
    return false;
  }
}

/**
 * Safe write JSON file with logging.
 * @returns true if successful, false on error
 */
export function safeWriteJson(
  filePath: string,
  data: unknown,
  context: LogContext,
  pretty: boolean = true
): boolean {
  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    return safeWriteFile(filePath, content, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to serialize JSON: ${message}`, {
      ...context,
      filePath,
      operation: "write",
    });
    return false;
  }
}