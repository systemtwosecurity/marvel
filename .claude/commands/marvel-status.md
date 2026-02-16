# /marvel-status - View MARVEL Session Status

## Usage

```
/marvel-status
```

## Instructions

Display the current MARVEL session status by running the CLI query command.

### Execution

Run the following command from the project root:

```bash
node marvel/tools/hooks/dist/cli.bundle.js query status
```

### Fallback

If `cli.bundle.js` does not exist or the command fails:

1. Check if the hooks need to be built:
   ```bash
   ls marvel/tools/hooks/dist/cli.bundle.js
   ```

2. If the file is missing, inform the user:
   ```
   MARVEL CLI not built. Run: cd marvel/tools/hooks && pnpm build
   ```

3. As a fallback, manually compile status by reading:
   - `marvel/runs/` for the current run's `run.json`
   - The MARVEL daemon temp directory for health checks
   - `.claude/settings.json` for configured hooks

### Output

Display the CLI output directly to the user. The output includes:
- Run ID and duration
- Active packs and their injection counts
- Tool call and correction counts
- Daemon health status
- Configured vs. missing hooks

Do not modify or reformat the CLI output. Present it as-is.
