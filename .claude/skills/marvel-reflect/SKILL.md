# marvel-reflect

Review and promote MARVEL learnings from recent sessions.

## When to Use

Run this skill after completing a feature or fixing a bug to capture what MARVEL learned during the session. It reads guidance output from recent runs, identifies corrections and insights, groups them by category, and presents them as promotable lessons.

## Workflow

1. **Locate guidance files**: Search for `guidance.jsonl` files in recent session directories under the MARVEL tools output path.
2. **Parse entries**: Read each JSONL file line by line, parsing JSON entries. Each entry contains a lesson with fields like `packId`, `lessonText`, `correctionType`, and `timestamp`.
3. **Identify corrections**: Filter for entries where a correction was applied — these represent moments where MARVEL intervened to fix agent behavior.
4. **Group by category**: Organize corrections by pack ID and correction type (e.g., naming convention, architecture pattern, anti-pattern).
5. **Present summary**: Display grouped corrections with counts and representative examples. Ask the user which lessons to promote.
6. **Promote selected lessons**: For each approved lesson, run:
   ```bash
   node marvel/tools/hooks/dist/cli.bundle.js promote --pack <packId> --lesson "<lessonText>"
   ```
   If the CLI bundle is not built, instruct the user to run `cd marvel/tools/hooks && pnpm build` first.

## Output Format

```
## Session Learnings Summary

### Pack: <pack-name> (N corrections)
- [correction-type] <lesson summary> (seen N times)
- [correction-type] <lesson summary> (seen N times)

### Pack: <pack-name> (N corrections)
- ...

## Recommended Promotions
1. <lesson> — Reason: high frequency / high impact
2. <lesson> — Reason: ...

Promote lessons? [select by number or 'all' / 'none']
```

## Error Handling

- If no guidance files are found, report that no recent session data exists and suggest running a session first.
- If the CLI bundle is missing, provide the rebuild command.
- If a promotion fails, report the error and continue with remaining lessons.
