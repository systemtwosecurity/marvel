# Contributing to MARVEL

Thank you for your interest in contributing to MARVEL. This document covers the process for submitting changes.

## Getting Started

1. Fork the repository and clone your fork
2. Install dependencies: `pnpm install`
3. Build: `pnpm build`
4. Run tests: `pnpm test:run`

The build pipeline runs tests, type checks, compiles TypeScript, bundles the daemon, and validates the settings schema. All steps must pass.

## Development

The hook daemon source lives in `marvel/tools/hooks/src/`. After making changes:

```bash
pnpm typecheck          # Type check without emitting
pnpm test:run           # Run tests once
pnpm build              # Full build (test + typecheck + compile + bundle + validate)
```

For iterative development, use `pnpm test` (vitest watch mode) and `pnpm dev` (tsc watch mode).

## Submitting Changes

1. Create a branch from `main`
2. Make your changes
3. Ensure `pnpm build` passes
4. Write a clear commit message describing **why**, not just **what**
5. Open a pull request against `main`

### Commit Messages

Use conventional commit style:

```
feat: add support for pack dependencies
fix: prevent duplicate lesson injection after compaction
docs: clarify relevance scoring thresholds
```

## Creating Packs

Packs are the primary extension point. To create a new pack:

1. Create a directory under `marvel/packs/<pack-name>/`
2. Add `pack.json` with required fields (`name`, `version`, `owner`)
3. Add `guardrails.md` with clear, actionable rules
4. Add an empty `lessons.jsonl`

See [docs/packs.md](docs/packs.md) for the full pack specification.

### Pack Guidelines

- **Be specific.** Vague rules ("write good code") are not useful. Concrete instructions ("use `unknown` instead of `any` for untyped values") are.
- **Scope narrowly.** A pack should cover one domain. Don't combine unrelated concerns.
- **Test relevance.** Verify your pack's `applies_to.extensions` and `sensitive_paths` trigger on the right files.

## Modifying the Security Gate

Changes to `marvel/security/allowlist.json` and `marvel/security/denylist.json` affect command evaluation for all users. Be conservative:

- Allowlist additions should be clearly safe in all contexts
- Denylist additions should be dangerous in nearly all contexts
- When in doubt, let the LLM evaluator handle it

## Code Style

- TypeScript with strict mode enabled
- ES modules (`import`/`export`, not `require`)
- No runtime dependencies except `ws` (WebSocket library)
- Prefer explicit types over inference for public APIs
- Tests use vitest

## Reporting Issues

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Daemon log output if relevant (`bin/marvel-daemon log`)

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
