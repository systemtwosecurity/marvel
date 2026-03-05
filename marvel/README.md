# MARVEL System Documentation

MARVEL (Model-Augmented Reasoning, Verification, Execution, and Learning) is a hook-based knowledge and safety system for Claude Code. It intercepts tool calls during a Claude Code session, injects contextually relevant guidance from curated knowledge packs, evaluates bash commands through a multi-layer security gate, and learns from user corrections over time.

This document covers the internal architecture of the MARVEL system. For installation and quick-start instructions, see the root `README.md`.

## Directory Structure

```
marvel/
├── packs/                    # Knowledge packs
│   ├── _pack.schema.json     # JSON Schema for pack.json validation
│   ├── code-quality/         # Starter pack: TypeScript code quality
│   ├── git-workflow/         # Starter pack: Git conventions
│   ├── testing/              # Starter pack: Test best practices
│   └── security/             # Starter pack: Security patterns
├── security/                 # Security gate configuration
│   ├── config.json           # Agent evaluator settings
│   ├── allowlist.json        # Known-safe command patterns
│   ├── denylist.json         # Known-dangerous command patterns
│   ├── learned.jsonl         # User-approved patterns (gitignored)
│   ├── suggestions.jsonl     # LLM-suggested rules (gitignored)
│   ├── decisions.jsonl       # Decision audit log (gitignored)
│   └── agent-evaluations.jsonl  # LLM evaluation traces (gitignored)
├── specs/                    # Feature specifications
│   ├── active/               # Specs currently being implemented
│   ├── backlog/              # Planned specs
│   ├── completed/            # Finished specs
│   └── templates/            # Spec templates
├── runs/                     # Session trace data (gitignored)
│   └── run_YYYYMMDD_HHMMSS/ # Per-session directory
│       ├── run.json          # Run state (packs, tool counts, reflection)
│       ├── tool_calls.jsonl  # Tool call trace
│       ├── guidance.jsonl    # Captured user guidance
│       ├── injections.jsonl  # Pack injection records
│       ├── lesson-outcomes.jsonl  # Per-lesson outcome stats
│       ├── reflection-pre-<taskId>.json   # PreReflection (assumptions, plan)
│       ├── reflection-post-<taskId>.json  # PostReflection (validated/invalidated)
│       └── security-metrics.json  # Security gate statistics
└── tools/
    └── hooks/                # Hook daemon implementation
        ├── src/              # TypeScript source
        │   ├── daemon.ts     # Dual-transport daemon (Unix socket + HTTP)
        │   ├── hooks/        # Hook handlers
        │   ├── lib/          # Shared utilities
        │   │   ├── reflection.ts   # PreReflection/PostReflection generator
        │   │   ├── dashboard.ts    # HTML dashboard renderer
        │   │   └── ...             # Security, guidance, file ops, etc.
        │   ├── loaders/      # Pack and lesson loading
        │   └── schema/       # Settings validation
        ├── scripts/
        │   └── marvel-hook.sh  # Shell entry point for all hooks
        ├── dist/             # Built output (gitignored)
        │   └── daemon.bundle.js  # Bundled daemon
        ├── package.json
        └── tsconfig.json
```

## Hook System

MARVEL registers handlers for all Claude Code hook events via `.claude/settings.json`. Hook invocations flow through either a shell entry point (`marvel-hook.sh` over Unix socket) or HTTP POST (for supported events), both routing to a per-project daemon.

### Hook Lifecycle

1. Claude Code fires a hook event (e.g., `PreToolUse` before a file edit)
2. The event is delivered to the daemon via one of two transports:
   - **Command hooks**: `marvel-hook.sh` reads JSON from stdin and sends it over Unix socket (`nc -U`)
   - **HTTP hooks**: Claude Code POSTs JSON directly to `http://127.0.0.1:PORT/hooks/:hookType`
3. The daemon dispatches to the appropriate handler
4. The handler returns JSON, which Claude Code processes

### Hook Events

| Event | When | What MARVEL Does |
|-------|------|------------------|
| `SessionStart` | Claude Code session begins | Create run directory, load packs, initialize reflection state |
| `PreToolUse` | Before Bash, Edit, Write, or Read | Inject matching lessons; inject active reflection context (assumptions, risks); run security gate for Bash |
| `PostToolUse` | After Edit, Write, Bash, Read, Grep, or Glob | Track tool outcomes, learn from approved commands, record verification results and files modified into active reflection |
| `PostToolUseFailure` | After Edit, Write, or Bash fails | Record failure, track verification failures into active reflection |
| `UserPromptSubmit` | User sends a message | Classify guidance; detect task boundaries → create PreReflection (task_start) or close PostReflection (task_end) |
| `PermissionRequest` | Bash command needs approval | Run through 4-layer security gate |
| `PreCompact` | Before context window compaction | Summarize MARVEL state including active reflection for the compacted context |
| `Stop` | Session stopping | Close any open reflection, correlate outcomes, update lesson utility scores, surface promotion candidates |
| `SubagentStart` | Subagent spawned | Track subagent lifecycle |
| `SubagentStop` | Subagent finished | Record subagent results |
| `Notification` | System notification | Handle notification events |
| `TeammateIdle` | Teammate becomes idle | Respond to idle events |
| `TaskCompleted` | Task marked complete | Record task completion |
| `SessionEnd` | Session ending | Remove session from set; shut down if last |

