# marvel-evolve

Graduate high-utility lessons into guardrails and prune stale lessons.

## When to Use

Run this skill periodically to maintain lesson quality. It analyzes lesson utility scores, identifies candidates for promotion into `guardrails.md` files or pruning from the lesson pool, and assists with the changes interactively.

## Workflow

1. **Scan lesson files**: Read all `lessons.jsonl` files across packs in `marvel/packs/*/`.
2. **Score lessons**: For each lesson, evaluate:
   - **Injection count**: How often the lesson has been injected into context.
   - **Correction rate**: How often the lesson led to a correction (lower is better — means the agent learned).
   - **Age**: How long since the lesson was created.
   - **Staleness**: Time since last injection.
3. **Classify candidates**:
   - **Promote to guardrails**: High injection count + low correction rate (lesson is well-established and consistently useful). These should be written into the pack's `guardrails.md`.
   - **Prune**: Low injection count + high staleness (lesson is no longer relevant or was too narrow).
   - **Keep**: Everything else remains as lessons.
4. **Present findings**: Show a table of candidates with their scores and recommended action.
5. **Interactive promotion**: For each promotion candidate the user approves:
   - Read the target pack's `guardrails.md`.
   - Propose where to insert the new guardrail text.
   - Apply the edit after user confirmation.
   - Remove the lesson from `lessons.jsonl`.
6. **Interactive pruning**: For each prune candidate the user approves:
   - Remove the lesson from `lessons.jsonl`.
   - Optionally archive it to `lessons.archive.jsonl`.

## Output Format

```
## Lesson Evolution Report

### Promotion Candidates (graduate to guardrails.md)
| # | Pack | Lesson | Injections | Correction Rate | Age |
|---|------|--------|------------|-----------------|-----|
| 1 | ...  | ...    | ...        | ...             | ... |

### Prune Candidates (remove stale lessons)
| # | Pack | Lesson | Last Injected | Injection Count |
|---|------|--------|---------------|-----------------|
| 1 | ...  | ...    | ...           | ...             |

Select lessons to promote [numbers/all/none]:
Select lessons to prune [numbers/all/none]:
```

## Safety

- Never auto-modify guardrails without user confirmation.
- Always show a diff preview before editing `guardrails.md`.
- Archive pruned lessons rather than deleting when the user is uncertain.
