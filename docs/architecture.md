# Architecture

MARVEL is a hook-based system that wraps Claude Code sessions. It operates through a per-project daemon process that intercepts tool calls, injects knowledge, and evaluates security.

## System Overview

```
Claude Code Session
       |
       v
  Hook Event
       |
       +--- Command hooks ---------> marvel-hook.sh
       |                                |  (Unix socket, ~5ms)
       +--- HTTP hooks (POST) -----+   |
       |                           |   |
       v                           v   v
                    Daemon Process (Node.js)
                           |
                           +---> Hook Handler
                           |        |
                           |        +---> Pack Loader (relevance scoring)
                           |        +---> Security Gate (4-layer eval)
                           |        +---> Reflection Engine (pre/post)
                           |        +---> Session State (run tracking)
                           |
                           +---> HTTP Endpoints
                           |        +---> GET /dashboard (live HTML)
                           |        +---> GET /health (JSON status)
                           |
                           v
                    JSON Response
                           |
                           v
                    Claude Code (additionalContext injected)
```

## Daemon

The daemon (`marvel/tools/hooks/src/daemon.ts`) is a long-running Node.js process with dual transport:

1. **Unix socket** at `$TMPDIR/mhd-{uid}/p-project-{hash}.sock` — for command-type hooks
2. **HTTP server** on `127.0.0.1:<PORT>` — for HTTP-type hooks, dashboard, and external integrations
3. Keeps all packs loaded in memory (no disk I/O per hook call)
4. Dispatches incoming requests to the appropriate hook handler
5. Collects per-hook metrics (call count, latency, errors, last called)
6. Tracks active sessions and self-terminates when the last session ends

### Why a Daemon

Without a daemon, every hook invocation would spawn a new Node.js process (~40ms startup cost). With 14 hook events firing frequently, this adds noticeable latency. The daemon keeps everything in memory and responds in under 5ms via Unix socket.

### HTTP Server

