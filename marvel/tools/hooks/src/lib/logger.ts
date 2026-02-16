// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * MARVEL Hooks Logging
 *
 * Structured JSONL logging for hooks and daemon diagnostics.
 */

import * as fs from "fs";
import * as path from "path";
import { findMarvelRoot, findRunDir, getTempDir } from "./paths.js";
import { redactSensitive } from "./redact.js";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  hookType?: string;
  sessionId?: string;
  daemonId?: string;
  runId?: string;
  requestId?: string;
  toolName?: string;
  filePath?: string;
  command?: string;
  pattern?: string;
  durationMs?: number;
  operation?: "read" | "write" | "append" | "mkdir" | "parse";
}

interface LogError {
  name?: string;
  message: string;
  stack?: string;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: LogError;
}

const MAX_VALUE_LENGTH = 300;
const DEBUG_ENABLED =
  process.env.MARVEL_DEBUG === "1" || process.env.MARVEL_DEBUG === "true";

let cachedLogPath: string | null | undefined;

function summarizeValue(value: string): string {
  if (value.length <= MAX_VALUE_LENGTH) {
    return value;
  }
  return value.slice(0, MAX_VALUE_LENGTH - 3) + "...";
}

function resolveLogPath(): string | null {
  if (cachedLogPath !== undefined) {
    return cachedLogPath;
  }

  const envPath = process.env.MARVEL_LOG_PATH;
  if (envPath) {
    cachedLogPath = envPath;
    return envPath;
  }

  const sessionId = process.env.MARVEL_SESSION_ID;
  if (sessionId) {
    cachedLogPath = path.join(getTempDir(), `hooks-${sessionId}.log`);
    return cachedLogPath;
  }

  const runDir = findRunDir();
  if (runDir) {
    cachedLogPath = path.join(runDir, "hooks.log");
    return cachedLogPath;
  }

  const marvelRoot = findMarvelRoot();
  if (marvelRoot) {
    cachedLogPath = path.join(marvelRoot, "hooks.log");
    return cachedLogPath;
  }

  cachedLogPath = null;
  return null;
}

function writeLog(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  const logPath = resolveLogPath();

  if (logPath) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
      fs.appendFileSync(logPath, line + "\n");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[marvel-logger] Failed to write log file: ${message}\n`
      );
    }
  }

  process.stderr.write(line + "\n");
}

function extractToolString(
  toolInput: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!toolInput) {
    return undefined;
  }
  const value = toolInput[key];
  return typeof value === "string" ? value : undefined;
}

export function generateRequestId(): string {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `req_${timePart}_${randomPart}`;
}

export function buildHookContext(
  hookType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any,
  extra?: Partial<LogContext>
): LogContext {
  const rawToolInput = input?.tool_input;
  const toolInput =
    rawToolInput && typeof rawToolInput === "object"
      ? (rawToolInput as Record<string, unknown>)
      : undefined;

  const filePath =
    extractToolString(toolInput, "file_path") ||
    extractToolString(toolInput, "path") ||
    extractToolString(toolInput, "file");

  const command = extractToolString(toolInput, "command");
  const pattern = extractToolString(toolInput, "pattern");

  const sessionId =
    (typeof input?.session_id === "string" ? input.session_id : undefined) ||
    process.env.MARVEL_SESSION_ID;
  const toolName =
    typeof input?.tool_name === "string" ? input.tool_name : undefined;

  const context: LogContext = {
    hookType,
    sessionId,
    runId: process.env.MARVEL_RUN_ID,
    requestId: process.env.MARVEL_REQUEST_ID,
    toolName,
    filePath: filePath ? summarizeValue(filePath) : undefined,
    command: command ? summarizeValue(redactSensitive(command)) : undefined,
    pattern: pattern ? summarizeValue(pattern) : undefined,
    ...extra,
  };

  return context;
}

export function logDebug(message: string, context?: LogContext): void {
  if (!DEBUG_ENABLED) {
    return;
  }
  writeLog({
    timestamp: new Date().toISOString(),
    level: "debug",
    message,
    context,
  });
}

export function logInfo(message: string, context?: LogContext): void {
  if (!DEBUG_ENABLED) {
    return;
  }
  writeLog({
    timestamp: new Date().toISOString(),
    level: "info",
    message,
    context,
  });
}

export function logWarn(message: string, context?: LogContext): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: "warn",
    message,
    context,
  });
}

export function logError(
  message: string,
  error?: unknown,
  context?: LogContext
): void {
  const errorInfo: LogError | undefined =
    error === undefined
      ? undefined
      : error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };

  writeLog({
    timestamp: new Date().toISOString(),
    level: "error",
    message,
    context,
    error: errorInfo,
  });
}