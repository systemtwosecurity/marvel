# MARVEL Terminology

Glossary of terms used throughout the MARVEL system.

## Core Concepts

### Pack
A self-contained unit of knowledge covering a specific domain (e.g., code quality, security, testing). Each pack contains metadata (`pack.json`), human-written rules (`guardrails.md`), and machine-learned lessons (`lessons.jsonl`). Packs live under `marvel/packs/`.

### Lesson
A single piece of learned knowledge stored in a pack's `lessons.jsonl` file. Each lesson has a category, title, description, and actionable instruction. Lessons are created automatically through the reflection process or added manually.

### Guidance
A user-provided correction, direction, or instruction captured during a session by the `UserPromptSubmit` hook. Guidance is classified by type (correction, direction, task start/end, clarification, approval, rejection) and stored in the run's `guidance.jsonl` for later reflection.

### Guardrails
The human-authored rules and conventions in a pack's `guardrails.md` file. Guardrails are injected into Claude's context when the pack is relevant to the current file operation. They represent the team's established standards.

### Run
A single Claude Code session, identified by a run ID (e.g., `run_20250115_103000`). Each run has its own directory under `marvel/runs/` containing trace data, captured guidance, and security metrics. Runs are gitignored.

## Hook System

### Hook
A Claude Code extension point that fires at specific moments during a session (e.g., before a file edit, after a bash command, when the user submits a prompt). MARVEL registers handlers for all available hooks to inject knowledge, evaluate security, and capture guidance.

### Injection
The process of inserting relevant pack content (guardrails and lessons) into Claude's context during a `PreToolUse` hook. Only packs that score above the relevance threshold for the target file are injected. Maximum of 4 packs per injection.

### Relevance Scoring
The algorithm that determines which packs are relevant to a given file operation. Scoring considers file extension matches, code path matches, sensitive path patterns, recent user corrections, category alignment, and path keywords. Each signal has a defined weight.

## Security

### Security Gate
The 4-layer evaluation system that assesses every bash command before execution. Layers are checked in order: allowlist, denylist, learned rules, LLM evaluator. The first matching layer determines the outcome.

### Allowlist
A JSON file (`marvel/security/allowlist.json`) containing patterns for commands that are always permitted (e.g., `git status`, `ls`, `pnpm build`). Patterns can be prefix matches, substring matches, or regular expressions.

### Denylist
A JSON file (`marvel/security/denylist.json`) containing patterns for commands that are always blocked (e.g., `rm -rf /`, `curl | bash`). The denylist is checked before learned rules to prevent dangerous commands from being allowed by overly broad patterns.

### Learned Rules
Command patterns that were previously approved by the user and saved for future sessions. Stored in `marvel/security/learned.jsonl` (gitignored). When a user approves an unknown command, MARVEL extracts a safe pattern and records it.

## Lifecycle

### Trace
A chronological log of all tool calls during a session, stored in the run's `trace.jsonl`. Each entry includes the tool name, input summary, output summary, success/failure status, and duration.

### Daemon
A long-running Node.js process that keeps packs loaded in memory and handles hook requests over a Unix socket. One daemon per project directory, shared by all sessions. Eliminates the ~40ms cold-start penalty of spawning a new process per hook call.

### Promotion
The process of graduating learned knowledge into permanent pack content. Security rule promotion moves frequently-used learned rules into the allowlist or denylist. Lesson promotion appends high-confidence lessons to a pack's `lessons.jsonl`.

### Reflection
The process of reviewing a session's captured guidance and extracting reusable lessons. Triggered by the `/marvel-reflect` skill. Reflection analyzes correction patterns, identifies recurring themes, and creates lesson candidates.

### Pre-Compact
A hook that fires before Claude Code compacts its context window. MARVEL uses this to summarize the current session state (active packs, recent injections, captured guidance) so the compacted context retains MARVEL awareness.

## Specifications

### Spec
A structured document describing a planned feature or change, stored under `marvel/specs/`. Specs follow a standard template with sections for goal, non-goals, context, constraints, proposed changes, acceptance criteria, and verification plan. Specs move through `backlog/` -> `active/` -> `completed/` as work progresses.
