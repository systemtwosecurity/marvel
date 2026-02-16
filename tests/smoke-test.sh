#!/bin/bash
# Copyright 2026 Detections AI
# SPDX-License-Identifier: Apache-2.0
#
# MARVEL Smoke Test
#
# Performs a basic smoke test of the MARVEL hook daemon:
# 1. Builds hooks if not already built
# 2. Starts the daemon
# 3. Verifies the Unix socket exists
# 4. Stops the daemon
# 5. Reports success or failure
#
# Usage: smoke-test.sh [project-directory]
#
# If project-directory is not specified, uses the parent of this script's location.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[smoke-test]${NC} $1"; }
ok()      { echo -e "${GREEN}[smoke-test]${NC} $1"; }
warn()    { echo -e "${YELLOW}[smoke-test]${NC} $1"; }
fail_msg(){ echo -e "${RED}[smoke-test]${NC} $1"; }

ERRORS=0

# Resolve project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

HOOKS_DIR="$PROJECT_DIR/marvel/tools/hooks"
DAEMON_BUNDLE="$HOOKS_DIR/dist/daemon.bundle.js"

# Derive temp paths (same logic as marvel-hook.sh)
PROJECT_HASH=$(echo -n "$PROJECT_DIR" | shasum -a 256 | cut -c1-12)
DAEMON_ID="project-${PROJECT_HASH}"
MARVEL_TEMP_DIR="${TMPDIR:-/tmp}/mhd-$(id -u)"
SOCKET_PATH="${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.sock"
PID_PATH="${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.pid"
LOG_PATH="${MARVEL_TEMP_DIR}/p-${DAEMON_ID}.log"

info "Project directory: $PROJECT_DIR"
info "Daemon ID: $DAEMON_ID"
info "Socket path: $SOCKET_PATH"
echo ""

# ─── Step 1: Build hooks if needed ───────────────────────────────────

info "Step 1: Checking hook daemon build..."

if [[ -f "$DAEMON_BUNDLE" ]]; then
  ok "daemon.bundle.js already exists"
else
  info "Building hooks..."
  if command -v pnpm >/dev/null 2>&1; then
    (cd "$HOOKS_DIR" && pnpm install --frozen-lockfile 2>/dev/null && pnpm build)
    if [[ -f "$DAEMON_BUNDLE" ]]; then
      ok "Hook daemon built successfully"
    else
      fail_msg "Build completed but daemon.bundle.js not found"
      ERRORS=$((ERRORS + 1))
    fi
  else
    fail_msg "pnpm not found -- cannot build hooks"
    ERRORS=$((ERRORS + 1))
  fi
fi

if [[ $ERRORS -gt 0 ]]; then
  fail_msg "Cannot proceed without built daemon. Exiting."
  exit 1
fi

# ─── Step 2: Start the daemon ────────────────────────────────────────

info "Step 2: Starting daemon..."

# Clean up any existing daemon for this project
if [[ -f "$PID_PATH" ]]; then
  OLD_PID=$(cat "$PID_PATH" 2>/dev/null || true)
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    info "Killing existing daemon (pid=$OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 0.2
  fi
  rm -f "$PID_PATH" "$SOCKET_PATH" 2>/dev/null
fi

# Ensure temp directory exists
mkdir -p "$MARVEL_TEMP_DIR"
chmod 700 "$MARVEL_TEMP_DIR" 2>/dev/null

# Start daemon
MARVEL_SESSION_ID="smoke-test" MARVEL_LOG_PATH="$LOG_PATH" MARVEL_DEBUG=1 \
  node "$DAEMON_BUNDLE" start "$DAEMON_ID" </dev/null >>"$LOG_PATH" 2>&1 &
DAEMON_PID=$!

# Brief pause for startup
sleep 0.1

# Check process is still alive
if kill -0 "$DAEMON_PID" 2>/dev/null; then
  ok "Daemon process started (pid=$DAEMON_PID)"
else
  fail_msg "Daemon process exited immediately"
  if [[ -f "$LOG_PATH" ]]; then
    echo ""
    fail_msg "Last 10 lines of daemon log:"
    tail -10 "$LOG_PATH" 2>/dev/null || true
  fi
  ERRORS=$((ERRORS + 1))
fi

# ─── Step 3: Verify socket ───────────────────────────────────────────

info "Step 3: Verifying Unix socket..."

# Wait for socket to appear (up to 2 seconds)
ATTEMPTS=0
MAX_ATTEMPTS=40
while [[ ! -S "$SOCKET_PATH" ]] && [[ $ATTEMPTS -lt $MAX_ATTEMPTS ]]; do
  sleep 0.05
  ATTEMPTS=$((ATTEMPTS + 1))
done

if [[ -S "$SOCKET_PATH" ]]; then
  ok "Socket created at $SOCKET_PATH (${ATTEMPTS} attempts)"
else
  fail_msg "Socket did not appear after $MAX_ATTEMPTS attempts"
  if [[ -f "$LOG_PATH" ]]; then
    echo ""
    fail_msg "Last 20 lines of daemon log:"
    tail -20 "$LOG_PATH" 2>/dev/null || true
  fi
  ERRORS=$((ERRORS + 1))
fi

# ─── Step 4: Send a test request (optional) ──────────────────────────

if [[ -S "$SOCKET_PATH" ]] && command -v nc >/dev/null 2>&1; then
  info "Step 3b: Sending test request..."

  TEST_INPUT='{"hook":"session-start","request_id":"smoke-test-001","input":{"session_id":"smoke-test"}}'
  RESPONSE=$(echo "$TEST_INPUT" | nc -w 5 -U "$SOCKET_PATH" 2>/dev/null || true)

  if [[ -n "$RESPONSE" ]]; then
    ok "Daemon responded to test request"
    # Check for valid JSON response
    if echo "$RESPONSE" | python3 -m json.tool >/dev/null 2>&1 || echo "$RESPONSE" | jq . >/dev/null 2>&1; then
      ok "Response is valid JSON"
    else
      warn "Response may not be valid JSON: ${RESPONSE:0:100}..."
    fi
  else
    warn "Daemon returned empty response (may be expected for smoke test)"
  fi
fi

# ─── Step 5: Stop the daemon ─────────────────────────────────────────

info "Step 4: Stopping daemon..."

if [[ -n "${DAEMON_PID:-}" ]] && kill -0 "$DAEMON_PID" 2>/dev/null; then
  kill "$DAEMON_PID" 2>/dev/null || true
  sleep 0.2

  if kill -0 "$DAEMON_PID" 2>/dev/null; then
    warn "Daemon did not stop gracefully, sending SIGKILL"
    kill -9 "$DAEMON_PID" 2>/dev/null || true
    sleep 0.1
  fi

  ok "Daemon stopped (pid=$DAEMON_PID)"
else
  info "Daemon already stopped"
fi

# Clean up files
rm -f "$PID_PATH" "$SOCKET_PATH" 2>/dev/null

# Verify socket is gone
if [[ ! -S "$SOCKET_PATH" ]]; then
  ok "Socket cleaned up"
else
  warn "Socket still exists after cleanup"
fi

# ─── Summary ─────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $ERRORS -eq 0 ]]; then
  echo -e "  ${GREEN}SMOKE TEST PASSED${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  ok "MARVEL daemon starts, creates a socket, and stops cleanly."
  exit 0
else
  echo -e "  ${RED}SMOKE TEST FAILED ($ERRORS error(s))${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  fail_msg "Check the daemon log for details: $LOG_PATH"
  exit 1
fi
