# /marvel-fixbug - MARVEL Bug Fix Workflow

## Usage

```
/marvel-fixbug
/marvel-fixbug <bug-description>
```

## Instructions

Execute a structured bug fix workflow. This command takes a bug from understanding through fix, test, and verification.

### 1. Understand the Bug

If coming from `/marvel-investigate`, use the investigation report as context. Otherwise:

- Ask the user to describe the bug (or use the `<bug-description>` argument).
- Identify the expected vs. actual behavior.
- Locate the affected code by searching for relevant files, error messages, or function names.

### 2. Find Related Code

Before writing any fix:

- Read the file(s) where the bug manifests.
- Read surrounding files that interact with the buggy code.
- Check for existing tests that cover the affected area.
- Look for similar patterns elsewhere that might have the same bug.

### 3. Implement the Fix

Apply the minimal, targeted fix:

- Change only what is necessary to fix the bug.
- Do not refactor unrelated code in the same change.
- Add comments only if the fix is non-obvious and could be mistakenly reverted.
- If the fix requires changes in multiple files, make them in a logical order.

### 4. Write or Update Tests

Every bug fix must include test coverage:

- **If tests exist** for the affected area: Add a test case that would have caught the bug.
- **If no tests exist**: Write a focused test file covering the fixed behavior.
- The test should:
  - Fail without the fix (verify it catches the bug).
  - Pass with the fix applied.
  - Cover edge cases related to the bug.

### 5. Verify the Fix

Run the full verification sequence:

1. **Lint**: `pnpm lint`
2. **Typecheck**: `pnpm typecheck`
3. **Tests**: `pnpm test:run`

If any verification step fails:
- Analyze the failure.
- Fix the issue.
- Re-run verification.

### 6. Summary

After verification passes, present a summary:

```
## Bug Fix Summary

### Bug
<description of what was wrong>

### Root Cause
<why it was happening>

### Fix Applied
<what was changed and why>

### Files Changed
- <file1> - <what changed>
- <file2> - <what changed>

### Tests Added/Updated
- <test-file> - <what is tested>

### Verification
- Lint: PASS
- Typecheck: PASS
- Tests: PASS (<N> passed, <M> new)
```

### 7. Next Steps

Suggest the user:
- Review the changes with `git diff`.
- Commit with `/marvel-commit` using the `fix` conventional commit type.
- Consider if similar bugs exist elsewhere (suggest `/marvel-investigate` if so).

### Notes

- Prefer fixing the root cause over applying a workaround.
- If the fix is risky or large, discuss the approach with the user before implementing.
- If the bug reveals a missing MARVEL lesson, suggest using `/marvel-teach` to capture the knowledge.
