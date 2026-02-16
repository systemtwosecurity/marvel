// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Evaluation WebSocket Server
 *
 * Persistent WebSocket server that manages a long-lived Claude Code evaluation
 * session via the --sdk-url NDJSON protocol. Supports multi-turn: each evaluation
 * sends a new `user` message to the existing session (prompt cache hit).
 *
 * Protocol follows the Companion project's reverse-engineered NDJSON format.
 */

import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentSecurityDecision } from "./evaluation-schemas.js";
import { logDebug, logWarn } from "./logger.js";

export interface EvalSessionResult {
  decision: AgentSecurityDecision;
  costUsd: number; // cost for this evaluation (delta)
  durationMs: number;
  numTurns: number; // turns for this evaluation (delta)
}

const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob"]);

// NDJSON message types from the --sdk-url protocol
interface NdjsonMessage {
  type: string;
  subtype?: string;
  request_id?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  // Result fields
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  session_id?: string;
}

// Pending control request awaiting a response from CLI
interface PendingRequest {
  requestId: string;
  resolve: (msg: NdjsonMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// Pending evaluation awaiting a result message
interface PendingEvaluation {
  resolve: (result: EvalSessionResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  startTime: number;
  prevCostUsd: number;
  prevNumTurns: number;
}

function send(ws: WebSocket, msg: object): void {
  const json = JSON.stringify(msg);
  logDebug(`[WS→CLI] ${json.slice(0, 300)}`);
  ws.send(json + "\n");
}

/** Public interface for EvalWsServer — depend on this for testability. */
export interface IEvalWsServer {
  start(): Promise<number>;
  evaluate(
    prompt: string,
    jsonSchema: Record<string, unknown>,
    timeoutMs: number
  ): Promise<EvalSessionResult>;
  close(): void;
  readonly isAlive: boolean;
  readonly port: number;
  readonly totalCostUsd: number;
  readonly sessionId: string;
}

export class EvalWsServer implements IEvalWsServer {
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private ws: WebSocket | null = null;
  private _port: number = 0;
  private initialized: boolean = false;
  private _sessionId: string = "";
  private cumulativeCostUsd: number = 0;
  private cumulativeNumTurns: number = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly idleTimeoutMs: number;
  private _alive: boolean = false;
  private buffer: string = "";

  // Pending control requests (server → CLI, awaiting control_response)
  private pendingRequests = new Map<string, PendingRequest>();

  // Current evaluation awaiting a result
  private pendingEvaluation: PendingEvaluation | null = null;

  // Connection promise for first evaluation
  private connectionPromise: Promise<void> | null = null;
  private connectionResolve: (() => void) | null = null;
  private connectionReject: ((err: Error) => void) | null = null;

  constructor(idleTimeoutMs: number = 60_000) {
    this.idleTimeoutMs = idleTimeoutMs;
  }

  /**
   * Start WS server on OS-assigned port.
   * Returns the port for --sdk-url.
   */
  async start(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.httpServer = createServer();
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on("connection", (ws) => {
        this.handleConnection(ws);
      });

      this.httpServer.on("error", (err) => {
        reject(err);
      });

      this.httpServer.listen(0, "127.0.0.1", () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
          logDebug(`Eval WS server listening on port ${this._port}`);
          // Set up connection promise for first evaluation
          this.connectionPromise = new Promise<void>((res, rej) => {
            this.connectionResolve = res;
            this.connectionReject = rej;
          });
          // Prevent unhandled rejection if close() is called before evaluate()
          this.connectionPromise.catch(() => {});
          resolve(this._port);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
    });
  }

  /**
   * Run one evaluation. If this is the first call, waits for CLI to connect
   * and sends initialize. For subsequent calls, sends a new user message
   * to the existing session (prompt cache hit).
   */
  async evaluate(
    prompt: string,
    jsonSchema: Record<string, unknown>,
    timeoutMs: number
  ): Promise<EvalSessionResult> {
    this.resetIdleTimer();

    if (!this.initialized) {
      // First evaluation — wait for CLI to connect
      await this.waitForConnection(timeoutMs);

      // Send initialize with JSON schema
      await this.sendInitialize(jsonSchema, timeoutMs);
      this.initialized = true;
    }

    if (!this.ws || !this._alive) {
      throw new Error("WebSocket not connected");
    }

    // Send user message and wait for result
    return this.sendUserMessage(prompt, timeoutMs);
  }

  /**
   * Whether the session is alive and connected.
   */
  get isAlive(): boolean {
    return this._alive;
  }

  /**
   * The port the server is listening on.
   */
  get port(): number {
    return this._port;
  }

  /**
   * Cumulative cost across all evaluations in this session.
   */
  get totalCostUsd(): number {
    return this.cumulativeCostUsd;
  }

  /**
   * Session ID from the CLI's system/init message (used for --resume).
   */
  get sessionId(): string {
    return this._sessionId;
  }

  /**
   * Close server and clean up.
   */
  close(): void {
    this._alive = false;
    this.initialized = false;

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Reject any pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Server closing"));
    }
    this.pendingRequests.clear();

    // Reject pending evaluation
    if (this.pendingEvaluation) {
      clearTimeout(this.pendingEvaluation.timer);
      this.pendingEvaluation.reject(new Error("Server closing"));
      this.pendingEvaluation = null;
    }

    // Reject connection promise
    if (this.connectionReject) {
      this.connectionReject(new Error("Server closing"));
      this.connectionResolve = null;
      this.connectionReject = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        // Ignore close errors
      }
      this.wss = null;
    }

    if (this.httpServer) {
      try {
        this.httpServer.close();
      } catch {
        // Ignore close errors
      }
      this.httpServer = null;
    }
  }

