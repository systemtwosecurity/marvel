#!/bin/bash
# Copyright 2026 Detections AI
# SPDX-License-Identifier: Apache-2.0
#
# MARVEL Installation Validator
#
# Validates that a MARVEL installation is complete and correctly configured.
#
# Usage: validate-installation.sh [target-directory]
#
# If target-directory is not specified, validates the current directory.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; WARN=$((WARN + 1)); }
info() { echo -e "${BLUE}[validate]${NC} $1"; }

# Resolve target directory
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "Cannot resolve directory: ${1:-.}" >&2; exit 1; }

echo ""
info "Validating MARVEL installation in: $TARGET"
echo ""

# ─── 1. Core directory structure ──────────────────────────────────────

info "Checking directory structure..."

for dir in \
  "marvel" \
  "marvel/packs" \
  "marvel/security" \
  "marvel/specs" \
  "marvel/specs/active" \
  "marvel/specs/backlog" \
  "marvel/specs/completed" \
  "marvel/specs/templates" \
  "marvel/runs" \
  "marvel/tools" \
  "marvel/tools/hooks" \
  "marvel/tools/hooks/src" \
  "marvel/tools/hooks/scripts" \
  ".claude"; do
  if [[ -d "$TARGET/$dir" ]]; then
    pass "$dir/"
  else
    fail "$dir/ -- directory missing"
  fi
done

# ─── 2. Hook registrations in settings.json ──────────────────────────

info "Checking .claude/settings.json..."

if [[ -f "$TARGET/.claude/settings.json" ]]; then
  pass ".claude/settings.json exists"

  # Validate JSON syntax
  if command -v jq >/dev/null 2>&1; then
    if jq . "$TARGET/.claude/settings.json" >/dev/null 2>&1; then
      pass ".claude/settings.json is valid JSON"
    else
      fail ".claude/settings.json has invalid JSON syntax"
    fi
  else
    warn "jq not installed -- cannot validate JSON syntax"
  fi

  # Check for hook registrations
  EXPECTED_HOOKS=(
    "SessionStart"
    "PreToolUse"
    "UserPromptSubmit"
    "PostToolUse"
    "PostToolUseFailure"
    "PermissionRequest"
    "PreCompact"
    "Stop"
    "SubagentStart"
    "SubagentStop"
    "Notification"
    "TeammateIdle"
    "TaskCompleted"
    "SessionEnd"
  )

  for hook in "${EXPECTED_HOOKS[@]}"; do
    if grep -q "\"$hook\"" "$TARGET/.claude/settings.json" 2>/dev/null; then
      pass "Hook registered: $hook"
    else
      fail "Hook not registered: $hook"
    fi
  done

  # Check that hooks reference marvel-hook.sh
  if grep -q "marvel-hook.sh" "$TARGET/.claude/settings.json" 2>/dev/null; then
    pass "settings.json references marvel-hook.sh"
  else
    fail "settings.json does not reference marvel-hook.sh"
  fi
else
  fail ".claude/settings.json -- file missing"
fi

# ─── 3. Hook daemon build artifact ───────────────────────────────────

info "Checking hook daemon..."

if [[ -f "$TARGET/marvel/tools/hooks/dist/daemon.bundle.js" ]]; then
  pass "daemon.bundle.js exists"

  # Check it's a reasonable size (> 1KB)
  SIZE=$(wc -c < "$TARGET/marvel/tools/hooks/dist/daemon.bundle.js" | tr -d ' ')
  if [[ "$SIZE" -gt 1024 ]]; then
    pass "daemon.bundle.js is $SIZE bytes (looks valid)"
  else
    warn "daemon.bundle.js is only $SIZE bytes (may be incomplete)"
  fi
else
  fail "daemon.bundle.js -- not built. Run: cd marvel/tools/hooks && pnpm build"
fi

# ─── 4. Starter packs ────────────────────────────────────────────────

info "Checking starter packs..."

STARTER_PACKS=("code-quality" "git-workflow" "testing" "security")

for pack in "${STARTER_PACKS[@]}"; do
  pack_dir="$TARGET/marvel/packs/$pack"

  if [[ -d "$pack_dir" ]]; then
    pass "Pack directory: $pack/"
  else
    fail "Pack directory missing: $pack/"
    continue
  fi

  # Validate pack.json exists and is valid JSON
  if [[ -f "$pack_dir/pack.json" ]]; then
    pass "$pack/pack.json exists"

    if command -v jq >/dev/null 2>&1; then
      # Validate required fields
      NAME=$(jq -r '.name // empty' "$pack_dir/pack.json" 2>/dev/null)
      VERSION=$(jq -r '.version // empty' "$pack_dir/pack.json" 2>/dev/null)
      OWNER=$(jq -r '.owner // empty' "$pack_dir/pack.json" 2>/dev/null)

      if [[ -n "$NAME" && -n "$VERSION" && -n "$OWNER" ]]; then
        pass "$pack/pack.json has required fields (name=$NAME, version=$VERSION)"
      else
        fail "$pack/pack.json missing required fields (name, version, or owner)"
      fi

      # Validate name matches directory
      if [[ "$NAME" == "$pack" ]]; then
        pass "$pack/pack.json name matches directory"
      else
        fail "$pack/pack.json name '$NAME' does not match directory '$pack'"
      fi
    fi
  else
    fail "$pack/pack.json -- file missing"
  fi

  # Check guardrails.md
  if [[ -f "$pack_dir/guardrails.md" ]]; then
    pass "$pack/guardrails.md exists"
  else
    fail "$pack/guardrails.md -- file missing"
  fi

  # Check lessons.jsonl (can be empty but should exist)
  if [[ -f "$pack_dir/lessons.jsonl" ]]; then
    pass "$pack/lessons.jsonl exists"
  else
    warn "$pack/lessons.jsonl -- file missing (not required but recommended)"
  fi
