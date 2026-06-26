---
name: handoff-recent
description: Browse recent handoff capsules across all projects, newest first.
---

# handoff-recent

Review handoff capsules that have been created, consumed, or are still pending — across
all projects, not just the current one.

## GUI browser (exists now)

    ai-handoff dashboard
    aho dashboard

Opens the graphical dashboard. Use it to browse capsules by project, filter by status
(AVAILABLE / CONSUMED / EXPIRED / REJECTED), and inspect goal and next-action details.

## TUI browser (coming in this release)

A terminal UI (`ai-handoff` bare or a dedicated `ai-handoff tui` sub-command) is landing
in this release and will let you browse capsules without leaving the terminal.

## What each capsule shows

- **created_at** — when the capsule was saved.
- **status** — AVAILABLE, CONSUMED, EXPIRED, REJECTED, or SKIPPED.
- **source → target** — which agent created it and which is expected to ingest it.
- **goal** — the work summary saved at checkpoint time.
- **branch** — the git branch at checkpoint time.
- **project fingerprint** — identifies the project bucket.
- **current** flag — marks the bucket belonging to the project you ran from.

This is read-only: browsing never claims, consumes, or expires a capsule.

Invoke as `/handoff-recent` in Claude Code or `@handoff-recent` in Codex.
