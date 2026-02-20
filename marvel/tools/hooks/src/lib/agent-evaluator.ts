// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Agent Evaluator
 *
 * Orchestrates a persistent WebSocket-based Claude Code evaluation session.
 * Lazy-initializes on first eval, reuses for subsequent evals (prompt cache hit),
 * and recreates on error. Returns "ask" on any failure.
 *
 * The evaluation session stays alive across multiple evaluations within a MARVEL
 * session, so the Anthropic API prompt cache works (system prompt + tool definitions
 * + evaluation prefix cached after first eval).
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { EvalWsServer, type IEvalWsServer } from "./eval-ws-server.js";
import {
  SECURITY_DECISION_SCHEMA,
  isValidSecurityDecision,
} from "./evaluation-schemas.js";
import type { LlmAnalysisResult } from "./security-llm.js";
import {
  escapeForPrompt,
  logDecision,
  logSuggestion,
} from "./security-llm.js";
import type { LogContext } from "./logger.js";
import { logDebug, logWarn, logError } from "./logger.js";
import { getSecurityDir } from "./paths.js";
import { redactSensitive } from "./redact.js";

// Default configuration
const DEFAULT_CONFIG = {
  enabled: true,
  model: "haiku",
  evaluation_timeout_ms: 30000,
  idle_timeout_ms: 3600000,
  max_cumulative_cost_usd: 0.5,
  confidence_auto_threshold: 0.85,
};

interface AgentEvaluatorConfig {
  enabled: boolean;
  model: string;
  evaluation_timeout_ms: number;
  idle_timeout_ms: number;
  max_cumulative_cost_usd: number;
  confidence_auto_threshold: number;
}

// Module-level persistent state (lives in daemon process memory)
let evalServer: IEvalWsServer | null = null;
let cliProcess: ChildProcess | null = null;
let generationCounter = 0;
let evaluationCounter = 0;
let lastSessionId: string = "";

// ── Concurrency control ─────────────────────────────────────────────
// The daemon processes multiple hook requests concurrently (pre-tool-use
// and permission-request fire for the same command ~50ms apart). Without
// serialization, concurrent initSession() calls destroy each other's
// WebSocket servers via cleanupSession().
//
// Three layers:
//   1. Lock: serializes all evaluations so only one initSession runs at a time
//   2. Dedupe: inside the lock, checks if the same command was recently evaluated
//   3. Cache: stores results keyed by command so the second caller gets the
//      same answer without re-evaluating

let evalLockTail: Promise<void> = Promise.resolve();

function withEvalLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = evalLockTail;
  let release: () => void;
  evalLockTail = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release!());
}

interface CachedResult {
  result: LlmAnalysisResult;
  expiresAt: number;
}

const evalResultCache = new Map<string, CachedResult>();
const EVAL_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes — cache security
// decisions for the daemon's lifetime. Same command gets the same answer
// without re-evaluating (saves Haiku API calls and latency).

function pruneEvalCache(): void {
  const now = Date.now();
  for (const [key, entry] of evalResultCache) {
    if (now >= entry.expiresAt) {
      evalResultCache.delete(key);
    }
  }
}

const AGENT_EVAL_PROMPT = `You are a security evaluator for a software development environment.
Analyze the following bash command and decide whether it should be allowed, denied, or requires user confirmation.

You have access to Read, Grep, and Glob tools ONLY to investigate the codebase context.
You do NOT have access to Bash — do not attempt to use it. Only Read, Grep, and Glob are available.
Use these tools when the command references files, scripts, or paths that need context to evaluate.

COMMAND: {command}
DESCRIPTION: {description}

Decision criteria:
- allow: standard dev ops (build, test, lint, git status, pnpm, npm, read-only, file viewing)
- deny: destructive operations (rm -rf /, DROP DATABASE, force push to main, credential exfiltration)
- ask: anything uncertain or potentially dangerous that needs user confirmation

Investigate if needed, then provide your decision with confidence score and reasoning.
If this command type should be auto-allowed/denied in the future, suggest a pattern rule.`;

/**
 * Load agent evaluator configuration from marvel/security/config.json.
 */
