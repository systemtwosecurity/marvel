# /marvel-verify - Run MARVEL Verification

## Usage

```
/marvel-verify
/marvel-verify --fix
```

## Instructions

Run the full MARVEL verification pipeline. Execute each verification target sequentially, stopping on first failure unless `--fix` is provided.

### Verification Targets

Run these commands in order:

1. **Lint**: `pnpm lint`
2. **Typecheck**: `pnpm typecheck`
3. **Build**: `pnpm build`
4. **Tests**: `pnpm test:run`

> **Note**: These are the default commands. If the project uses different verification commands (configured in `package.json` scripts), use those instead.

### Execution

For each target:

1. Announce which target is running:
   ```
   Running verification [1/4]: lint...
   ```

2. Execute the command and capture output.

3. Report the result:
   ```
   lint: PASS (Xs)
   ```
   or
   ```
   lint: FAIL
   <relevant error output>
   ```

### Failure Handling

**Without `--fix`:**
- Stop at the first failure.
- Display the full error output.
- Analyze the root cause and explain what went wrong.
- Propose specific fixes but do NOT apply them.

**With `--fix`:**
- On failure, analyze the root cause.
- Apply the fix automatically.
- Re-run the failed verification target.
- If the fix succeeds, continue to the next target.
- If the fix fails after 3 attempts, stop and report.

### Post-Verification Reflection

After all targets pass (or after failure), generate a reflection:

```
## Verification Summary

| Target    | Status | Duration |
|-----------|--------|----------|
| lint      | PASS   | Xs       |
| typecheck | PASS   | Xs       |
| build     | PASS   | Xs       |
| tests     | PASS   | Xs       |

### Issues Found
- <any issues that were encountered and fixed>

### Observations
- <anything notable about the verification results>
```

### Session State

Successful verification runs update the MARVEL session state. Each passing target is tracked so that `/marvel-commit` knows whether pre-commit requirements are met.
