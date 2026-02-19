// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerAgent,
  completeAgent,
  errorAgent,
  getSessionAgents,
  hasSessionAgents,
  trackTeammate,
  getTeamState,
  serializeForSession,
  clearSession,
  _resetForTesting,
} from "../agent-registry.js";

beforeEach(() => {
  _resetForTesting();
});

describe("agent-registry", () => {
  describe("registerAgent", () => {
    it("adds agent to session registry", () => {
      registerAgent("sess-1", "agent-a", "Plan");

      const agents = getSessionAgents("sess-1");
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe("agent-a");
      expect(agents[0].agentType).toBe("Plan");
      expect(agents[0].status).toBe("running");
      expect(agents[0].sessionId).toBe("sess-1");
      expect(agents[0].resultSummary).toBeNull();
      expect(agents[0].errorMessage).toBeNull();
    });

    it("registers multiple agents in same session", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      registerAgent("sess-1", "agent-b", "Explore");

      const agents = getSessionAgents("sess-1");
      expect(agents).toHaveLength(2);
    });
  });

  describe("completeAgent", () => {
    it("marks agent as completed with transcript path", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      completeAgent("sess-1", "agent-a", "/path/to/transcript");

      const agents = getSessionAgents("sess-1");
      expect(agents[0].status).toBe("completed");
      expect(agents[0].transcriptPath).toBe("/path/to/transcript");
      expect(agents[0].completedTime).toBeDefined();
    });

    it("no-ops for unknown session", () => {
      completeAgent("unknown", "agent-a", "/path");
      expect(getSessionAgents("unknown")).toHaveLength(0);
    });

    it("no-ops for unknown agent", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      completeAgent("sess-1", "agent-b", "/path");

      const agents = getSessionAgents("sess-1");
      expect(agents[0].status).toBe("running");
    });
  });

  describe("errorAgent", () => {
    it("marks agent as errored with message", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      errorAgent("sess-1", "agent-a", "Something went wrong");

      const agents = getSessionAgents("sess-1");
      expect(agents[0].status).toBe("errored");
      expect(agents[0].errorMessage).toBe("Something went wrong");
      expect(agents[0].completedTime).toBeDefined();
    });
  });

  describe("hasSessionAgents", () => {
    it("returns false for empty session", () => {
      expect(hasSessionAgents("sess-1")).toBe(false);
    });

    it("returns true when agents exist", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      expect(hasSessionAgents("sess-1")).toBe(true);
    });
  });

  describe("cross-session isolation", () => {
    it("agents in session A not visible to session B", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      registerAgent("sess-2", "agent-b", "Explore");

      expect(getSessionAgents("sess-1")).toHaveLength(1);
      expect(getSessionAgents("sess-1")[0].id).toBe("agent-a");
      expect(getSessionAgents("sess-2")).toHaveLength(1);
      expect(getSessionAgents("sess-2")[0].id).toBe("agent-b");
    });
  });

  describe("trackTeammate", () => {
    it("tracks teammate in session", () => {
      trackTeammate("sess-1", "alice", "my-team");

      const team = getTeamState("sess-1");
      expect(team).not.toBeNull();
      expect(team?.name).toBe("my-team");
      expect(team?.members).toHaveLength(1);
      expect(team?.members[0].teammateName).toBe("alice");
    });

    it("deduplicates same teammate", () => {
      trackTeammate("sess-1", "alice", "my-team");
      trackTeammate("sess-1", "alice", "my-team");

      const team = getTeamState("sess-1");
      expect(team?.members).toHaveLength(1);
    });

    it("returns null when no team", () => {
      expect(getTeamState("sess-1")).toBeNull();
    });
  });

  describe("serializeForSession", () => {
    it("returns valid serialized state", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      registerAgent("sess-1", "agent-b", "Explore");
      completeAgent("sess-1", "agent-a", "/path/a");
      trackTeammate("sess-1", "alice", "my-team");

      const state = serializeForSession("sess-1");
      expect(state.version).toBe(1);
      expect(state.sessionId).toBe("sess-1");
      expect(state.timestamp).toBeDefined();
      expect(state.agents).toHaveLength(2);
      expect(state.agents[0].status).toBe("completed");
      expect(state.agents[1].status).toBe("running");
      expect(state.teamState).not.toBeNull();
      expect(state.teamState?.name).toBe("my-team");
    });

    it("returns empty state for unknown session", () => {
      const state = serializeForSession("unknown");
      expect(state.agents).toHaveLength(0);
      expect(state.teamState).toBeNull();
    });
  });

  describe("clearSession", () => {
    it("removes all agents and team for session", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      trackTeammate("sess-1", "alice", "my-team");

      clearSession("sess-1");

      expect(getSessionAgents("sess-1")).toHaveLength(0);
      expect(hasSessionAgents("sess-1")).toBe(false);
      expect(getTeamState("sess-1")).toBeNull();
    });

    it("does not affect other sessions", () => {
      registerAgent("sess-1", "agent-a", "Plan");
      registerAgent("sess-2", "agent-b", "Explore");

      clearSession("sess-1");

      expect(getSessionAgents("sess-1")).toHaveLength(0);
      expect(getSessionAgents("sess-2")).toHaveLength(1);
    });
  });
});
