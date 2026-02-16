# MARVEL

**Model-Augmented Reasoning, Verification, Execution, and Learning**

MARVEL is a hook-based knowledge and safety system for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It intercepts tool calls during agentic coding sessions, injects contextually relevant guidance from curated knowledge packs, evaluates bash commands through a multi-layer security gate, and learns from your corrections over time.

MARVEL ships with four starter packs (code-quality, git-workflow, testing, security) and a daemon architecture that keeps hook latency under 10ms.

## Philosophy

Agentic coding tools are powerful but unpredictable. They make mistakes, forget conventions, and occasionally run dangerous commands. The standard response is to restrict the agent. MARVEL takes a different approach: **teach the agent instead of constraining it**.

MARVEL works by observing what Claude does, injecting relevant knowledge before each operation, and learning from corrections when Claude gets things wrong. Over time, the system accumulates project-specific knowledge that makes Claude more effective — not less capable.

The key design principles:

- **Non-blocking by default.** Hooks return in under 10ms. Claude never waits for MARVEL.
- **Inject, don't intercept.** Most hooks add context to Claude's reasoning rather than blocking actions. The security gate is the exception.
- **Learn from corrections.** When you correct Claude, MARVEL captures the correction and can promote it into a permanent lesson.
- **Packs are portable.** Knowledge packs are self-contained directories. Share them across projects or teams.

## Core Concepts

**Packs** are self-contained units of knowledge covering a specific domain (e.g., code quality, security, testing). Each pack contains metadata (`pack.json`), human-written rules (`guardrails.md`), and machine-learned lessons (`lessons.jsonl`).

**Hooks** are Claude Code extension points that fire at specific moments during a session — before a file edit, after a bash command, when the user submits a prompt. MARVEL registers handlers for all available hooks.

**Injection** is the process of inserting relevant pack content into Claude's context during a `PreToolUse` hook. A relevance scoring algorithm determines which packs match the current file operation. Maximum of 4 packs per injection, 10 lessons total.

**Security Gate** is a 4-layer evaluation system for bash commands: allowlist (known-safe, instant), denylist (known-dangerous, blocked), learned rules (previously approved), and LLM evaluator (analyzes unknown commands).

**Daemon** is a long-running Node.js process that keeps packs loaded in memory and handles hook requests over a Unix socket. One daemon per project directory, shared across all sessions.

See [docs/terminology.md](docs/terminology.md) for the full glossary.

## Requirements

- **Node.js >= 24** (required for ES2024 target and native module features)
- **pnpm >= 10** (workspace manager)
- **Claude Code** (the CLI tool from Anthropic)

## Quick Start

Install MARVEL into an existing project:

```bash
git clone https://github.com/systemtwosecurity/marvel.git
cd marvel
bin/marvel-init /path/to/your-project
```

This will:
1. Copy the `marvel/` directory into your project
2. Register hook handlers in `.claude/settings.json`
3. Copy slash commands, skills, and agent definitions into `.claude/`
4. Append the MARVEL section to your project's `CLAUDE.md`
5. Add gitignore entries for runtime data
6. Build the hook daemon

Start a Claude Code session in your project. You should see:

```
MARVEL session started: run_20260216_103000
Active packs:
- code-quality
- git-workflow
- security
- testing
```

## Example Workflow

**1. Claude edits a TypeScript file.**
The `PreToolUse` hook fires. MARVEL scores all loaded packs against the file path and extension. The `code-quality` pack matches (`.ts` extension), so its guardrails and top lessons are injected into Claude's context as `additionalContext`.

**2. Claude runs a bash command.**
The `PermissionRequest` hook fires. MARVEL checks the command against the allowlist (`git status` — allowed), denylist (`rm -rf /` — blocked), learned rules, and finally the LLM evaluator for unknown commands.

**3. You correct Claude.**
"Don't use `any` types, use `unknown` instead." The `UserPromptSubmit` hook captures this as a correction in the `code-quality` category.

**4. You reflect on the session.**
Run `/marvel-reflect`. MARVEL reviews captured corrections and proposes promoting them into permanent lessons. Approved lessons are appended to the relevant pack's `lessons.jsonl`.

**5. Next session, Claude remembers.**
When Claude touches a TypeScript file, the promoted lesson is injected: "Use `unknown` instead of `any` for untyped values."

## Project Structure

```
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CLAUDE.md                    # Project instructions for Claude Code
├── docs/                        # Documentation
│   ├── architecture.md          # System architecture and internals
│   ├── packs.md                 # Creating and managing packs
│   ├── security.md              # Security gate configuration
│   └── terminology.md           # Glossary
├── bin/
│   ├── marvel-init              # Install MARVEL into a project
│   └── marvel-daemon            # Manage running daemons
├── marvel/
│   ├── packs/                   # Knowledge packs
│   ├── security/                # Security gate configuration
│   ├── specs/                   # Feature specifications
│   ├── runs/                    # Session trace data (gitignored)
│   └── tools/hooks/             # Hook daemon (TypeScript)
└── .claude/
    ├── settings.json            # Hook registrations
    ├── commands/                 # Slash commands
    ├── skills/                  # Skills
    └── agents/                  # Agent definitions
```

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/marvel-status` | View current session status |
| `/marvel-verify` | Run full verification (typecheck, test, build) |
| `/marvel-reflect` | Review session corrections and promote lessons |
| `/marvel-teach` | Add a lesson directly to a pack |
| `/marvel-lessons` | Browse lessons across packs |
| `/marvel-packs` | View loaded pack configuration |
| `/marvel-plan` | Enter structured planning mode |
| `/marvel-build` | Execute a plan with incremental verification |
| `/marvel-fixbug` | Structured bug fix workflow |
| `/marvel-investigate` | Read-only investigation mode |
| `/marvel-commit` | Conventional commit with pre-commit checks |
| `/marvel-refresh` | Force-reload packs |
| `/marvel-why` | Explain last injection reasoning |

## Daemon Management

```bash
bin/marvel-daemon list              # List all running daemons
bin/marvel-daemon status [path]     # Show daemon status for a project
bin/marvel-daemon log [path]        # Tail daemon log
bin/marvel-daemon restart [path]    # Kill daemon (auto-restarts on next hook)
bin/marvel-daemon cleanup           # Remove stale PID/socket files
```

## Documentation

- [Architecture](docs/architecture.md) — System internals, hook lifecycle, daemon design
- [Packs](docs/packs.md) — Creating packs, relevance scoring, lesson lifecycle
- [Security](docs/security.md) — Security gate layers, customizing rules
- [Terminology](docs/terminology.md) — Glossary of MARVEL-specific terms

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting changes, creating packs, and reporting issues.

## License

Apache License 2.0. See [LICENSE](LICENSE) for the full text.