## Relevance Scoring

When a `PreToolUse` hook fires for a file operation, MARVEL scores every loaded pack against the target file to decide which lessons to inject.

### Scoring Weights

| Signal | Weight | Description |
|--------|--------|-------------|
| `FILE_PATTERN_MATCH` | 15 | File path matches a pack's `references.code_paths` |
| `EXTENSION_MATCH` | 5 | File extension matches the pack's `applies_to.extensions` |
| `SENSITIVE_PATH` | 20 | File matches a pack's `sensitive_paths` glob pattern |
| `RECENT_CORRECTION` | 20 | User recently corrected something in this pack's category (up to 3x) |
| `CATEGORY_MATCH` | 8 | Recent guidance matches the pack's categories |
| `DEPENDENCY_BOOST` | 3 | Pack is a dependency of another relevant pack |

### Thresholds

- **Strong signal** (code path, sensitive path, or recent correction): minimum score of 10
- **Weak signal** (extension match only): minimum score of 20
- **Maximum packs per injection**: 4

### Path Keyword Boosting

File paths containing certain keywords boost packs with matching categories:

| Keyword | Boosted Categories |
|---------|-------------------|
| `test`, `spec` | testing, test-quality |
| `auth`, `middleware` | security, auth |
| `config`, `env` | configuration |
| `schema`, `migration` | database, schema |

Projects can extend this mapping by modifying `relevance.ts`.

## Pack Structure

Each pack is a directory under `marvel/packs/` containing three files:

### pack.json

Metadata that controls when the pack's lessons are injected. Validated against `_pack.schema.json`.

Required fields:
- `name` -- Must match the directory name (lowercase, hyphenated)
- `version` -- Semantic version string
- `owner` -- Team or individual responsible

Optional fields:
- `description` -- Brief description of the pack's purpose
- `categories` -- Knowledge domains (used for relevance scoring)
- `applies_to.extensions` -- File extensions that trigger this pack
- `depends_on` -- Other packs this pack depends on
- `sensitive_paths` -- Glob patterns for high-importance files
- `excludes_paths` -- Path prefixes where this pack should not inject
- `references.code_paths` -- Key file paths in the codebase
- `references.doc_links` -- External documentation URLs

### guardrails.md

Human-readable rules and conventions. This file is injected into Claude's context when the pack is relevant. Write clear, actionable instructions organized by topic.

### lessons.jsonl

Machine-learned lessons, one JSON object per line. Lessons are appended automatically by the `/marvel-reflect` skill or manually by the user.

Each lesson contains:
- `timestamp` -- When the lesson was created
- `category` -- Knowledge domain
- `title` -- Short identifier
- `description` -- What the lesson teaches
- `actionable` -- Concrete instruction for Claude to follow
- `run_id` -- Session that created the lesson (optional)
- `utility_score` -- Effectiveness rating from `/marvel-health` (optional)
- `injection_count` -- How many times this lesson has been injected (optional)

## Lesson Lifecycle

1. **Capture** -- `UserPromptSubmit` hook detects a user correction or direction
2. **Classify** -- Guidance is categorized (correction, direction, task boundary, etc.)
3. **Store** -- Guidance is written to the run's `guidance.jsonl`
4. **Reflect** -- The `/marvel-reflect` skill reviews guidance and extracts lessons
5. **Promote** -- Lessons with sufficient confidence are appended to the target pack's `lessons.jsonl`
6. **Inject** -- Future `PreToolUse` hooks include the lesson when the pack is relevant
7. **Evolve** -- The `/marvel-evolve` skill graduates high-utility lessons into `guardrails.md` and prunes stale ones

## Reflection System

MARVEL uses a prediction-validation loop to learn from task execution, not just user corrections. Before a task begins, a **PreReflection** records what MARVEL expects to happen. After execution, a **PostReflection** compares the actual outcome against those predictions.

### PreReflection (before execution)

Created when `UserPromptSubmit` detects a task_start pattern (e.g., "Add error handling to the API client"). Contains:

- **Plan** — high-level steps derived from the task description
- **Assumptions** — what MARVEL expects to hold true (e.g., "Existing code follows established patterns", "Test suite is comprehensive and passing")
- **Risks** — detected from sensitive path patterns (auth, security, migration)
- **Confidence** — 0-1 score adjusted by risk factors and pack coverage
- **Expected verification** — lint, typecheck, test, build

Assumptions are derived from the active packs. The `code-quality` pack contributes pattern-related assumptions; the `testing` pack contributes test assumptions; etc.

### PostReflection (after execution)

Created when a task ends (task_end detected, new task starts, or session stops). Compares against the PreReflection:

