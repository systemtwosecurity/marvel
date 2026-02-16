#!/bin/bash
# Copyright 2026 Detections AI
# SPDX-License-Identifier: Apache-2.0
#
# MARVEL Hooks Entry Point
#
# Unified entry point for all Claude Code hooks.
# Manages a per-project daemon lifecycle automatically.
#
# Daemon scoping:
#   - Keyed on CLAUDE_PROJECT_DIR hash (one daemon per project directory)
#   - All sessions (main, subagents, peer CLI) share the same daemon
#   - The daemon tracks active sessions internally and self-terminates
#     when the last session ends (no stop_daemon needed from shell)
#
# WARNING: Do NOT use CLAUDE_CODE_SESSION_ID for daemon scoping — it is unique
# per subagent, not inherited from parent. Using it causes a daemon-per-subagent
# leak (discovered during testing: 73 zombie daemons from one session).
#
# Features:
#   - Uses daemon for fast hooks (~5ms vs ~40ms)
#   - Falls back to direct execution with clear warnings
#   - Daemon tracks active sessions: shutdown only when last session leaves
#
# Usage: marvel-hook.sh <hook-type>
# Input: JSON on stdin (from Claude Code)
# Output: JSON on stdout (to Claude Code)
#

set -o pipefail

HOOK_TYPE="${1:-}"

# CLAUDE_PROJECT_DIR is always set by Claude Code - build paths from it
if [[ -z "$CLAUDE_PROJECT_DIR" ]]; then
  echo '{"error":"CLAUDE_PROJECT_DIR not set - hooks must be run by Claude Code"}' >&2
  exit 1
fi

HOOKS_DIR="$CLAUDE_PROJECT_DIR/marvel/tools/hooks"

# Read stdin once, store for reuse (with timeout to avoid hanging)
# Check if stdin has data available before reading
INPUT=""
if [[ -t 0 ]]; then
  # stdin is a terminal, no piped input
  INPUT='{}'
else
  # stdin is piped - read with timeout to avoid hanging on empty pipe
  INPUT=$(timeout 1 cat 2>/dev/null || true)
  if [[ -z "$INPUT" ]]; then
    INPUT='{}'
  fi
fi

# Extract session_id from input
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID="default"
fi

# Derive daemon ID from project directory hash.
# One daemon per project, shared by all sessions (main, subagents, peers).
# The daemon tracks active session_ids internally and self-terminates when
# the last session ends.
PROJECT_HASH=$(echo -n "$CLAUDE_PROJECT_DIR" | shasum -a 256 | cut -c1-12)
DAEMON_ID="project-${PROJECT_HASH}"

# Derive the same UID-scoped temp dir as Node's getTempDir()
# os.tmpdir() reads $TMPDIR on macOS (e.g., /var/folders/.../T/)
# Falls back to /tmp on Linux where $TMPDIR is often unset
# Short dir name "mhd-" keeps full socket path well under macOS sun_path limit.
MARVEL_TEMP_DIR="${TMPDIR:-/tmp}/mhd-$(id -u)"
mkdir -p "$MARVEL_TEMP_DIR" && chmod 700 "$MARVEL_TEMP_DIR" 2>/dev/null

REQUEST_ID="req_$(date +%s)_$RANDOM"
# Short file prefix "p-" + short dir "mhd-{uid}" keeps socket path well under
# the macOS sun_path limit of 104 bytes (~76 chars total, 27 chars of headroom).
LOG_PATH="${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.log"
SOCKET_PATH="${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.sock"
PID_PATH="${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.pid"

export MARVEL_SESSION_ID="$SESSION_ID"
export MARVEL_DAEMON_ID="$DAEMON_ID"
export MARVEL_REQUEST_ID="$REQUEST_ID"
export MARVEL_LOG_PATH="$LOG_PATH"
export CLAUDE_SESSION_ID="$SESSION_ID"

