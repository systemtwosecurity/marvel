# /marvel-lessons - Browse Pack Lessons

## Usage

```
/marvel-lessons
/marvel-lessons <pack-name>
```

## Instructions

Browse MARVEL pack lessons. This is a read-only command -- it does not modify any files.

### Without Arguments: List All Packs

Scan `marvel/packs/` and for each pack directory:

1. Read `pack.json` to get the pack name and description.
2. Read `lessons.jsonl` and count the number of lessons.
3. Read `guardrails.md` and note whether it exists.

Present as a summary table:

```
## MARVEL Pack Lessons

| Pack | Description | Lessons | Has Guardrails |
|------|-------------|---------|----------------|
| <name> | <description> | <count> | yes/no |

Total: <N> lessons across <M> packs.
```

### With Pack Name: Browse Specific Pack

When a `<pack-name>` is provided:

1. Verify the pack exists in `marvel/packs/<pack-name>/`.
2. Read `pack.json` and display pack metadata:
   ```
   ## Pack: <name>
   Version: <version>
   Owner: <owner>
   Description: <description>
   Categories: <categories>
   Applies to: <extensions>
   ```

3. Read `lessons.jsonl` and display each lesson:
   ```
   ### Lesson 1: <title>
   - Category: <category>
   - Description: <description>
   - Actionable: <actionable>
   - Added: <timestamp>
   ```

4. If the pack has no lessons, say so:
   ```
   This pack has no lessons yet. Use /marvel-teach <pack-name> to add one.
   ```

### Error Handling

- If no `marvel/packs/` directory exists, inform the user that MARVEL packs are not configured.
- If the specified pack does not exist, list available packs and suggest the closest match.