  private handleConnection(ws: WebSocket): void {
    if (this.ws) {
      logWarn(`[WS] Rejecting duplicate connection on port ${this._port}`);
      ws.close();
      return;
    }

    this.ws = ws;
    this._alive = true;
    this.buffer = "";

    logDebug(`[WS] Client connected to port ${this._port}`);

    // Resolve connection promise — CLI has connected, ready to send initialize.
    // sendInitialize() has its own wait for control_response via pendingRequests.
    if (this.connectionResolve) {
      this.connectionResolve();
      this.connectionResolve = null;
      this.connectionReject = null;
    }

    ws.on("message", (data) => {
      this.handleRawData(data.toString());
    });

    ws.on("close", (code, reason) => {
      logDebug(
        `[WS] Client disconnected: code=${code}, reason=${reason?.toString() || ""}, pendingEval=${!!this.pendingEvaluation}`
      );
      this._alive = false;
      this.ws = null;

      // Reject pending evaluation
      if (this.pendingEvaluation) {
        clearTimeout(this.pendingEvaluation.timer);
        this.pendingEvaluation.reject(new Error("CLI disconnected"));
        this.pendingEvaluation = null;
      }
    });

    ws.on("error", (err) => {
      logWarn(`[WS] Error: ${err.message}`);
      this._alive = false;
    });
  }

