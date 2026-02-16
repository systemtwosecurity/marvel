# /marvel-plan - Enter MARVEL Planning Mode

## Usage

```
/marvel-plan
/marvel-plan <spec-name>
```

## Instructions

You are entering MARVEL Planning Mode. Follow these steps precisely:

### 1. Load the Active Spec

- Look in `marvel/specs/active/` for spec files.
- If the user provided a `<spec-name>` argument, load that specific spec.
- If no argument was provided and there is exactly one active spec, load it automatically.
- If multiple active specs exist and no argument was given, list them and ask the user to choose.
- If no active specs exist, inform the user and ask if they want to plan without a spec.

### 2. Explore Current State

Use the `marvel-planner` subagent (or direct exploration if unavailable) to:

- Read the spec thoroughly to understand requirements, constraints, and acceptance criteria.
- Explore the codebase to understand the current architecture and relevant files.
- Identify which files will need to be created, modified, or deleted.
- Note any dependencies between changes.

### 3. Identify Risks

Analyze and document:

- **Breaking changes**: Will this modify public APIs, shared types, or database schemas?
- **Test coverage gaps**: Are there existing tests that will need updating?
- **Migration needs**: Does this require data migration or schema changes?
- **Cross-cutting concerns**: Will this affect multiple packages or modules?
- **Performance implications**: Could this degrade performance under load?

### 4. Present the Plan

Output a structured implementation plan:

```
## Implementation Plan: <Spec Title>

### Overview
<1-2 sentence summary of what will be built>

### Risk Assessment
- <risk 1>
- <risk 2>

### Steps

#### Step 1: <Description>
- Files: <list of files>
- Changes: <what changes>
- Why: <rationale>

#### Step 2: <Description>
...

### Verification Strategy
- <how to verify each step>
- <which tests to run>

### Open Questions
- <anything that needs clarification>
```

### 5. Wait for Approval

After presenting the plan, wait for the user to:
- Approve the plan (proceed to `/marvel-build`)
- Request modifications
- Ask questions about specific steps

Do NOT begin implementation. Planning mode is read-only with respect to source code.
