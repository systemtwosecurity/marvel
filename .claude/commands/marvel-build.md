# /marvel-build - Enter MARVEL Building Mode

## Usage

```
/marvel-build
/marvel-build <step-number>
```

## Instructions

You are entering MARVEL Building Mode. This phase executes the plan from a prior `/marvel-plan` session.

### Prerequisites

- A plan should already exist from a `/marvel-plan` session in this conversation.
- If no plan exists, inform the user and suggest running `/marvel-plan` first.
- If the user provides a `<step-number>`, resume from that step.

### Execution Rules

#### Step-by-Step Execution

For each step in the plan:

1. **Announce** the step before starting:
   ```
   ## Executing Step N: <Description>
   ```

2. **Explore** relevant code using the `marvel-explorer` subagent (or direct reads) before writing. Understand context before changing anything.

3. **Implement** the changes described in the plan. Follow project coding standards and any MARVEL pack lessons that are injected.

4. **Verify incrementally** after each step:
   - Run the project's lint command to catch syntax and style issues.
   - Run the project's typecheck command to catch type errors.
   - Fix any issues before moving to the next step.

5. **Report** completion of each step:
   ```
   Step N complete. Lint: PASS | Typecheck: PASS
   ```

#### Error Handling

- If lint or typecheck fails after a step, fix the issue before proceeding.
- If a step cannot be completed as planned, explain why and propose an alternative.
- If a step reveals that the plan needs adjustment, pause and discuss with the user.

#### Quality Standards

- Write clean, well-typed code that follows existing patterns in the codebase.
- Add or update tests for any logic changes.
- Do not introduce `any` types, `@ts-ignore`, or `eslint-disable` comments.
- Respect existing file organization and naming conventions.

### Completion

After all steps are executed:

1. Run full verification: lint, typecheck, build, and tests.
2. Summarize what was built and any deviations from the plan.
3. Suggest running `/marvel-verify` for a complete verification pass.
4. Suggest running `/marvel-commit` when the user is ready to commit.