function loadConfig(): AgentEvaluatorConfig {
  const configPath = path.join(getSecurityDir(), "config.json");

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const evalConfig = config.marvel_evaluation as
        | Record<string, unknown>
        | undefined;
      const agentConfig = evalConfig?.agent_evaluator as
        | Partial<AgentEvaluatorConfig>
        | undefined;

      if (agentConfig) {
        return { ...DEFAULT_CONFIG, ...agentConfig };
      }
    }
  } catch {
    // Use defaults on parse error
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Log an agent evaluation to the agent-evaluations.jsonl file.
 */
function logAgentEvaluation(
  command: string,
  description: string | undefined,
  decision: string,
  reasoning: string,
  confidence: number,
  investigated: string[],
  costUsd: number,
  durationMs: number,
  numTurns: number,
  context?: LogContext
): void {
  const logPath = path.join(getSecurityDir(), "agent-evaluations.jsonl");

  const dir = path.dirname(logPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch {
    logWarn(`Failed to create agent evaluations directory: ${dir}`, context);
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    command: redactSensitive(command),
    description: description ? redactSensitive(description) : null,
    decision,
    reasoning,
    confidence,
    investigated,
    costUsd,
    durationMs,
    numTurns,
    evaluator: "agent",
  };

  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", { mode: 0o600 });
    logDebug("Logged agent evaluation", context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to log agent evaluation: ${message}`, context);
  }
}

/**
 * Analyze a command using the persistent agent evaluation session.
 * Returns "ask" on any failure so the user gets prompted.
 *
 * Serialized via evalLockTail to prevent concurrent initSession() calls
 * from destroying each other's WebSocket servers. Inside the lock, a
 * dedupe cache returns the same result for identical commands evaluated
 * within EVAL_CACHE_TTL_MS (covers the pre-tool-use + permission-request
 * pair that fires ~50ms apart for the same command).
 */
export async function analyzeWithAgent(
  command: string,
  description?: string,
  context?: LogContext
): Promise<LlmAnalysisResult> {
  const config = loadConfig();

  // Feature flag check (no lock needed)
  if (!config.enabled) {
    logWarn("Agent evaluator disabled — unknown commands will require manual confirmation", context);
    return { decision: "ask", reason: "Agent evaluator disabled — user confirmation required" };
  }

  return withEvalLock(async () => {
    // Dedupe: check cache for recent evaluation of this exact command
    const cached = evalResultCache.get(command);
    if (cached && Date.now() < cached.expiresAt) {
      logDebug(`Eval dedupe cache hit for command: ${command.slice(0, 50)}...`, context);
      return cached.result;
    }

    try {
      const result = await runAgentEvaluation(command, description, config, context);
      evalResultCache.set(command, { result, expiresAt: Date.now() + EVAL_CACHE_TTL_MS });
      pruneEvalCache();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Agent evaluation failed: ${message}`, context);

      // Clean up broken session — next eval will create fresh
      cleanupSession();

      const fallback: LlmAnalysisResult = {
        decision: "ask",
        reason: `Agent evaluation failed — user confirmation required: ${message}`,
      };
      // Cache failures too so the dedupe partner doesn't retry and fail again
      evalResultCache.set(command, { result: fallback, expiresAt: Date.now() + EVAL_CACHE_TTL_MS });
      return fallback;
    }
  });
}

// Tracked warmup promise — shutdown awaits this to avoid orphaned CLI processes.
let warmupPromise: Promise<void> | null = null;

/**
 * Pre-warm the evaluation session: start WS server + spawn CLI.
 * Called from daemon session-start. The returned promise is tracked so
 * shutdownEvalSession() can await it before tearing down.
 * withEvalLock prevents races with the first real evaluation.
 */