# Logging helpers - output to stderr so they don't interfere with JSON response
log_warn() {
  echo "[marvel-hooks] WARNING: $1" >&2
  if [[ -n "$LOG_PATH" ]]; then
    echo "[marvel-hooks] WARNING: $1" >>"$LOG_PATH"
  fi
}

log_info() {
  echo "[marvel-hooks] $1" >&2
  if [[ -n "$LOG_PATH" ]]; then
    echo "[marvel-hooks] $1" >>"$LOG_PATH"
  fi
}

# Check if daemon is running for this project
daemon_running() {
  if [[ ! -S "$SOCKET_PATH" ]] || [[ ! -f "$PID_PATH" ]]; then
    return 1
  fi
  # Verify the PID is actually alive
  local pid=$(cat "$PID_PATH" 2>/dev/null)
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  # Stale — clean up
  rm -f "$PID_PATH" "$SOCKET_PATH" 2>/dev/null
  return 1
}

# Start daemon for this project (or reuse existing one)
start_daemon() {
  # If daemon is already running (started by a previous session), reuse it
  if daemon_running; then
    log_info "Daemon already running for project (reusing)"
    return 0
  fi

  # Kill any stale daemon
  if [[ -f "$PID_PATH" ]]; then
    local old_pid=$(cat "$PID_PATH" 2>/dev/null)
    if [[ -n "$old_pid" ]]; then
      kill "$old_pid" 2>/dev/null || true
    fi
    rm -f "$PID_PATH" "$SOCKET_PATH" 2>/dev/null
  fi

  # Start new daemon in background
  # CRITICAL: Redirect all file descriptors to fully detach from parent
  # Otherwise, Claude Code waits for stdout pipe to close (which daemon keeps open)
  # MARVEL_DEBUG=1: Required for logDebug() to write to the log file.
  # Without this, agent evaluator protocol traces are silently dropped.
  MARVEL_SESSION_ID="$SESSION_ID" MARVEL_LOG_PATH="$LOG_PATH" MARVEL_DEBUG=1 \
    node "$HOOKS_DIR/dist/daemon.bundle.js" start "$DAEMON_ID" </dev/null >>"$LOG_PATH" 2>&1 &
  local daemon_pid=$!
  sleep 0.05
  if ! kill -0 "$daemon_pid" 2>/dev/null; then
    log_warn "Daemon process exited early (pid: $daemon_pid). See $LOG_PATH"
    return 1
  fi

  # Wait briefly for socket to appear (max 500ms)
  local attempts=0
  while [[ ! -S "$SOCKET_PATH" ]] && [[ $attempts -lt 10 ]]; do
    sleep 0.05
    ((attempts++))
  done

  if [[ -S "$SOCKET_PATH" ]]; then
    log_info "Daemon started for project $DAEMON_ID (fast hooks enabled)"
    return 0
  else
    log_warn "Daemon failed to start - using direct execution (slower). See $LOG_PATH"
    return 1
  fi
}

# Stop daemon for this project
stop_daemon() {
  if [[ -f "$PID_PATH" ]]; then
    local pid=$(cat "$PID_PATH" 2>/dev/null)
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_PATH" "$SOCKET_PATH" 2>/dev/null
    log_info "Daemon stopped for project $DAEMON_ID"
  fi
}

# Send request to daemon, return response
call_daemon() {
  local hook="$1"
  local input="$2"
  local request=$(printf '{"hook":"%s","request_id":"%s","input":%s}' "$hook" "$REQUEST_ID" "$input")

  # Use nc for fast Unix socket communication (~0ms vs ~40ms node startup)
  # Daemon closes connection after responding so nc reads the full response
  local response
  # 25s timeout: safe because daemon enforces per-hook limits (9s default, 20s security)
  response=$(echo "$request" | nc -w 25 -U "$SOCKET_PATH" 2>>"$LOG_PATH")
  local nc_exit=$?

  if [[ $nc_exit -ne 0 ]]; then
    log_warn "Daemon request failed (nc exit $nc_exit, request $REQUEST_ID). See $LOG_PATH"
    return 1
  fi

  if [[ -n "$response" ]]; then
    echo "$response"
    return 0
  else
    log_warn "Daemon returned empty response (request $REQUEST_ID). See $LOG_PATH"
    return 1
  fi
}

