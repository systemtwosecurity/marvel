# Terminology

Glossary of terms used throughout the MARVEL system.

## Core Concepts

### Pack
A self-contained unit of knowledge covering a specific domain (e.g., code quality, security, testing). Each pack contains metadata (`pack.json`), human-written rules (`guardrails.md`), and machine-learned lessons (`lessons.jsonl`). Packs live under `marvel/packs/`.

### Lesson
A single piece of learned knowledge stored in a pack's `lessons.jsonl` file. Each lesson has a category, title, description, and actionable instruction. Lessons are created through the reflection process or added manually via `/marvel-teach`.

### Guidance
A user-provided correction, direction, or instruction captured during a session by the `UserPromptSubmit` hook. Guidance is classified by type (correction, direction, task start/end, clarification, approval, rejection) and stored in the run's `guidance.jsonl` for later reflection.

### Guardrails
Human-authored rules in a pack's `guardrails.md` file. Guardrails are injected into Claude's context when the pack is relevant. They represent the team's established conventions and standards.

### Injection
The process of inserting relevant pack content (guardrails and lessons) into Claude's context during a `PreToolUse` hook. Only packs scoring above the relevance threshold are injected. Maximum of 4 packs and 10 lessons per injection.

## Hook System

### Hook
A Claude Code extension point that fires at specific moments during a session (e.g., before a file edit, after a bash command, when the user submits a prompt). MARVEL registers handlers for all available hooks.

### Relevance Scoring
The algorithm that determines which packs are relevant to a given file operation. Scoring considers file extension matches, code path matches, sensitive path patterns, recent user corrections, category alignment, and path keywords. See [docs/packs.md](packs.md) for scoring weights.

## Security

### Security Gate
The 4-layer evaluation system that assesses every bash command before execution. Layers are checked in order: allowlist, denylist, learned rules, LLM evaluator. The first matching layer determines the outcome. See [docs/security.md](security.md).

### Allowlist
A JSON file (`marvel/security/allowlist.json`) containing patterns for commands that are always permitted (e.g., `git status`, `ls`, `pnpm build`).

### Denylist
A JSON file (`marvel/security/denylist.json`) containing patterns for commands that are always blocked (e.g., `rm -rf /`, `curl | bash`). The denylist is checked before learned rules to prevent dangerous commands from being allowed by broad patterns.

### Learned Rules
Command patterns previously approved by the user and saved for future sessions. Stored in `marvel/security/learned.jsonl` (gitignored, local to each developer).

## Lifecycle

### Run
A single Claude Code session, identified by a run ID (e.g., `run_20260115_103000`). Each run has its own directory under `marvel/runs/` containing trace data, guidance, and metrics. Runs are gitignored.

### Daemon
A long-running Node.js process that keeps packs in memory and handles hook requests over a Unix socket. One daemon per project directory. Eliminates ~40ms cold-start overhead per hook call.

### Promotion
Graduating learned knowledge into permanent pack content. Security rule promotion moves frequently-used learned rules into the allowlist. Lesson promotion appends high-confidence lessons to `lessons.jsonl`.

### Reflection
Reviewing a session's captured guidance and extracting reusable lessons. Triggered by `/marvel-reflect`. Analyzes correction patterns and creates lesson candidates.

### Pre-Compact
A hook that fires before Claude Code compacts its context window. MARVEL summarizes session state (active packs, recent injections, corrections) so the compacted context retains MARVEL awareness.

## Specifications

### Spec
A structured document describing a planned feature or change, stored under `marvel/specs/`. Specs follow a template with sections for goal, non-goals, context, proposed changes, and acceptance criteria. They move through `backlog/` -> `active/` -> `completed/`.