  /**
   * NDJSON parsing — matches daemon.ts and Companion pattern.
   */
  private handleRawData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        logDebug(`[WS←CLI] ${line.slice(0, 300)}`);
        const msg = JSON.parse(line) as NdjsonMessage;
        this.handleMessage(msg);
      } catch (err) {
        logWarn(`Failed to parse NDJSON line: ${line.slice(0, 100)}`);
      }
    }
  }

  private handleMessage(msg: NdjsonMessage): void {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          this._sessionId = (msg.session_id as string) || "";
          logDebug(`Eval session initialized: ${this._sessionId}`);
          // session_id captured for prompt cache. Connection promise
          // is already resolved by handleConnection (WS connect).
        }
        break;

      case "control_request":
        this.handleControlRequest(msg);
        break;

      case "control_response":
        this.handleControlResponse(msg);
        break;

      case "result":
        this.handleResult(msg);
        break;

      case "keep_alive":
      case "stream_event":
      case "assistant":
      case "tool_progress":
        // Silently consume
        break;

      default:
        logDebug(`Unknown eval message type: ${msg.type}`);
        break;
    }
  }

  /**
   * Handle can_use_tool permission requests from CLI (safety net).
   */
  private handleControlRequest(msg: NdjsonMessage): void {
    const request = msg.request;
    if (!request || !this.ws) return;

    if (request.subtype === "can_use_tool") {
      const toolName = request.tool_name as string;
      const requestId = msg.request_id || "";

      if (READ_ONLY_TOOLS.has(toolName)) {
        // Allow read-only tools
        send(this.ws, {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: {
              behavior: "allow",
              updatedInput: request.input || {},
            },
          },
        });
      } else {
        // Deny everything else
        logWarn(`Eval agent attempted non-read-only tool: ${toolName}`);
        send(this.ws, {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: {
              behavior: "deny",
              message: "Only read-only tools (Read, Grep, Glob) are allowed in evaluation",
            },
          },
        });
      }
    }
  }

  /**
   * Handle control_response from CLI (response to our control_request).
   */
  private handleControlResponse(msg: NdjsonMessage): void {
    const response = msg.response;
    if (!response) return;

    const requestId = response.request_id as string;
    if (!requestId) return;

    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(msg);
    }
  }

  /**
   * Handle result message — final evaluation response.
   */
  private handleResult(msg: NdjsonMessage): void {
    if (!this.pendingEvaluation) {
      logWarn("Received result but no pending evaluation");
      return;
    }

    const pending = this.pendingEvaluation;
    this.pendingEvaluation = null;
    clearTimeout(pending.timer);

    const totalCostUsd = msg.total_cost_usd ?? 0;
    const totalNumTurns = msg.num_turns ?? 0;

    // Calculate delta for this evaluation
    const costDelta = totalCostUsd - pending.prevCostUsd;
    const turnsDelta = totalNumTurns - pending.prevNumTurns;

    // Update cumulative tracking
    this.cumulativeCostUsd = totalCostUsd;
    this.cumulativeNumTurns = totalNumTurns;

    if (msg.is_error || msg.subtype?.startsWith("error_")) {
      pending.reject(
        new Error(`Evaluation error: ${msg.subtype || "unknown"} — ${msg.result || ""}`)
      );
      return;
    }

    const structuredOutput = msg.structured_output;
    if (!structuredOutput) {
      pending.reject(new Error("No structured_output in result"));
      return;
    }

    pending.resolve({
      decision: structuredOutput as AgentSecurityDecision,
      costUsd: costDelta,
      durationMs: Date.now() - pending.startTime,
      numTurns: turnsDelta,
    });
  }

  private async waitForConnection(timeoutMs: number): Promise<void> {
    if (!this.connectionPromise) {
      throw new Error("Server not started");
    }

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Connection timeout")), timeoutMs);
    });

    await Promise.race([this.connectionPromise, timeout]);
  }

  /**
   * Send initialize control_request with JSON schema for structured output.
   */
  private async sendInitialize(
    jsonSchema: Record<string, unknown>,
    timeoutMs: number
  ): Promise<void> {
    if (!this.ws) throw new Error("Not connected");

    const requestId = randomUUID();

    const responsePromise = new Promise<NdjsonMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Initialize timeout"));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { requestId, resolve, reject, timer });
    });

    send(this.ws, {
      type: "control_request",
      request_id: requestId,
      request: {
        subtype: "initialize",
        jsonSchema,
      },
    });

    await responsePromise;
    logDebug("Eval session initialized with JSON schema");
  }

  /**
   * Send a user message and wait for the result.
   */
  private sendUserMessage(
    prompt: string,
    timeoutMs: number
  ): Promise<EvalSessionResult> {
    if (!this.ws) {
      return Promise.reject(new Error("Not connected"));
    }

    return new Promise<EvalSessionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingEvaluation) {
          this.pendingEvaluation = null;
          reject(new Error("Evaluation timeout"));
        }
      }, timeoutMs);

      this.pendingEvaluation = {
        resolve,
        reject,
        timer,
        startTime: Date.now(),
        prevCostUsd: this.cumulativeCostUsd,
        prevNumTurns: this.cumulativeNumTurns,
      };

      // --sdk-url / stream-json protocol: the `message` field must be an
      // API-style message object with `role` and `content`, not a plain string.
      // Discovered via CLI v2.1.42 error: "Expected message role 'user', got 'undefined'"
      // which traces to `R.message.role` in the CLI's stream-json parser.
      send(this.ws!, {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      });
    });
  }

  /**
   * Reset idle timer (called on each evaluation).
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      logDebug("Eval session idle timeout — closing");
      this.close();
    }, this.idleTimeoutMs);

    // Don't prevent process exit
    if (this.idleTimer.unref) {
      this.idleTimer.unref();
    }
  }
}