The HTTP server starts alongside the Unix socket and provides:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/hooks/:hookType` | POST | Invoke a hook handler (same dispatch path as socket) |
| `/health` | GET | JSON status: metrics, sessions, uptime, evaluator health |
| `/dashboard` (or `/`) | GET | Live HTML dashboard with Tailwind CSS 4 |

The HTTP port is deterministic (derived from project directory hash, range 10000-65000) and written to `$TMPDIR/mhd-{uid}/p-{daemon-id}.port`. The dashboard shows:
- Daemon status (PID, uptime, port, project)
- Active sessions
- Per-hook metrics (call count, avg latency, errors)
- Recent hook activity feed
- Evaluator health
- Loaded packs

If the HTTP server fails to start (e.g., port conflict), the daemon falls back to Unix socket-only mode.

### Scoping

Daemons are keyed on the SHA-256 hash of `CLAUDE_PROJECT_DIR` (one per project directory). All sessions sharing a project directory — main session, subagents, peer CLI instances — share one daemon. The daemon tracks active `session_id` values internally.

Using `CLAUDE_CODE_SESSION_ID` for scoping was considered and rejected: it is unique per subagent, which caused one daemon per subagent (73 zombie daemons observed during testing).

### Startup Sequence

1. `marvel-hook.sh` checks for an existing socket
2. If no socket, it spawns `node daemon.bundle.js start {daemon-id}` in the background
3. Waits up to 500ms for the socket to appear
4. Sends the hook request over the socket via `nc -U`
5. The HTTP server starts on the deterministic port (non-fatal if port unavailable)

### Shutdown

When a `session-end` hook arrives and the active session set becomes empty, the daemon:
1. Shuts down the LLM evaluation session (if running)
2. Clears cached state
3. Schedules self-termination after 500ms (to ensure the response reaches the caller)

## Hook Lifecycle

Every hook invocation flows through the same path:

1. Claude Code fires a hook event (e.g., `PreToolUse` before a file edit)
2. Claude Code executes `marvel-hook.sh <hook-type>` with JSON on stdin
3. The shell script extracts `session_id`, derives the daemon ID from `CLAUDE_PROJECT_DIR`
4. The request is sent to the daemon via Unix socket (`nc -U`)
5. The daemon dispatches to the registered handler
6. The handler returns a JSON response
7. Claude Code processes the response (e.g., injects `additionalContext`)

### Hook Events

| Event | When | What MARVEL Does |
|-------|------|------------------|
| `SessionStart` | Session begins | Create run directory, load packs, initialize reflection state |
| `PreToolUse` | Before Bash, Edit, Write, or Read | Inject matching lessons + active reflection context; run security gate for Bash |
| `PostToolUse` | After Edit, Write, Bash, Read, Grep, or Glob | Track outcomes, learn security rules, record verification results and files into active reflection |
| `PostToolUseFailure` | After Edit, Write, or Bash fails | Record failure, track verification failures into active reflection |
| `UserPromptSubmit` | User sends a message | Classify guidance; detect task boundaries → create PreReflection / close PostReflection |
| `PermissionRequest` | Bash command needs approval | Run through 4-layer security gate |
| `PreCompact` | Before context window compaction | Summarize MARVEL state including active reflection |
| `Stop` | Session stopping | Close open reflections, correlate outcomes, update utility scores, surface candidates |
| `SubagentStart/Stop` | Subagent lifecycle | Track subagent activity |
| `Notification` | System notification | Record notification events |
| `TeammateIdle` | Teammate becomes idle | Record idle events |
| `TaskCompleted` | Task marked complete | Record task completion |
| `SessionEnd` | Session ending | Remove session from set; shut down if last |

### Handler Timeouts

- Default: 9 seconds
- Security hooks (`pre-tool-use`, `permission-request`): 20 seconds (to accommodate LLM evaluation)

On timeout, the handler returns an empty response (`{}`), allowing Claude to proceed unblocked.

## Shell Entry Point

`marvel/tools/hooks/scripts/marvel-hook.sh` is the single entry point for all hooks. It:

1. Reads JSON from stdin
2. Extracts `session_id`
3. Derives `DAEMON_ID` from `CLAUDE_PROJECT_DIR` hash
4. Computes socket/PID/log paths in the UID-scoped temp directory
5. Starts the daemon if not running
6. Sends the request via `nc -U` and returns the response

The short naming scheme (`mhd-{uid}/p-project-{hash}`) keeps socket paths well under the macOS `sun_path` limit of 104 bytes.

## Build System

The hook daemon is built with esbuild into self-contained bundles:

```bash
pnpm build  # Runs: test -> typecheck -> compile -> bundle -> validate
```

Four bundles are produced:
- `dist/daemon.bundle.js` — the hook daemon
- `dist/cli.bundle.js` — query CLI (status, packs)
- `dist/analyze-decisions.js` — security decision analysis
- `dist/analyze-evaluations.js` — LLM evaluation analysis

All bundles target Node 24, use ESM format, and inline dependencies (only `ws` at runtime).

## Session State

Each session creates a run directory under `marvel/runs/run_YYYYMMDD_HHMMSS/` containing:

- `run.json` — Run state (active packs, tool call count, active reflection, timestamps)
- `tool_calls.jsonl` — Chronological log of tool calls with input/output summaries
- `guidance.jsonl` — User guidance (corrections, directions) captured during the session
- `injections.jsonl` — Record of which packs/lessons were injected for which files
- `lesson-outcomes.jsonl` — Per-lesson outcome stats for utility score updates
- `reflection-pre-<taskId>.json` — PreReflection: plan, assumptions, risks, confidence
- `reflection-post-<taskId>.json` — PostReflection: actual outcome, assumptions validated/invalidated
- `security-metrics.json` — Security gate statistics
- `snapshot-<timestamp>.json` — Run state snapshots taken before context compaction

Run directories are gitignored. They persist locally for analysis via `/marvel-health`.

## Injection Deduplication

An in-memory `Set` (max 200 entries) prevents the same lesson from being injected twice in one daemon lifetime. The cache is cleared on `PreCompact` so lessons re-inject after context window compaction.

## Concurrency

The daemon processes requests serially (single-threaded Node.js). For the LLM security evaluator, a lock (`evalLockTail` promise chain) plus a dedup cache ensures that concurrent `pre-tool-use` and `permission-request` hooks for the same command don't trigger duplicate evaluations.