- **Actual outcome** — success/failure with failure stage (lint, test, build, typecheck)
- **Assumptions validated** — assumptions with no contradicting evidence
- **Assumptions invalidated** — assumptions disproven by verification failures or user corrections
- **Confidence delta** — adjusted based on outcome (+0.15 for clean success, -0.2 per failure)
- **Next steps** — suggested follow-ups for failures

### How hooks participate

| Hook | Reflection Role |
|------|----------------|
| `SessionStart` | Initialize `activeReflection` in run state |
| `UserPromptSubmit` | Detect task boundaries → create PreReflection / close PostReflection |
| `PreToolUse` | Inject `<marvel-reflection>` context block with assumptions and risks |
| `PostToolUse` | Track verification results (lint/test/build/typecheck pass) and files modified |
| `PostToolUseFailure` | Track verification failures |
| `Stop` | Close any open reflection, include summary in stop message |
| `PreCompact` | Preserve active reflection state across context compaction |

### Learning from reflections

Invalidated assumptions feed into the existing learning loop:

1. **Assumption invalidated** → the associated pack's lessons were insufficient → utility score reduced
2. **All assumptions validated** → lessons were effective → utility score boosted
3. **Reflection summary** surfaced at session end alongside promotion candidates

This means MARVEL learns not just from explicit user corrections but from its own prediction failures — test failures, lint errors, and build breakages all contribute to the feedback loop.

### Storage

Reflections are stored as pretty-printed JSON in the run directory:
- `reflection-pre-<taskId>.json` — PreReflection
- `reflection-post-<taskId>.json` — PostReflection

Task IDs are derived from timestamp (`task_HHmmss`), unique within a run.

## Trace Storage

Each session creates a run directory under `marvel/runs/` containing:

- `run.json` -- Run state (active packs, tool call count, correction count, active reflection, timestamps)
- `tool_calls.jsonl` -- Chronological log of tool calls with input/output summaries
- `guidance.jsonl` -- User guidance captured during the session
- `injections.jsonl` -- Record of which packs/lessons were injected for which files
- `lesson-outcomes.jsonl` -- Per-lesson outcome stats (injection count vs correction count)
- `reflection-pre-<taskId>.json` -- PreReflection: plan, assumptions, risks, confidence
- `reflection-post-<taskId>.json` -- PostReflection: actual outcome, assumptions validated/invalidated
- `security-metrics.json` -- Security gate decision statistics

Run directories are gitignored. They persist locally for analysis via `/marvel-health` and `pnpm analyze-decisions`.

## Daemon Architecture

The daemon (`daemon.ts`) is a Node.js process with dual transport:

1. **Unix socket** at `$TMPDIR/mhd-{uid}/p-project-{hash}.sock` — used by `marvel-hook.sh` for command-type hooks
2. **HTTP server** on `127.0.0.1:<PORT>` — used for HTTP-type hooks, the dashboard, and external integrations
3. Keeps all packs loaded in memory (no disk I/O per hook call)
4. Dispatches incoming requests to the appropriate hook handler
5. Collects per-hook metrics (call count, latency, errors)
6. Tracks active sessions and self-terminates when the last session ends

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/hooks/:hookType` | POST | Invoke a hook handler (same as Unix socket path) |
| `/health` | GET | Daemon status JSON (metrics, sessions, uptime) |
| `/dashboard` | GET | Styled HTML dashboard with real-time metrics |

The HTTP port is deterministic (derived from project directory hash, range 10000-65000) and written to `$TMPDIR/mhd-{uid}/p-{daemon-id}.port`. The dashboard is accessible at `http://127.0.0.1:PORT/dashboard`.

### Scoping

- Daemons are keyed on the hash of `CLAUDE_PROJECT_DIR` (one per project directory)
- All sessions sharing a project directory (main session, subagents, peer CLI instances) share one daemon
- Session tracking is handled internally by the daemon, not by the shell script

### Startup

1. `marvel-hook.sh` checks for an existing socket
2. If no socket, it spawns `node daemon.bundle.js start {daemon-id}` in the background
3. Waits up to 500ms for the socket to appear
4. Sends the hook request over the socket via `nc -U`
5. The HTTP server starts alongside the socket server (non-fatal if port is unavailable)

### Management

Use `bin/marvel-daemon` to inspect and manage daemons:

```bash
bin/marvel-daemon list       # Show all daemons with PID, socket, and log info
bin/marvel-daemon status     # Show daemon for current directory
bin/marvel-daemon log        # Tail the daemon log
bin/marvel-daemon restart    # Kill daemon (restarts automatically on next hook)
bin/marvel-daemon cleanup    # Remove stale PID/socket files for dead daemons
```

## Adding to a Project

See the root `README.md` for installation instructions via `bin/marvel-init`, or manually:

1. Copy `marvel/` into your project
2. Merge hook registrations into `.claude/settings.json`
3. Add the MARVEL section to your `CLAUDE.md`
4. Add gitignore entries for `marvel/runs/` and learned rule files
5. Run `cd marvel/tools/hooks && pnpm install && pnpm build`
