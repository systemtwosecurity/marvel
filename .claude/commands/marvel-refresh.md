# /marvel-refresh - Force Reload MARVEL Packs

## Usage

```
/marvel-refresh
```

## Instructions

Force a reload of all MARVEL packs and report any changes since the session started.

### 1. Scan Current Packs

Read the current state of all packs in `marvel/packs/`:

For each pack directory:
- Read `pack.json` for metadata (name, version, categories).
- Read `lessons.jsonl` and count lessons.
- Read `guardrails.md` and note its presence and size.

### 2. Compare to Session Start

If the current run's `run.json` contains `packVersions`:
- Compare current versions against the recorded versions.
- Identify packs that have been added, removed, or updated.

If no prior version data is available, skip comparison and just report current state.

### 3. Report Changes

```
## MARVEL Pack Refresh

### Current Packs (<count> total)

| Pack | Version | Lessons | Status |
|------|---------|---------|--------|
| <name> | <version> | <count> | unchanged / updated / new / removed |

### Changes Detected
- <pack-name>: version <old> -> <new>
- <pack-name>: <N> new lessons added
- <pack-name>: guardrails.md updated

### No Changes
All packs are unchanged since session start.
```

### 4. Reload Confirmation

After scanning, confirm the reload:

```
Pack cache refreshed. <N> packs loaded with <M> total lessons.
```

### Notes

- This command does not modify any pack files. It only reads and reports.
- If `marvel/packs/` does not exist, inform the user that MARVEL packs are not configured for this project.
- This is useful after pulling changes from a remote branch that may have updated pack lessons or guardrails.
