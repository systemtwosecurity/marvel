# /marvel-commit - Create MARVEL Commit

## Usage

```
/marvel-commit
/marvel-commit <message>
```

## Instructions

Create a well-structured commit following conventional commit format. This command ensures code quality checks pass before committing.

### Pre-Commit Verification

Before creating the commit, run these checks:

1. **Lint**: `pnpm lint`
2. **Typecheck**: `pnpm typecheck`

If either check fails:
- Display the errors.
- Offer to fix them automatically.
- Do NOT proceed with the commit until both pass.

If both checks have already passed in this session (tracked by MARVEL session state), you may skip re-running them. Inform the user that cached results are being used.

### Analyze Changes

1. Run `git status` to see all modified, added, and deleted files.
2. Run `git diff --staged` to see what is already staged.
3. Run `git diff` to see unstaged changes.
4. If nothing is staged, ask the user which files to stage or suggest staging all relevant changes.

### Draft Commit Message

Use conventional commit format:

```
<type>(<scope>): <description>

<body>
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`, `ci`, `build`

**Rules**:
- The description (first line) must be under 72 characters.
- Use imperative mood ("add feature" not "added feature").
- The scope should identify the affected module or area.
- The body should explain *why* the change was made, not just *what* changed.
- If the user provided a `<message>` argument, use it as the basis for the commit message but still format it properly.

### Confirm and Commit

1. Present the proposed commit message to the user.
2. Wait for approval or edits.
3. Stage the appropriate files (prefer explicit file names over `git add -A`).
4. Create the commit.
5. Run `git status` to verify the commit succeeded.

### Post-Commit

After a successful commit:
- Display the commit hash and summary.
- Note that pre-commit status has been reset for the next change cycle.
