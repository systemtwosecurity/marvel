# Git Workflow

Conventions for Git usage, branch management, and collaboration across the team.

## Conventional Commits

- Follow the Conventional Commits format: `type(scope): description`
- Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`
- Keep the subject line under 72 characters; use the body for details

## Commit Messages

- Write meaningful commit messages that explain why the change was made
- Reference related issues or tickets in the commit body when applicable
- Each commit should represent a single logical change

## Branch Naming

- Use the format: `username/type/short-description` (e.g., `alice/feat/add-login`)
- Keep branch names lowercase with hyphens as separators
- Delete branches after they are merged

## Protected Branches

- Never push directly to `main`; all changes must go through pull requests
- Never force push to `main` or shared branches
- Keep `main` in a deployable state at all times

## Pull Request Conventions

- Write a clear PR title and description summarizing the changes
- Keep PRs focused and reasonably sized; split large changes into smaller PRs
- Ensure CI passes before requesting review
- Address all review comments before merging
