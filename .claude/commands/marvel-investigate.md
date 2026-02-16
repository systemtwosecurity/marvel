# /marvel-investigate - Issue Investigation

## Usage

```
/marvel-investigate
/marvel-investigate <issue-description>
```

## Instructions

Systematically investigate a bug or issue in the codebase. This command follows a structured investigation workflow to identify root causes before proposing fixes.

### 1. Understand the Issue

If the user provided an `<issue-description>`, use it as the starting point. Otherwise, ask:

- What is the observed behavior?
- What is the expected behavior?
- When did it start happening (if known)?
- Are there error messages, logs, or stack traces?

### 2. Reproduce the Issue

Attempt to reproduce or confirm the issue:

- Look for relevant test files that cover the affected area.
- Check for error patterns in the codebase (search for the error message if provided).
- Trace the code path from entry point to the failure point.
- If a specific command triggers the issue, run it and capture the output.

### 3. Identify Root Cause

Follow a systematic investigation:

1. **Trace the call chain**: Start from where the error manifests and work backwards.
2. **Check recent changes**: Run `git log --oneline -20` and `git diff HEAD~5` to see if recent commits introduced the issue.
3. **Search for related code**: Look for similar patterns that might be affected.
4. **Check dependencies**: Verify that imports, types, and interfaces are consistent.
5. **Review configuration**: Check for environment variables, config files, or feature flags.

### 4. Document Findings

Present findings in a structured format:

```
## Investigation Report

### Issue
<clear description of the problem>

### Root Cause
<explanation of why the issue occurs>

### Evidence
- <file:line - what was found>
- <file:line - what was found>

### Affected Areas
- <list of files/modules affected>

### Impact
- <severity: critical / high / medium / low>
- <scope: how many users/features affected>

### Proposed Fixes
1. **<Fix option 1>**: <description>
   - Pros: <advantages>
   - Cons: <disadvantages>
   - Files to change: <list>

2. **<Fix option 2>**: <description>
   - Pros: <advantages>
   - Cons: <disadvantages>
   - Files to change: <list>

### Recommendation
<which fix option is recommended and why>
```

### 5. Next Steps

After presenting the investigation report, ask the user:
- Would you like to proceed with a fix? (suggest `/marvel-fixbug`)
- Do you need more investigation in a specific area?
- Should this be documented as a known issue?

### Notes

- Do NOT apply fixes during investigation. This command is for understanding the problem only.
- Read broadly before concluding. Check at least 3-5 related files.
- Consider both the immediate fix and whether there is a systemic issue.
