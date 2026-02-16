// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EvalWsServer } from "../eval-ws-server.js";
import { WebSocket } from "ws";

// Mock logger to avoid file I/O
vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

describe("EvalWsServer", () => {
  let server: EvalWsServer;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  describe("start", () => {
    it("starts server and returns a port", async () => {
      server = new EvalWsServer();
      const port = await server.start();
      expect(port).toBeGreaterThan(0);
    });

    it("is not alive before connection", async () => {
      server = new EvalWsServer();
      await server.start();
      expect(server.isAlive).toBe(false);
    });

    it("reports zero initial cost", async () => {
      server = new EvalWsServer();
      await server.start();
      expect(server.totalCostUsd).toBe(0);
    });
  });

  describe("connection handling", () => {
    it("accepts a WebSocket connection and becomes alive", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      // Connection resolves on WS connect — no system/init needed
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(server.isAlive).toBe(true);
      ws.close();
    });

    it("rejects second connection", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws1.on("open", resolve));

      // ws1 accepted on connect — no system/init needed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second connection should be closed
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
      const closedPromise = new Promise<void>((resolve) =>
        ws2.on("close", resolve)
      );
      await closedPromise;

      ws1.close();
    });

    it("stores sessionId when system/init arrives", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      expect(server.sessionId).toBe("");

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      // Send system/init — should store sessionId but not affect connection
      ws.send(
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "test-session-456",
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.isAlive).toBe(true);
      expect(server.sessionId).toBe("test-session-456");
      ws.close();
    });
  });

  describe("evaluate", () => {
    it("runs a full evaluation cycle", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      // Listen for messages from server
      const messages: unknown[] = [];
      ws.on("message", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          messages.push(JSON.parse(line));
        }
      });

      // Start evaluation — connectionPromise resolves on WS connect
      const evalPromise = server.evaluate(
        "Test prompt",
        { type: "object", properties: {}, required: [] },
        5000
      );

      // Wait for initialize control_request
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(messages.length).toBeGreaterThanOrEqual(1);

      const initMsg = messages[0] as Record<string, unknown>;
      expect(initMsg.type).toBe("control_request");

      const initRequest = initMsg.request as Record<string, unknown>;
      expect(initRequest.subtype).toBe("initialize");

      // Send control_response for initialize
      ws.send(
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: initMsg.request_id,
            response: {},
          },
        }) + "\n"
      );

      // Wait for user message
      await new Promise((resolve) => setTimeout(resolve, 100));
      const userMsg = messages.find(
        (m) => (m as Record<string, unknown>).type === "user"
      ) as Record<string, unknown>;
      expect(userMsg).toBeDefined();
      // message is an API-style object: { role: "user", content: [{ type: "text", text: "..." }] }
      const msgBody = userMsg.message as Record<string, unknown>;
      expect(msgBody.role).toBe("user");
      const content = msgBody.content as Array<Record<string, unknown>>;
      expect(content[0].text).toBe("Test prompt");

      // Send result
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Decision made",
          structured_output: {
            decision: "allow",
            reasoning: "Safe command",
            confidence: 0.95,
            investigated: [],
          },
          total_cost_usd: 0.005,
          num_turns: 1,
          duration_ms: 1200,
          session_id: "test-session",
        }) + "\n"
      );

      const result = await evalPromise;
      expect(result.decision.decision).toBe("allow");
      expect(result.decision.reasoning).toBe("Safe command");
      expect(result.decision.confidence).toBe(0.95);
      expect(result.costUsd).toBe(0.005);
      expect(result.numTurns).toBe(1);

      ws.close();
    });

    it("handles subsequent evaluations (prompt cache path)", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: unknown[] = [];
      ws.on("message", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          messages.push(JSON.parse(line));
        }
      });

      // First evaluation
      const eval1Promise = server.evaluate("First prompt", { type: "object", properties: {}, required: [] }, 5000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Respond to initialize
      const initMsg = messages[0] as Record<string, unknown>;
      ws.send(
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: initMsg.request_id,
            response: {},
          },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send first result
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: {
            decision: "allow",
            reasoning: "Safe",
            confidence: 0.9,
            investigated: [],
          },
          total_cost_usd: 0.005,
          num_turns: 1,
        }) + "\n"
      );

      await eval1Promise;
      messages.length = 0;

      // Second evaluation — should NOT send initialize again
      const eval2Promise = server.evaluate("Second prompt", { type: "object", properties: {}, required: [] }, 5000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only get a user message, no initialize
      const userMsgs = messages.filter(
        (m) => (m as Record<string, unknown>).type === "user"
      );
      const initMsgs = messages.filter(
        (m) =>
          (m as Record<string, unknown>).type === "control_request"
      );
      expect(userMsgs.length).toBe(1);
      expect(initMsgs.length).toBe(0);

      // Send second result
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: {
            decision: "deny",
            reasoning: "Dangerous",
            confidence: 0.99,
            investigated: ["/etc/passwd"],
          },
          total_cost_usd: 0.008,
          num_turns: 2,
        }) + "\n"
      );

      const result2 = await eval2Promise;
      expect(result2.decision.decision).toBe("deny");
      // Cost delta: 0.008 - 0.005 = 0.003
      expect(result2.costUsd).toBeCloseTo(0.003, 4);
      // Turns delta: 2 - 1 = 1
      expect(result2.numTurns).toBe(1);
      // Cumulative cost
      expect(server.totalCostUsd).toBeCloseTo(0.008, 4);

      ws.close();
    });

    it("handles can_use_tool permission request for read-only tools", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: unknown[] = [];
      ws.on("message", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          messages.push(JSON.parse(line));
        }
      });

      const evalPromise = server.evaluate("Test", { type: "object", properties: {}, required: [] }, 5000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Respond to initialize
      const initMsg = messages[0] as Record<string, unknown>;
      ws.send(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: initMsg.request_id, response: {} },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate CLI sending can_use_tool for Read
      ws.send(
        JSON.stringify({
          type: "control_request",
          request_id: "tool-req-1",
          request: {
            subtype: "can_use_tool",
            tool_name: "Read",
            input: { file_path: "/src/index.ts" },
            tool_use_id: "tu-1",
          },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Server should have responded with allow
      const responses = messages.filter(
        (m) => (m as Record<string, unknown>).type === "control_response"
      );
      expect(responses.length).toBeGreaterThanOrEqual(1);

      const toolResponse = responses[responses.length - 1] as Record<string, unknown>;
      const respBody = toolResponse.response as Record<string, unknown>;
      const innerResp = respBody.response as Record<string, unknown>;
      expect(innerResp.behavior).toBe("allow");

      // Send result to complete the evaluation
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: {
            decision: "allow",
            reasoning: "Safe",
            confidence: 0.9,
            investigated: ["/src/index.ts"],
          },
          total_cost_usd: 0.01,
          num_turns: 2,
        }) + "\n"
      );

      await evalPromise;
      ws.close();
    });

    it("denies non-read-only tools via can_use_tool", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: unknown[] = [];
      ws.on("message", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          messages.push(JSON.parse(line));
        }
      });

      const evalPromise = server.evaluate("Test", { type: "object", properties: {}, required: [] }, 5000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Respond to initialize
      const initMsg = messages[0] as Record<string, unknown>;
      ws.send(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: initMsg.request_id, response: {} },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate can_use_tool for Bash (should be denied)
      ws.send(
        JSON.stringify({
          type: "control_request",
          request_id: "tool-req-2",
          request: {
            subtype: "can_use_tool",
            tool_name: "Bash",
            input: { command: "rm -rf /" },
            tool_use_id: "tu-2",
          },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responses = messages.filter(
        (m) => (m as Record<string, unknown>).type === "control_response"
      );
      const toolResponse = responses[responses.length - 1] as Record<string, unknown>;
      const respBody = toolResponse.response as Record<string, unknown>;
      const innerResp = respBody.response as Record<string, unknown>;
      expect(innerResp.behavior).toBe("deny");

      // Complete evaluation
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: {
            decision: "deny",
            reasoning: "Dangerous",
            confidence: 0.99,
            investigated: [],
          },
          total_cost_usd: 0.01,
          num_turns: 1,
        }) + "\n"
      );

      await evalPromise;
      ws.close();
    });

    it("rejects on error result", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: unknown[] = [];
      ws.on("message", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          messages.push(JSON.parse(line));
        }
      });

      const evalPromise = server.evaluate("Test", { type: "object", properties: {}, required: [] }, 5000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const initMsg = messages[0] as Record<string, unknown>;
      ws.send(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: initMsg.request_id, response: {} },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send error result
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          result: "Max turns exceeded",
          total_cost_usd: 0.02,
          num_turns: 3,
        }) + "\n"
      );

      await expect(evalPromise).rejects.toThrow("Evaluation error");
      ws.close();
    });

    it("rejects on missing structured_output", async () => {
      server = new EvalWsServer();
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: unknown[] = [];
      ws.on("message", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          messages.push(JSON.parse(line));
        }
      });

      const evalPromise = server.evaluate("Test", { type: "object", properties: {}, required: [] }, 5000);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const initMsg = messages[0] as Record<string, unknown>;
      ws.send(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: initMsg.request_id, response: {} },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send result without structured_output
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Just text",
          total_cost_usd: 0.01,
          num_turns: 1,
        }) + "\n"
      );

      await expect(evalPromise).rejects.toThrow("No structured_output");
      ws.close();
    });
  });

  describe("close", () => {
    it("cleans up without errors", async () => {
      server = new EvalWsServer();
      await server.start();

      server.close();
      expect(server.isAlive).toBe(false);
    });

    it("can be called multiple times", async () => {
      server = new EvalWsServer();
      await server.start();

      server.close();
      server.close(); // Should not throw
      expect(server.isAlive).toBe(false);
    });
  });

  describe("idle timeout", () => {
    it("closes after idle timeout", async () => {
      // Use a short idle timeout — must be long enough for the evaluation to complete
      server = new EvalWsServer(200);
      const port = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.on("open", resolve));

      const messages: unknown[] = [];
      ws.on("message", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          messages.push(JSON.parse(line));
        }
      });

      // Start eval to trigger idle timer
      const evalPromise = server.evaluate("Test", { type: "object", properties: {}, required: [] }, 5000);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Respond to initialize
      const initMsg = messages[0] as Record<string, unknown>;
      ws.send(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: initMsg.request_id, response: {} },
        }) + "\n"
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Complete the evaluation
      ws.send(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: {
            decision: "allow",
            reasoning: "OK",
            confidence: 0.9,
            investigated: [],
          },
          total_cost_usd: 0.001,
          num_turns: 1,
        }) + "\n"
      );

      await evalPromise;

      // Wait for idle timeout to fire (200ms + margin)
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(server.isAlive).toBe(false);
      ws.close();
    });
  });
});