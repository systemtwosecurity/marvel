# MARVEL Security Gate

The security gate evaluates every bash command Claude executes through a 4-layer decision system. Its goal is to auto-approve safe commands (keeping Claude fast), block dangerous commands (keeping your system safe), and learn from your decisions over time.

## Architecture

Commands flow through four layers in order. The first matching layer determines the outcome.

```
Command
  |
  v
[Layer 1: Allowlist] -- match --> ALLOW (no prompt)
  |
  v
[Layer 2: Denylist]  -- match --> DENY (blocked)
  |
  v
[Layer 3: Learned]   -- match --> ALLOW (previously approved)
  |
  v
[Layer 4: LLM Agent] -- evaluate --> ALLOW / DENY / ASK
```

### Layer 1: Allowlist (`allowlist.json`)

Known-safe command patterns that are always permitted without user interaction. This is the fast path -- most common developer commands (git, ls, pnpm, etc.) hit the allowlist and execute immediately.

Rules use three match types:
- **prefix** -- Command starts with the pattern (e.g., `"git status"`)
- **contains** -- Command contains the pattern anywhere
- **regex** -- Command matches a regular expression

### Layer 2: Denylist (`denylist.json`)

Known-dangerous command patterns that are always blocked. The denylist is checked before learned rules to prevent dangerous commands from being allowed by overly broad user-approved patterns.

Examples of denied patterns:
- `rm -rf /` and variants targeting system directories
- `curl | bash` and other remote code execution patterns
- `chmod 777` and insecure permission changes
- `sudo rm -rf` and elevated destructive operations
- `mkfs`, `fdisk`, `shutdown`, and other system administration commands

### Layer 3: Learned Rules (`learned.jsonl`)

When the LLM evaluator returns "ask" and the user approves a command, MARVEL extracts a safe pattern and saves it to `learned.jsonl`. Future commands matching that pattern are auto-approved.

Learned rules are:
- Scoped to specific command patterns (not overly broad)
- Checked against the denylist before being applied (denylist always wins)
- Persisted across sessions but gitignored (local to each developer)
- Promotable to the allowlist via the `/marvel-evolve` skill

### Layer 4: LLM Agent Evaluator

Commands that do not match any list are evaluated by a lightweight LLM agent. The evaluator:

1. Analyzes the command in the context of the project
2. Returns a decision: `allow`, `deny`, or `ask`
3. Provides a reason explaining the decision
4. May suggest new allowlist or denylist rules

Configuration in `config.json`:
```json
{
  "marvel_evaluation": {
    "agent_evaluator": {
      "enabled": true,
      "model": "haiku",
      "evaluation_timeout_ms": 30000,
      "idle_timeout_ms": 3600000,
      "max_cumulative_cost_usd": 0.50,
      "confidence_auto_threshold": 0.85
    }
  }
}
```

- **model** -- Which model to use for evaluations (haiku for speed)
- **evaluation_timeout_ms** -- Maximum time for a single evaluation
- **idle_timeout_ms** -- How long the evaluator stays warm after the last call
- **max_cumulative_cost_usd** -- Cost cap per session to prevent runaway spending
- **confidence_auto_threshold** -- Minimum confidence to auto-approve without asking the user

## Customizing Rules

### Adding Allowlist Rules

Add entries to `allowlist.json`:

```json
{
  "id": "allow-my-tool",
  "type": "prefix",
  "pattern": "my-tool ",
  "reason": "Project-specific build tool"
}
```

### Adding Denylist Rules

Add entries to `denylist.json`:

```json
{
  "id": "deny-prod-deploy",
  "type": "contains",
  "pattern": "--production",
  "reason": "Production deployments must go through CI"
}
```

### Rule Structure

Every rule has four fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `allow-git-status`) |
| `type` | `"prefix"` \| `"contains"` \| `"regex"` | How the pattern is matched |
| `pattern` | string | The pattern to match against the command |
| `reason` | string | Human-readable explanation of why this rule exists |

## Metrics

The security gate tracks per-session metrics in the run directory (`security-metrics.json`):

- Decisions by source (allowlist, denylist, learned, LLM, error)
- Decisions by outcome (allow, deny, ask)
- Auto-accept rate (allowlist + learned / total)
- Total evaluations

Use `/marvel-health` to review security gate statistics across sessions.

## Files

| File | Committed | Description |
|------|-----------|-------------|
| `config.json` | Yes | Agent evaluator configuration |
| `allowlist.json` | Yes | Known-safe command patterns |
| `denylist.json` | Yes | Known-dangerous command patterns |
| `learned.jsonl` | No | User-approved patterns (gitignored) |
| `suggestions.jsonl` | No | LLM-suggested rules (gitignored) |
| `decisions.jsonl` | No | Decision audit log (gitignored) |
| `agent-evaluations.jsonl` | No | LLM evaluation traces (gitignored) |
