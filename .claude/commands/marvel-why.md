# /marvel-why - Explain Last Injection Reasoning

## Usage

```
/marvel-why
```

## Instructions

Explain why the most recent MARVEL pack injection occurred. This helps the user understand the relevance scoring system and debug unexpected injections.

### 1. Load Last Injection Data

- Find the current run directory under `marvel/runs/`.
- Read `run.json` and extract the `lastInjection` field.
- If no `lastInjection` exists, inform the user:
  ```
  No injections have occurred in this session yet. Injections happen when you read or edit files that match pack relevance criteria.
  ```

### 2. Display Injection Details

Present the injection reasoning:

```
## Last MARVEL Injection

**Triggered by file**: <file path>
**Packs injected**: <list of pack names>
**Lessons injected**: <count> lessons

### Relevance Scores

| Pack | Score | Signals |
|------|-------|---------|
| <pack-name> | <score> | <signal1>, <signal2>, ... |
```

### 3. Explain Signals

For each signal type found, provide a brief explanation:

- **extension_match**: The file extension matched the pack's `applies_to.extensions` list.
- **code_path_match**: The file path matched one of the pack's `references.code_paths`.
- **sensitive_path**: The file matched a `sensitive_paths` glob pattern, indicating a high-impact file.
- **recent_corrections**: The user recently corrected something in this pack's category, boosting its relevance.
- **category_match**: Recent guidance matched one of the pack's categories.
- **path_keyword**: The file path contained a keyword (e.g., "test", "auth") that maps to the pack's categories.

### 4. Context

If the user asks follow-up questions about why a specific pack was or was not included:

- Read the pack's `pack.json` to show its configuration.
- Calculate what the relevance score would be for the file in question.
- Explain the minimum score thresholds:
  - Packs with strong signals (code path, sensitive path, or recent correction): minimum score of 10.
  - Packs with only weak signals (extension match only): minimum score of 20.
  - Maximum 4 packs injected per file operation.
