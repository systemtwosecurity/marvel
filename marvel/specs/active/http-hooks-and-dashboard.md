# HTTP Hooks Migration & Daemon Dashboard

**Owner:** MARVEL Core
**Status:** Active
**Created:** 2026-03-05

**Packs Required:**
- pack:code-quality@latest
- pack:security@latest
- pack:testing@latest

---

## 1. Goal

Add an HTTP server to the MARVEL daemon for two purposes:

1. **HTTP hooks endpoint** — The daemon exposes `POST /hooks/:hookType` so hooks can be invoked via HTTP. While the `settings.json` hook entries remain as `type: "command"` (because Claude Code loads settings statically and the HTTP port is dynamic), the HTTP endpoint enables external integrations, testing, and future migration when Claude Code supports dynamic port resolution.

2. **Daemon dashboard** — Serve a single-page HTML dashboard on the same HTTP port, styled with Tailwind CSS 4, showing daemon status, hook invocation metrics, active sessions, and recent hook activity. Accessible at `http://127.0.0.1:PORT/dashboard`.

## 2. Non-Goals

- Removing `marvel-hook.sh` entirely — some hook events (`SessionStart`, `SessionEnd`, `Notification`, `SubagentStart`, `TeammateIdle`, `PreCompact`, `WorktreeCreate`, `WorktreeRemove`, `ConfigChange`, `InstructionsLoaded`) are command-only in Claude Code and cannot use HTTP hooks
- Adding authentication to the HTTP server (localhost-only, bound to 127.0.0.1)
- WebSocket real-time updates on the dashboard (v1 uses polling or static snapshots)
- Changing any hook handler logic — only the transport layer changes

## 3. Context

### Current architecture

```
Claude Code hook event
  → shell: marvel-hook.sh <hook-type>
    → reads stdin JSON
    → starts daemon if needed (node daemon.bundle.js)
    → echo $JSON | nc -U $SOCKET_PATH
    → daemon handles hook, returns JSON on socket
    → shell outputs JSON to stdout
  → Claude Code reads stdout
```

**Latency**: ~5ms via daemon (vs ~40ms cold start). But the shell shim still adds fork+exec overhead, stdin/stdout pipe setup, and `nc` invocation for every hook call.

### Claude Code HTTP hooks (new)

Claude Code now supports `type: "http"` hooks that POST JSON directly to a URL:

```json
{
  "type": "http",
  "url": "http://localhost:PORT/hooks/pre-tool-use",
  "timeout": 30
}
```

**Supported events for HTTP hooks:**
- PreToolUse
- PostToolUse
- PostToolUseFailure
- PermissionRequest
- UserPromptSubmit
- Stop
- SubagentStop
- TaskCompleted

**Command-only events (cannot use HTTP):**
- SessionStart, SessionEnd
- Notification, SubagentStart, TeammateIdle
- PreCompact
- WorktreeCreate, WorktreeRemove
- ConfigChange, InstructionsLoaded

**Key differences:**
- HTTP hooks receive JSON as POST body (not stdin)
- Return JSON in response body (not stdout)
- Non-2xx responses are non-blocking errors (continue execution)
- To block: return 2xx with `{ "decision": "block", "reason": "..." }`
- Errors on connection failure are non-blocking (graceful degradation)

## 4. Constraints and Guardrails

- **Security**: HTTP server MUST bind to `127.0.0.1` only (no external access)
- **Port management**: Use dynamic port allocation (port 0), write port to a known file path so the shell hook shim and dashboard launcher can find it
- **Backwards compatibility**: `marvel-hook.sh` remains for command-only events and as fallback
- **No new dependencies**: Use Node.js built-in `http` module for the HTTP server
- **Dashboard**: Tailwind CSS 4 via CDN (`<script src="https://cdn.tailwindcss.com/4">`), single self-contained HTML response
- **Graceful degradation**: If the HTTP server fails to start, fall back to Unix socket-only mode

## 5. Proposed Change

### 5.1 Design

#### Phase 1: Add HTTP server to daemon

The daemon currently creates a `net.Server` on a Unix socket. Add a second `http.Server` listening on `127.0.0.1:0` (dynamic port).

```
daemon.ts changes:
├── startDaemon()
│   ├── existing: net.createServer() → Unix socket (keep for command-only hooks)
│   └── new: http.createServer() → localhost:PORT
│       ├── POST /hooks/:hookType → route to existing handlers[]
│       ├── GET /health → daemon health JSON
│       └── GET /dashboard → HTML dashboard UI
└── Write port to: ${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.port
```

**HTTP hook routing:**
- `POST /hooks/pre-tool-use` → `handlers["pre-tool-use"](body)`
- `POST /hooks/post-tool-use` → `handlers["post-tool-use"](body)`
- etc.

**Response mapping:**
- Handler returns JSON → 200 with JSON body
- Handler throws → 200 with `{}` (non-blocking, matches current behavior)
- Unknown hook → 404

