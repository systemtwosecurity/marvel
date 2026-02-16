# /marvel-teach - Teach MARVEL a Lesson Directly

## Usage

```
/marvel-teach
/marvel-teach <pack-name>
```

## Instructions

Submit knowledge directly to a MARVEL pack without going through the correction/reflection flow. This is for when you already know the lesson you want to teach.

### 1. Select Target Pack

- If the user provided a `<pack-name>` argument, validate that it exists in `marvel/packs/`.
- If no argument was provided, list available packs and ask the user to choose:
  ```
  Available packs:
  1. <pack-name> - <description>
  2. <pack-name> - <description>
  ...

  Which pack should receive this lesson?
  ```
- If the specified pack does not exist, list available packs and ask the user to choose a valid one.

### 2. Gather the Lesson

Ask the user for the lesson content if not already provided in the conversation. A lesson needs:

- **Title**: A short imperative rule (under 10 words). Example: "Validate inputs at API boundaries"
- **Description**: Why this matters (1-2 sentences).
- **Actionable**: What to do concretely in any instance of this pattern.
- **Category**: A classification tag (should match one of the pack's categories).

If the user provides a natural language description, extract these fields from it.

### 3. Check for Duplicates

Read the target pack's `lessons.jsonl` and check if a lesson with similar content already exists. Compare by:
- Exact title match
- High similarity in the actionable text

If a duplicate is found, inform the user and ask if they want to proceed anyway or update the existing lesson.

### 4. Format and Review

Present the formatted lesson for review:

```
## Lesson Preview

**Pack**: <pack-name>
**Category**: <category>
**Title**: <title>
**Description**: <description>
**Actionable**: <actionable>

Confirm? [yes / edit / cancel]
```

### 5. Write the Lesson

On confirmation, append to `marvel/packs/<pack-name>/lessons.jsonl`:

```json
{"timestamp":"<ISO-8601>","category":"<category>","title":"<title>","description":"<description>","actionable":"<actionable>"}
```

Confirm success:
```
Lesson added to <pack-name>. It will be injected when relevant files are accessed.
```

### Notes

- Each line in `lessons.jsonl` must be valid JSON (JSONL format).
- Do not modify existing lessons when appending.
- The timestamp should be the current UTC time in ISO-8601 format.
