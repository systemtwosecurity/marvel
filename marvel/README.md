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
│       ├── run.json          # Run state (packs, tool counts, etc.)
│       ├── trace.jsonl       # Tool call trace
│       ├── guidance.jsonl    # Captured user guidance
│       └── security-metrics.json  # Security gate statistics
└── tools/
    └── hooks/                # Hook daemon implementation
        ├── src/              # TypeScript source
        │   ├── daemon.ts     # Unix socket daemon
        │   ├── hooks/        # Hook handlers
        │   ├── lib/          # Shared utilities
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

MARVEL registers handlers for all Claude Code hook events via `.claude/settings.json`. Every hook invocation flows through a single shell entry point (`marvel-hook.sh`) which communicates with a per-project daemon over a Unix socket.

### Hook Lifecycle

1. Claude Code fires a hook event (e.g., `PreToolUse` before a file edit)
2. `marvel-hook.sh` reads the JSON input from stdin
3. The shell script sends the request to the daemon via Unix socket (`nc -U`)
4. The daemon dispatches to the appropriate handler
5. The handler returns JSON on stdout, which Claude Code processes

### Hook Events

| Event | When | What MARVEL Does |
|-------|------|------------------|
| `SessionStart` | Claude Code session begins | Create run directory, load packs, report active packs |
| `PreToolUse` | Before Bash, Edit, Write, or Read | Score pack relevance, inject matching lessons and guardrails |
| `PostToolUse` | After Edit, Write, Bash, Read, Grep, or Glob | Track tool outcomes, learn from approved commands |
| `PostToolUseFailure` | After Edit, Write, or Bash fails | Record failure for later reflection |
| `UserPromptSubmit` | User sends a message | Classify guidance type (correction, direction, task boundary) |
| `PermissionRequest` | Bash command needs approval | Run through 4-layer security gate |
| `PreCompact` | Before context window compaction | Summarize MARVEL state for the compacted context |
| `Stop` | Session stopping | Finalize run, persist metrics |
| `SubagentStart` | Subagent spawned | Track subagent lifecycle |
| `SubagentStop` | Subagent finished | Record subagent results |
| `Notification` | System notification | Handle notification events |
| `TeammateIdle` | Teammate becomes idle | Respond to idle events |
| `TaskCompleted` | Task marked complete | Record task completion |
| `SessionEnd` | Session ending | Finalize session, trigger reflection |

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

## Trace Storage

Each session creates a run directory under `marvel/runs/` containing:

- `run.json` -- Run state (active packs, tool call count, correction count, timestamps)
- `trace.jsonl` -- Chronological log of tool calls with input/output summaries
- `guidance.jsonl` -- User guidance captured during the session
- `security-metrics.json` -- Security gate decision statistics

Run directories are gitignored. They persist locally for analysis via `/marvel-health` and `pnpm analyze-decisions`.

## Daemon Architecture

The daemon (`daemon.ts`) is a Node.js process that:

1. Listens on a Unix socket at `$TMPDIR/mhd-{uid}/p-project-{hash}.sock`
2. Keeps all packs loaded in memory (no disk I/O per hook call)
3. Dispatches incoming requests to the appropriate hook handler
4. Tracks active sessions and self-terminates when the last session ends

### Scoping

- Daemons are keyed on the hash of `CLAUDE_PROJECT_DIR` (one per project directory)
- All sessions sharing a project directory (main session, subagents, peer CLI instances) share one daemon
- Session tracking is handled internally by the daemon, not by the shell script

### Startup

1. `marvel-hook.sh` checks for an existing socket
2. If no socket, it spawns `node daemon.bundle.js start {daemon-id}` in the background
3. Waits up to 500ms for the socket to appear
4. Sends the hook request over the socket via `nc -U`

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
