## MARVEL

MARVEL hooks auto-inject relevant pack lessons before file operations.

- **Packs:** `marvel/packs/<name>/guardrails.md`
- **Specs:** `marvel/specs/active/`
- **Rebuild hooks:** `cd marvel/tools/hooks && pnpm build`
- **MARVEL docs:** `marvel/README.md`, `marvel/TERMINOLOGY.md`

## Verification

After code changes, always run:
- `pnpm typecheck`

Before merging, also run:
- `pnpm test:run`