#### Phase 2: Port discovery and settings

The settings.json hook entries remain as `type: "command"` because Claude Code snapshots hooks at startup before the daemon's HTTP port is known. The HTTP server uses a deterministic port derived from the project directory hash for discoverability:

```typescript
function deriveHttpPort(projectDir: string): number {
  const hash = createHash('sha256').update(projectDir).digest();
  return 10000 + (hash.readUInt16BE(0) % 55000);
}
```

The actual port is written to `${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.port` for programmatic discovery. The shell script reads this and logs the dashboard URL on `session-start`.

**Future**: When Claude Code supports dynamic port resolution or env var interpolation in HTTP hook URLs, the settings.json can switch to `type: "http"` hooks.

#### Phase 3: Dashboard UI

Serve a self-contained HTML page at `GET /dashboard` with Tailwind CSS 4:

**Dashboard sections:**
1. **Daemon Status** — PID, uptime, project directory, daemon ID, port, socket path
2. **Active Sessions** — List of session IDs currently tracked, with join timestamps
3. **Hook Metrics** — Per-hook-type counters: total calls, avg latency, errors, last called
4. **Recent Activity** — Last 50 hook invocations with timestamp, hook type, duration, status
5. **Evaluator Health** — Agent evaluator status (warm/cold), evaluation count, avg latency
6. **Pack Info** — Loaded packs and their guardrail counts

**Data collection:**
Add lightweight in-memory metrics to the daemon:
```typescript
interface HookMetrics {
  totalCalls: number;
  totalErrors: number;
  totalDurationMs: number;
  lastCalledAt: Date | null;
  recentCalls: Array<{
    timestamp: Date;
    durationMs: number;
    status: 'ok' | 'error' | 'timeout';
    requestId: string;
  }>;
}

const metrics: Record<string, HookMetrics> = {};
```

### 5.2 Files and Modules

| File | Change |
|------|--------|
| `marvel/tools/hooks/src/daemon.ts` | Add HTTP server, metrics collection, dashboard/health endpoints |
| `marvel/tools/hooks/src/lib/dashboard.ts` | New: HTML template function for dashboard UI |
| `marvel/tools/hooks/src/lib/metrics.ts` | New: Hook metrics collection and aggregation |
| `marvel/tools/hooks/scripts/marvel-hook.sh` | Read port file on session-start, log dashboard URL, clean up port files |

## 6. Acceptance Criteria

- [ ] Daemon starts an HTTP server on a deterministic localhost port alongside the existing Unix socket
- [ ] Port number is written to `${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.port` on startup
- [ ] HTTP POST to `/hooks/:hookType` invokes the correct handler and returns JSON
- [ ] HTTP hooks in `settings.json` work for: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TaskCompleted
- [ ] Command hooks remain for: SessionStart, SessionEnd, PreCompact, Notification, SubagentStart, SubagentStop (kept as command too for the session tracking), TeammateIdle, TaskCompleted (dual)
- [ ] `GET /health` returns daemon status JSON
- [ ] `GET /dashboard` returns a styled HTML page with Tailwind CSS 4 showing:
  - Daemon status (PID, uptime, project, port)
  - Active sessions
  - Per-hook metrics (call count, latency, errors)
  - Recent hook activity feed (last 50 calls)
  - Evaluator health
- [ ] Dashboard auto-refreshes (meta refresh or JS polling)
- [ ] All existing tests pass
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] No regressions in hook behavior

## 7. Verification Plan

```bash
# Unit tests
cd marvel/tools/hooks && pnpm test:run

# Type check
pnpm typecheck

# Build
pnpm build

# Manual verification
# 1. Start a Claude Code session — daemon starts, HTTP port written
# 2. curl http://localhost:PORT/health — returns JSON
# 3. curl http://localhost:PORT/dashboard — returns HTML
# 4. Verify hooks fire correctly through HTTP transport
# 5. Verify command-only hooks still work through shell shim
```

## 8. Rollback Plan

Revert `.claude/settings.json` to all `type: "command"` hooks. The daemon's HTTP server is additive — it doesn't affect the Unix socket path. The shell shim continues to work regardless.

## 9. Notes for MARVEL Runner

- **Risk level:** medium
- **Key risk**: Port collision on the deterministic port. Mitigated by fallback to port+N and the Unix socket remaining as backup.
- **Key risk**: Claude Code snapshots hooks at startup — if the daemon isn't running when hooks are loaded, the HTTP URL won't be reachable. Mitigated by: `SessionStart` is always a command hook that starts the daemon first, so by the time HTTP hooks fire, the server is ready.
- **Ordering dependency**: `SessionStart` (command hook) MUST fire before any HTTP hook. This is guaranteed by Claude Code's hook lifecycle — `SessionStart` fires first.
- **Dashboard is cosmetic** — failures in the dashboard endpoint should never affect hook processing.
