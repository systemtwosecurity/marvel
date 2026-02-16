// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * MARVEL Hooks Type Definitions
 */

// Pack metadata from pack.json
export interface PackMetadata {
  name: string;
  version: string;
  owner: string;
  description: string;
  categories: string[];
  applies_to: {
    extensions: string[];
  };
  depends_on?: string[];
  sensitive_paths?: string[];
  excludes_paths?: string[];
  references?: {
    code_paths?: string[];
    doc_links?: string[];
  };
}

// Lesson from lessons.jsonl
export interface Lesson {
  timestamp: string;
  run_id?: string;
  category: string;
  title: string;
  description: string;
  actionable: string;
  context?: string;
  // Utility tracking (populated by /marvel-health)
  utility_score?: number;
  injection_count?: number;
  correction_count?: number;
  last_injected?: string;
}

// Injection record for outcome tracking
export interface InjectionRecord {
  timestamp: string;
  file: string;
  lessons_injected: string[];
  packs_injected: string[];
}

// Per-lesson outcome stats from a session
export interface LessonOutcome {
  lesson_title: string;
  pack: string;
  injected: number;
  followed_by_correction: number;
}

// Loaded pack with metadata and lessons
export interface LoadedPack {
  metadata: PackMetadata;
  lessons: Lesson[];
  guardrailsPath: string;
  loadedAt: number;
}

// Guidance captured from user prompts
export interface Guidance {
  id: string;
  timestamp: string;
  run_id: string;
  type: GuidanceType;
  content: string;
  category?: string;
  confidence: number;
  // Before/after context: what was happening when the correction was made
  preceding_tool?: string;
  preceding_file?: string;
  preceding_injections?: string[];
}

export type GuidanceType =
  | "correction"
  | "direction"
  | "task_start"
  | "task_end"
  | "clarification"
  | "approval"
  | "rejection"
  | "unknown";

// Run state for tracking session activity
export interface RunState {
  runId: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  spec?: string;
  activePacks: string[];
  packVersions?: Record<string, string>;
  toolCallCount: number;
  correctionCount: number;
  pendingLessons?: number;
  lastReflectionAt?: string;
  currentTask?: {
    description: string;
    startedAt: string;
    filesInvolved: string[];
  };
  recentActivity: ActivityEvent[];
  packInjectionCounts?: Record<string, number>;
  lastInjection?: {
    file: string;
    packs: string[];
    relevanceScores: RelevanceScore[];
    lessons: string[];
  };
}

export type ActivityEventType =
  | "injection"
  | "capture"
  | "tool_call"
  | "tool_failure"
  | "compaction"
  | "subagent_start"
  | "subagent_stop"
  | "notification"
  | "teammate_idle"
  | "task_completed";

export interface ActivityEvent {
  type: ActivityEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// Tool call record for trace
export interface ToolCallRecord {
  sequence: number;
  timestamp: string;
  tool: string;
  input_summary: string;
  output_summary?: string;
  success: boolean;
  duration_ms?: number;
}

// Relevance scoring result
export interface RelevanceScore {
  pack: string;
  score: number;
  signals: string[];
}


// External rule format for allowlist/denylist
export interface ExternalRule {
  id: string;
  type: "regex" | "prefix" | "contains";
  pattern: string;
  reason: string;
}

// Rule file structure
export interface RuleFile {
  rules: ExternalRule[];
}

// LLM response with rule suggestions
export interface SecurityEvaluationResponse {
  decision: "allow" | "deny" | "ask";
  reason: string;
  source: "allowlist" | "denylist" | "learned" | "llm" | "error";
  suggestions?: {
    allow?: Array<{ pattern: string; reason: string }>;
    deny?: Array<{ pattern: string; reason: string }>;
  };
}


// Pack relevance scoring result (detailed version for injection tracking)
export interface PackRelevance {
  packName: string;
  score: number;
  reasons: string[];
}

// Potential lesson extracted from guidance for reflection
export interface PotentialLesson {
  category: string;
  corrections: Guidance[];
  confidence: number;
  suggestedTitle: string;
}

// Session statistics for reflection
export interface SessionStats {
  correctionCount: number;
  toolCallCount: number;
  filesInvolved: string[];
  durationMinutes: number;
  tasksCompleted: number;
}

// Enhanced lesson with source tracking
export interface EnhancedLesson {
  id: string;
  timestamp: string;
  runId?: string;
  category: string;
  confidence: number;
  recurrence: number;
  title: string;
  description: string;
  actionable: string;
  source: {
    type: "user_guidance" | "guardrail_violation" | "verification_failure" | "ci_failure" | "review_comment" | "production_error";
    reference?: string;
    userWords?: string;
  };
  examples?: {
    before?: string;
    after?: string;
    file?: string;
  };
}

// Promotion pipeline types

export interface PromotionCandidate {
  source: "learned" | "suggestion";
  rule: ExternalRule;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
}

export interface LessonCandidate {
  guidance: Guidance;
  suggestedPack: string;
  suggestedLesson: Lesson;
  confidence: number;
}

export interface PromotionReport {
  security: { candidates: PromotionCandidate[]; duplicates: number; unsafe: number };
  domain: { candidates: LessonCandidate[]; totalGuidance: number };
}