# Packs

Packs are self-contained units of knowledge. Each pack covers a specific domain — code quality, security, testing, git workflow — and contains rules and lessons that MARVEL injects into Claude's context when relevant.

## Structure

Every pack is a directory under `marvel/packs/` with three files:

```
marvel/packs/my-pack/
├── pack.json          # Metadata and targeting rules
├── guardrails.md      # Human-written rules (injected as-is)
└── lessons.jsonl      # Machine-learned lessons (one JSON per line)
```

## pack.json

Controls when and where the pack's content is injected.

```json
{
  "name": "my-pack",
  "version": "1.0.0",
  "owner": "team-name",
  "description": "What this pack covers",
  "categories": ["category-a", "category-b"],
  "applies_to": {
    "extensions": [".ts", ".tsx"]
  },
  "sensitive_paths": ["**/auth/**"],
  "excludes_paths": ["node_modules/", "dist/"]
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `name` | Must match the directory name. Lowercase, hyphenated. |
| `version` | Semantic version string (e.g., `1.0.0`). |
| `owner` | Team or individual responsible for maintaining the pack. |

### Optional Fields

| Field | Description |
|-------|-------------|
| `description` | Brief description of the pack's purpose. |
| `categories` | Knowledge domains (used for relevance scoring and correction routing). |
| `applies_to.extensions` | File extensions that trigger this pack (e.g., `[".ts", ".tsx"]`). |
| `depends_on` | Other packs this pack depends on (boosts their relevance). |
| `sensitive_paths` | Glob patterns for high-importance files (strong relevance signal). |
| `excludes_paths` | Path prefixes where this pack should never inject. |
| `references.code_paths` | Key file paths in the codebase (strongest relevance signal). |
| `references.doc_links` | External documentation URLs. |

Packs are validated against `marvel/packs/_pack.schema.json`.

## guardrails.md

Human-authored rules injected directly into Claude's context. Write clear, imperative instructions organized by topic.

Good guardrails:
- "Use `unknown` instead of `any` for untyped values."
- "Always check for `null` before accessing optional chain results."
- "Prefer `vitest` matchers over raw `assert` calls."

Bad guardrails:
- "Write good code." (too vague)
- "Follow best practices." (not actionable)

## lessons.jsonl

Machine-learned lessons, one JSON object per line:

```json
{"timestamp":"2026-01-15T10:00:00Z","category":"code-quality","title":"Prefer early returns","description":"Reduce nesting with guard clauses","actionable":"When a function has a guard condition, return early instead of wrapping the body in an if block"}
```

### Lesson Fields

| Field | Required | Description |
|-------|----------|-------------|
| `timestamp` | Yes | ISO 8601 creation time. |
| `category` | Yes | Knowledge domain (should match a pack category). |
| `title` | Yes | Short identifier. |
| `description` | Yes | What the lesson teaches. |
| `actionable` | Yes | Concrete instruction for Claude to follow. |
| `run_id` | No | Session that created the lesson. |
| `utility_score` | No | Effectiveness rating (set by `/marvel-health`). |
| `injection_count` | No | How many times this lesson has been injected. |

## Relevance Scoring

When a `PreToolUse` hook fires for a file operation, MARVEL scores every loaded pack to decide which lessons to inject.

### Scoring Weights

| Signal | Weight | Description |
|--------|--------|-------------|
| `FILE_PATTERN_MATCH` | 15 | File path matches `references.code_paths` |
| `EXTENSION_MATCH` | 5 | File extension matches `applies_to.extensions` |
| `SENSITIVE_PATH` | 20 | File matches `sensitive_paths` glob |
| `RECENT_CORRECTION` | 20 | User corrected something in this pack's category (last 30 min, up to 3x) |
| `CATEGORY_MATCH` | 8 | Recent guidance matches the pack's categories |
| `PATH_KEYWORD` | 8 | File path contains a keyword matching the pack (e.g., "test" -> testing) |
| `DEPENDENCY_BOOST` | 3 | Pack is a dependency of another relevant pack |

### Thresholds

- **Strong signal** (code path, sensitive path, or recent correction): minimum score of 10
- **Weak signal** (extension match only): minimum score of 20
- **Maximum 4 packs per injection**
- **Maximum 10 lessons total** (sorted by `utility_score` descending, 3 per pack)

### Path Keyword Boosting

File paths containing certain keywords boost packs with matching categories:

| Keyword | Boosted Categories |
|---------|-------------------|
| `test`, `spec` | testing, test-quality |
| `auth`, `middleware` | security, auth |
| `config`, `env` | configuration |
| `schema`, `migration` | database, schema |

### Exclusion

If a file path starts with any of the pack's `excludes_paths` prefixes, the pack's score is set to 0.

## Lesson Lifecycle

1. **Capture** — The `UserPromptSubmit` hook detects a user correction
2. **Classify** — Guidance is categorized by type and domain
3. **Store** — Guidance is written to the run's `guidance.jsonl`
4. **Reflect** — `/marvel-reflect` reviews guidance and extracts lesson candidates
5. **Promote** — Approved lessons are appended to the target pack's `lessons.jsonl`
6. **Inject** — Future `PreToolUse` hooks include the lesson when the pack is relevant
7. **Evolve** — `/marvel-evolve` graduates high-utility lessons into `guardrails.md` and prunes stale ones

## Starter Packs

MARVEL ships with four starter packs:

| Pack | Categories | File Extensions | Sensitive Paths |
|------|-----------|----------------|-----------------|
| `code-quality` | typescript, code-quality, patterns | .ts, .tsx, .js, .jsx | — |
| `git-workflow` | git, workflow, collaboration | .md | .git/\*\*, CLAUDE.md |
| `testing` | testing, vitest, test-quality | .test.ts, .test.tsx, .spec.ts, .spec.tsx | — |
| `security` | security, auth, validation | .ts, .tsx, .js, .jsx | \*\*/auth/\*\*, \*\*/middleware/\*\*, \*\*/.env\* |

These are starting points. Modify them or create new packs to match your project's conventions.
