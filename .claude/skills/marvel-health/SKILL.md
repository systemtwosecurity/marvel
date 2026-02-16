# marvel-health

Analyze lesson effectiveness and pack health across recent sessions.

## When to Use

Run this skill to get a diagnostic overview of how MARVEL packs and lessons are performing. Useful for identifying underperforming packs, overloaded contexts, or lessons that need attention.

## Workflow

1. **Gather metrics**: Scan `marvel/packs/*/` for:
   - `guardrails.md` — exists and non-empty.
   - `lessons.jsonl` — lesson count, total injection count, average correction rate.
   - `guidance.jsonl` — recent session guidance entries.
2. **Compute per-pack health**:
   - **Coverage**: Does the pack have guardrails? How many lessons?
   - **Activity**: Total injections in the last N sessions (default 10).
   - **Effectiveness**: Ratio of corrections to injections (lower is better).
   - **Freshness**: Age of the most recent lesson update.
3. **Compute cross-pack metrics**:
   - **Total active lessons**: Count across all packs.
   - **Context budget usage**: Estimate total tokens if all active lessons were injected simultaneously.
   - **Most/least active packs**: Ranked by injection frequency.
   - **Correction hotspots**: Packs with highest correction rates.
4. **Generate report**: Present a structured health report.

## Output Format

```
## MARVEL Health Report

### Overall
- Total packs: N
- Total active lessons: N
- Estimated context budget: ~N tokens
- Sessions analyzed: N

### Pack Health (sorted by activity)
| Pack | Guardrails | Lessons | Injections | Correction Rate | Freshness |
|------|-----------|---------|------------|-----------------|-----------|
| ...  | yes/no    | N       | N          | N%              | N days    |

### Alerts
- [WARN] Pack "X" has 0 injections in last 10 sessions — may be unused.
- [WARN] Pack "Y" has >50% correction rate — lessons may need revision.
- [INFO] Pack "Z" has N lessons ready for promotion (high utility).

### Recommendations
1. Consider promoting N lessons from pack "A" (run /marvel-evolve).
2. Consider pruning N stale lessons from pack "B".
3. Pack "C" has no guardrails — consider creating an initial guardrails.md.
```

## Notes

- This skill is read-only. It does not modify any files.
- For actionable follow-up, use `/marvel-evolve` (promote/prune) or `/marvel-reflect` (capture new learnings).