# Validate hook type
if [[ -z "$HOOK_TYPE" ]]; then
  echo '{"error":"Usage: marvel-hook.sh <hook-type>"}'
  exit 1
fi

# Main logic based on hook type
case "$HOOK_TYPE" in
  session-start)
    # Migration: clean legacy temp dirs and files from prior naming schemes
    [[ -d "/tmp/marvel-hooks" ]] && rm -rf "/tmp/marvel-hooks" 2>/dev/null
    # Legacy UID-scoped dirs: /tmp/marvel-hooks-{uid}/ and $TMPDIR/marvel-hooks-{uid}/
    for legacy_dir in "/tmp/marvel-hooks-$(id -u)" "${TMPDIR:-/tmp}/marvel-hooks-$(id -u)"; do
      if [[ -d "$legacy_dir" ]]; then
        rm -rf "$legacy_dir" 2>/dev/null
      fi
    done

    # Reap stale daemon files for dead projects (PID not alive or empty)
    for pid_file in "$MARVEL_TEMP_DIR"/p-project-*.pid; do
      [[ -f "$pid_file" ]] || continue
      stale_pid=$(cat "$pid_file" 2>/dev/null)
      if [[ -z "$stale_pid" ]] || ! kill -0 "$stale_pid" 2>/dev/null; then
        sock_file="${pid_file%.pid}.sock"
        log_file="${pid_file%.pid}.log"
        rm -f "$pid_file" "$sock_file" "$log_file" 2>/dev/null
      fi
    done

    # Start daemon (or reuse existing one), then run the hook
    start_daemon
    if daemon_running; then
      response=$(call_daemon "$HOOK_TYPE" "$INPUT")
      if [[ $? -ne 0 ]] || [[ -z "$response" ]]; then
        log_warn "Daemon request failed on session-start"
        echo '{"error":"MARVEL daemon failed on session-start. Check log: '"$LOG_PATH"'"}'
        exit 1
      fi
      echo "$response"
    else
      log_warn "MARVEL daemon failed to start on session-start"
      echo '{"error":"MARVEL daemon failed to start. Check log: '"$LOG_PATH"'"}'
      exit 1
    fi
    ;;

  session-end)
    # Run hook via daemon if available. Session-end is best-effort —
    # the daemon self-terminates when the last session leaves.
    if daemon_running; then
      call_daemon "$HOOK_TYPE" "$INPUT" || echo '{}'
    else
      echo '{}'
    fi
    ;;

  *)
    # Normal hooks — daemon is required. If not running, attempt to start it.
    # If daemon is unavailable after start attempt, return an error so Claude
    # surfaces the problem to the user instead of silently pressing on.
    if ! daemon_running; then
      log_warn "Daemon not running for $HOOK_TYPE — attempting to start"
      start_daemon
    fi

    if daemon_running; then
      response=$(call_daemon "$HOOK_TYPE" "$INPUT")
      if [[ $? -ne 0 ]] || [[ -z "$response" ]]; then
        log_warn "Daemon request failed for $HOOK_TYPE"
        echo '{"error":"MARVEL daemon request failed. Check log: '"$LOG_PATH"'"}'
        exit 1
      fi
      echo "$response"
    else
      log_warn "MARVEL daemon unavailable for $HOOK_TYPE — signaling error"
      echo '{"error":"MARVEL daemon is not running and failed to start. Check log: '"$LOG_PATH"'"}'
      exit 1
    fi
    ;;
esac
