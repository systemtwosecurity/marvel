# /marvel-packs - View MARVEL Packs

## Usage

```
/marvel-packs
```

## Instructions

Display the current MARVEL packs configuration by running the CLI query command.

### Execution

Run the following command from the project root:

```bash
node marvel/tools/hooks/dist/cli.bundle.js query packs
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

3. As a fallback, manually compile pack information by reading:
   - Each `marvel/packs/<name>/pack.json` for metadata
   - Each `marvel/packs/<name>/lessons.jsonl` for lesson counts
   - Each `marvel/packs/<name>/guardrails.md` for guardrail presence

   Present the results in a formatted table:
   ```
   ## MARVEL Packs

   | Pack | Version | Categories | Extensions | Lessons |
   |------|---------|------------|------------|---------|
   | <name> | <version> | <categories> | <extensions> | <count> |
   ```

### Output

Display the CLI output directly to the user. Do not modify or reformat the CLI output when available. Present it as-is.