done

# ─── 5. marvel-hook.sh ───────────────────────────────────────────────

info "Checking hook entry point..."

HOOK_SCRIPT="$TARGET/marvel/tools/hooks/scripts/marvel-hook.sh"
if [[ -f "$HOOK_SCRIPT" ]]; then
  pass "marvel-hook.sh exists"

  if [[ -x "$HOOK_SCRIPT" ]]; then
    pass "marvel-hook.sh is executable"
  else
    fail "marvel-hook.sh is not executable"
  fi
else
  fail "marvel-hook.sh -- file missing"
fi

# ─── 6. Slash commands ───────────────────────────────────────────────

info "Checking slash commands..."

COMMAND_DIR="$TARGET/.claude/commands"
if [[ -d "$COMMAND_DIR" ]]; then
  COMMAND_COUNT=$(find "$COMMAND_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$COMMAND_COUNT" -ge 13 ]]; then
    pass "Found $COMMAND_COUNT slash commands (>= 13 expected)"
  elif [[ "$COMMAND_COUNT" -gt 0 ]]; then
    warn "Found $COMMAND_COUNT slash commands (13 expected)"
  else
    warn "No slash commands found in .claude/commands/"
  fi
else
  warn ".claude/commands/ directory missing"
fi

# ─── 7. Skills ───────────────────────────────────────────────────────

info "Checking skills..."

SKILL_DIR="$TARGET/.claude/skills"
if [[ -d "$SKILL_DIR" ]]; then
  SKILL_COUNT=$(find "$SKILL_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$SKILL_COUNT" -ge 3 ]]; then
    pass "Found $SKILL_COUNT skills (>= 3 expected)"
  elif [[ "$SKILL_COUNT" -gt 0 ]]; then
    warn "Found $SKILL_COUNT skills (3 expected)"
  else
    warn "No skills found in .claude/skills/"
  fi

  # Check for expected skills
  for skill in marvel-reflect marvel-evolve marvel-health; do
    if [[ -d "$SKILL_DIR/$skill" ]]; then
      pass "Skill: $skill"
    else
      warn "Skill missing: $skill"
    fi
  done
else
  warn ".claude/skills/ directory missing"
fi

# ─── 8. Agents ───────────────────────────────────────────────────────

info "Checking agents..."

AGENT_DIR="$TARGET/.claude/agents"
if [[ -d "$AGENT_DIR" ]]; then
  AGENT_COUNT=$(find "$AGENT_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$AGENT_COUNT" -ge 4 ]]; then
    pass "Found $AGENT_COUNT agents (>= 4 expected)"
  elif [[ "$AGENT_COUNT" -gt 0 ]]; then
    warn "Found $AGENT_COUNT agents (4+ expected)"
  else
    warn "No agents found in .claude/agents/"
  fi
else
  warn ".claude/agents/ directory missing"
fi

# ─── 9. Security configuration ───────────────────────────────────────

info "Checking security configuration..."

for file in config.json allowlist.json denylist.json; do
  if [[ -f "$TARGET/marvel/security/$file" ]]; then
    pass "security/$file exists"
    if command -v jq >/dev/null 2>&1; then
      if jq . "$TARGET/marvel/security/$file" >/dev/null 2>&1; then
        pass "security/$file is valid JSON"
      else
        fail "security/$file has invalid JSON"
      fi
    fi
  else
    fail "security/$file -- file missing"
  fi
done

# ─── 10. Gitignore entries ───────────────────────────────────────────

info "Checking .gitignore..."

if [[ -f "$TARGET/.gitignore" ]]; then
  GITIGNORE_ENTRIES=("marvel/runs/" "marvel/security/learned.jsonl" "marvel/tools/hooks/dist/")
  for entry in "${GITIGNORE_ENTRIES[@]}"; do
    if grep -qF "$entry" "$TARGET/.gitignore" 2>/dev/null; then
      pass ".gitignore has: $entry"
    else
      warn ".gitignore missing entry: $entry"
    fi
  done
else
  warn ".gitignore not found"
fi

# ─── Summary ─────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}PASS: $PASS${NC}  ${RED}FAIL: $FAIL${NC}  ${YELLOW}WARN: $WARN${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}Installation is valid.${NC}"
  exit 0
else
  echo -e "${RED}Installation has $FAIL failure(s). Review the output above.${NC}"
  exit 1
fi