export function warmupEvalSession(): void {
  const config = loadConfig();
  if (!config.enabled) return;

  warmupPromise = withEvalLock(async () => {
    if (evalServer && evalServer.isAlive) return; // already warm
    try {
      await initSession(config);
      logDebug("Eval session pre-warmed successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Eval session warmup failed (non-fatal): ${message}`);
      cleanupSession();
    }
  }).finally(() => {
    warmupPromise = null;
  });
}

/**
 * Run the agent evaluation. Throws on failure (caller catches and falls back).
 */
async function runAgentEvaluation(
  command: string,
  description: string | undefined,
  config: AgentEvaluatorConfig,
  context?: LogContext
): Promise<LlmAnalysisResult> {
  // Check cost cap
  if (
    evalServer &&
    evalServer.totalCostUsd >= config.max_cumulative_cost_usd
  ) {
    logWarn(
      `Agent eval cost cap reached ($${evalServer.totalCostUsd.toFixed(3)} >= $${config.max_cumulative_cost_usd})`,
      context
    );
    cleanupSession();
    return { decision: "ask", reason: "Agent eval cost cap reached — user confirmation required" };
  }

  // Lazy init — create server + spawn CLI if needed
  if (!evalServer || !evalServer.isAlive) {
    await initSession(config, context);
  }

  // Build prompt
  const prompt = AGENT_EVAL_PROMPT.replace(
    "{command}",
    escapeForPrompt(command)
  ).replace(
    "{description}",
    description ? escapeForPrompt(description) : "No description"
  );

  // Run evaluation
  const result = await evalServer!.evaluate(
    prompt,
    SECURITY_DECISION_SCHEMA,
    config.evaluation_timeout_ms
  );

  // Validate structured output
  if (!isValidSecurityDecision(result.decision)) {
    throw new Error("Invalid structured output from evaluation");
  }

  const decision = result.decision;

  // Confidence-based asymmetry: low-confidence deny → ask
  let finalDecision = decision.decision;
  if (
    finalDecision === "deny" &&
    decision.confidence < config.confidence_auto_threshold
  ) {
    logDebug(
      `Low-confidence deny (${decision.confidence}) → converting to ask`,
      context
    );
    finalDecision = "ask";
  }

  evaluationCounter++;

  // Capture sessionId for --resume on next CLI spawn
  if (evalServer && evalServer.sessionId) {
    lastSessionId = evalServer.sessionId;
  }

  // Log to agent-evaluations.jsonl
  logAgentEvaluation(
    command,
    description,
    finalDecision,
    decision.reasoning,
    decision.confidence,
    decision.investigated || [],
    result.costUsd,
    result.durationMs,
    result.numTurns,
    context
  );

  // Log to shared decisions.jsonl
  logDecision(
    command,
    description,
    finalDecision as "allow" | "deny" | "ask",
    decision.reasoning,
    result.durationMs,
    context
  );

  // Log suggestions if present
  if (decision.suggested_rule) {
    const suggestions: LlmAnalysisResult["suggestions"] = {};
    if (
      decision.suggested_rule.type === "prefix" ||
      decision.suggested_rule.type === "regex" ||
      decision.suggested_rule.type === "contains"
    ) {
      const ruleList = [
        {
          pattern: decision.suggested_rule.pattern,
          reason: decision.suggested_rule.reason,
        },
      ];
      if (finalDecision === "allow") {
        suggestions.allow = ruleList;
      } else if (finalDecision === "deny") {
        suggestions.deny = ruleList;
      }
    }
    logSuggestion(command, suggestions, context);
  }

  return {
    decision: finalDecision as "allow" | "deny" | "ask",
    reason: decision.reasoning,
    suggestions: decision.suggested_rule
      ? {
          [finalDecision === "deny" ? "deny" : "allow"]: [
            {
              pattern: decision.suggested_rule.pattern,
              reason: decision.suggested_rule.reason,
            },
          ],
        }
      : undefined,
    suggestedRule: decision.suggested_rule,
  };
}

/**
 * Initialize the evaluation session: start WS server, spawn Claude CLI.
 * If lastSessionId is available, attempts --resume for faster startup;
 * falls back to fresh session if CLI exits within 2s (resume rejection).
 */
async function initSession(
  config: AgentEvaluatorConfig,
  context?: LogContext
): Promise<void> {
  // Clean up any previous session
  cleanupSession();

  logDebug("Initializing agent evaluation session", context);

  // Start WebSocket server
  evalServer = new EvalWsServer(config.idle_timeout_ms);
  const port = await evalServer.start();

  const resumeId = lastSessionId;
  spawnCli(config, port, resumeId, context);

  // Quick-death fallback: if CLI exits within 2s after resume, clear
  // lastSessionId and retry with a fresh session
  if (resumeId) {
    const quickDeathDetected = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      if (timer.unref) timer.unref();
      cliProcess?.on("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (quickDeathDetected) {
      logWarn(`CLI quick-death after --resume ${resumeId.slice(0, 8)}… — retrying fresh`, context);
      lastSessionId = "";
      cleanupSession();
      evalServer = new EvalWsServer(config.idle_timeout_ms);
      const freshPort = await evalServer.start();
      spawnCli(config, freshPort, "", context);
    }
  }
}

/**
 * Spawn Claude CLI subprocess with --sdk-url.
 */
function spawnCli(
  config: AgentEvaluatorConfig,
  port: number,
  resumeSessionId: string,
  context?: LogContext
): void {
  // Spawn Claude CLI with --sdk-url
  const args = [
    "--sdk-url",
    `ws://127.0.0.1:${port}`,
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--model",
    config.model,
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Read",
    "--allowedTools",
    "Grep",
    "--allowedTools",
    "Glob",
    "-p",
    "",
  ];

  // Session resume: reuse previous session for faster startup (prompt cache hit)
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
    logDebug(`Attempting session resume: ${resumeSessionId.slice(0, 8)}…`, context);
  }

  // Isolation: child claude must not trigger the parent's hook pipeline.
  // Two mechanisms work together:
  //   1. cwd=/tmp — Claude Code discovers hooks relative to cwd/CLAUDE_PROJECT_DIR. /tmp has neither.
  //   2. CLAUDE_PROJECT_DIR="" — explicitly disables project hook discovery.
  // Additionally, MARVEL_SECURITY_EVAL=1 causes bash-security-gate.isRecursiveCall() to
  // return true, preventing infinite recursion if hooks somehow fire.
  cliProcess = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      MARVEL_SECURITY_EVAL: "1",
      CLAUDE_PROJECT_DIR: "",
      // Unset CLAUDECODE to allow nested claude invocation for security eval.
      // The parent session sets this; without clearing it, the child refuses
      // to start ("cannot be launched inside another Claude Code session").
      CLAUDECODE: undefined,
      MAX_THINKING_TOKENS: undefined,
    },
  });

  generationCounter++;
  const gen = generationCounter;
  const spawnedPid = cliProcess.pid;
  evaluationCounter = 0;

  logDebug(
    `helper_spawn: generation=${gen}, port=${port}, pid=${spawnedPid}, resume=${resumeSessionId ? resumeSessionId.slice(0, 8) + "…" : "none"}, cwd=${os.tmpdir()}`,
    context
  );

  cliProcess.on("error", (err) => {
    logError("Eval CLI spawn error", err, context);
    cleanupSession();
  });

  cliProcess.on("exit", (code, signal) => {
    logDebug(
      `helper_death: generation=${gen}, uses=${evaluationCounter}, code=${code}, signal=${signal || "none"}, pid=${spawnedPid}`,
      context
    );
    // Only clean up if this exit is from the current generation.
    // Without this guard, an old process exiting after a new one spawns
    // would null out the reference to the active process.
    if (gen === generationCounter) {
      cliProcess = null;
    }
  });

  // Pipe stdout for debugging (but don't accumulate)
  cliProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      logDebug(`Eval CLI stdout: ${msg.slice(0, 500)}`, context);
    }
  });

  // Pipe stderr for debugging (but don't accumulate)
  cliProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      logDebug(`Eval CLI stderr: ${msg.slice(0, 500)}`, context);
    }
  });
}

/**
 * Clean up the evaluation session.
 */
function cleanupSession(): void {
  if (evalServer) {
    evalServer.close();
    evalServer = null;
  }

  if (cliProcess) {
    try {
      cliProcess.kill("SIGTERM");
    } catch {
      // Process may already be dead
    }
    cliProcess = null;
  }
}

/**
 * Shut down the evaluation session.
 * Called from SessionEnd hook or daemon shutdown.
 */
/**
 * Check whether the agent evaluator is enabled.
 * Used by session-start to surface a warning when the evaluator is off.
 */
export function isEvalEnabled(): { enabled: boolean; reason?: string } {
  const config = loadConfig();
  if (!config.enabled) {
    return { enabled: false, reason: "agent_evaluator.enabled is false in marvel/security/config.json" };
  }
  return { enabled: true };
}

export async function shutdownEvalSession(): Promise<void> {
  logDebug("Shutting down agent evaluation session");
  // Await in-flight warmup so we don't orphan a CLI process
  if (warmupPromise) {
    try {
      await warmupPromise;
    } catch {
      // Warmup already logs its own errors
    }
  }
  cleanupSession();
  evalResultCache.clear();
}