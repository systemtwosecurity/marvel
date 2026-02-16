# Code Quality

Standards for TypeScript code quality, patterns, and conventions across the codebase.

## Error Handling

- Use consistent error handling patterns; prefer try/catch with typed error responses
- Always handle promise rejections; never leave promises unhandled
- Throw descriptive errors with context about what failed and why

## Naming Conventions

- Use camelCase for variables and functions, PascalCase for types and components
- Prefix boolean variables with `is`, `has`, `should`, or `can`
- Use descriptive names that convey intent; avoid abbreviations

## Import Organization

- Group imports: external libraries first, then internal modules, then relative paths
- Use named exports over default exports for better refactoring support
- Remove unused imports before committing

## Type Safety

- Prefer explicit types over inferred types for function signatures and public APIs
- Never use the `any` type; use `unknown` with type guards when the type is truly uncertain
- Use discriminated unions and exhaustive checks where applicable

## Variables and Constants

- Prefer `const` over `let`; never use `var`
- No unused variables; remove or prefix with underscore if intentionally unused
- Declare variables close to their first usage

## General Patterns

- Keep functions small and focused on a single responsibility
- Prefer early returns to reduce nesting
- Avoid magic numbers and strings; extract to named constants
