# Security Gate

The security gate evaluates every bash command Claude executes through a 4-layer decision system. It auto-approves safe commands, blocks dangerous ones, and learns from your decisions over time.

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

The denylist is checked before learned rules. This prevents a broad learned pattern (e.g., `rm *`) from overriding a specific deny rule (e.g., `rm -rf /`).

## Layer 1: Allowlist

File: `marvel/security/allowlist.json`

Known-safe command patterns that pass immediately. This is the fast path — most developer commands (`git status`, `ls`, `pnpm build`) hit the allowlist and execute without delay.

Rules use three match types:
- **prefix** — Command starts with the pattern
- **contains** — Command contains the pattern anywhere
- **regex** — Command matches a regular expression

## Layer 2: Denylist

File: `marvel/security/denylist.json`

Known-dangerous command patterns that are always blocked:
- `rm -rf /` and variants targeting system directories
- `curl | bash` and remote code execution patterns
- `chmod 777` and insecure permission changes
- `sudo rm -rf` and elevated destructive operations
- `mkfs`, `fdisk`, `shutdown`, and system administration commands

## Layer 3: Learned Rules

File: `marvel/security/learned.jsonl` (gitignored)

When the LLM evaluator returns "ask" and the user approves a command, MARVEL extracts a safe pattern and saves it. Future commands matching that pattern are auto-approved.

Learned rules are:
- Scoped to specific patterns (not overly broad)
- Checked against the denylist before being applied
- Local to each developer (gitignored)
- Promotable to the allowlist via `/marvel-evolve`

## Layer 4: LLM Agent Evaluator

Commands that don't match any list are evaluated by a lightweight LLM agent (Claude Haiku by default).

The evaluator:
1. Analyzes the command in the context of the project
2. Returns a decision: `allow`, `deny`, or `ask`
3. Provides a reason explaining the decision
4. May suggest new allowlist or denylist rules

### Configuration

File: `marvel/security/config.json`

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

| Setting | Description |
|---------|-------------|
| `model` | Model for evaluations. Haiku is recommended for speed. |
| `evaluation_timeout_ms` | Maximum time for a single evaluation (30s default). |
| `idle_timeout_ms` | How long the evaluator stays warm after the last call (1 hour). |
| `max_cumulative_cost_usd` | Cost cap per session to prevent runaway spending ($0.50). |
| `confidence_auto_threshold` | Minimum confidence to auto-approve without asking (0.85). |

### Fail-Safe Behavior

If the LLM evaluation encounters an error (timeout, cost cap exceeded, etc.), the gate returns `ask` — prompting the user rather than silently allowing or blocking.

## Customizing Rules

### Adding Allowlist Rules

```json
{
  "id": "allow-my-tool",
  "type": "prefix",
  "pattern": "my-tool ",
  "reason": "Project-specific build tool"
}
```

### Adding Denylist Rules

```json
{
  "id": "deny-prod-deploy",
  "type": "contains",
  "pattern": "--production",
  "reason": "Production deployments must go through CI"
}
```

### Rule Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `allow-git-status`) |
| `type` | `"prefix"` / `"contains"` / `"regex"` | How the pattern is matched |
| `pattern` | string | The pattern to match against the command |
| `reason` | string | Why this rule exists |

## Metrics

The security gate tracks per-session metrics in `security-metrics.json`:

- Decisions by source (allowlist, denylist, learned, LLM, error)
- Decisions by outcome (allow, deny, ask)
- Auto-accept rate
- Total evaluations

Use `/marvel-health` to review statistics across sessions.

## Files

| File | Committed | Description |
|------|-----------|-------------|
| `config.json` | Yes | Evaluator configuration |
| `allowlist.json` | Yes | Known-safe patterns |
| `denylist.json` | Yes | Known-dangerous patterns |
| `learned.jsonl` | No | User-approved patterns (gitignored) |
| `suggestions.jsonl` | No | LLM-suggested rules (gitignored) |
| `decisions.jsonl` | No | Decision audit log (gitignored) |
| `agent-evaluations.jsonl` | No | LLM evaluation traces (gitignored) |
