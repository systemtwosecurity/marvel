# /marvel-reflect - Review and Promote Session Guidance

## Usage

```
/marvel-reflect
```

## Instructions

Review the current session's captured guidance (corrections and directions) and help the user promote valuable insights into permanent pack lessons.

### 1. Gather Guidance

- Locate the current run directory under `marvel/runs/`.
- Read `guidance.jsonl` from the run directory.
- If no guidance exists, also check `marvel/guidance-archive.jsonl`.
- If no guidance is found anywhere, inform the user:
  ```
  No guidance captured in this session. Guidance is recorded when you provide corrections or directions during development.
  ```

### 2. Filter and Group

- Filter to `correction` and `direction` type entries only.
- Group by `category` (e.g., "code-quality", "testing", "security").
- Within each category, deduplicate by content similarity.
- Sort categories by number of entries (most corrections first).

### 3. Present Candidates

For each category group, present the guidance as a potential lesson:

```
## Category: <category-name> (<count> corrections)

### Candidate 1
**Original correction**: "<user's exact words>"
**Suggested lesson**:
- Title: <imperative rule in under 10 words>
- Description: <why this matters>
- Actionable: <what to do concretely>
**Target pack**: <suggested pack name>

Action: [promote] [edit] [skip]
```

### 4. Process User Decisions

For each candidate, the user can:

- **Promote**: Append the lesson to the target pack's `lessons.jsonl` file. Format the entry as:
  ```json
  {"timestamp":"<now>","category":"<category>","title":"<title>","description":"<desc>","actionable":"<actionable>"}
  ```

- **Edit**: Let the user modify the title, description, actionable text, or target pack before promoting.

- **Skip**: Move to the next candidate without action.

### 5. Summary

After processing all candidates, display a summary:

```
## Reflection Summary
- Reviewed: <N> candidates across <M> categories
- Promoted: <X> lessons
- Skipped: <Y> candidates
- Packs updated: <list of packs that received new lessons>
```

### Notes

- Never promote a lesson that duplicates an existing lesson in the target pack.
- Before promoting, verify the target pack exists in `marvel/packs/`.
- Redact any sensitive information (file paths with credentials, API keys) from lessons before writing.
