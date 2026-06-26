---
name: handoff
description: Resume, create, diagnose, clear, or recall a cross-agent handoff. Supports status, checkpoint, doctor, recent, clear, and config as arguments.
---

# handoff

Backs the `/handoff` command (Claude Code) and `@handoff` command (Codex). ai-handoff
is a native Rust daemon that automatically creates a cross-agent handoff capsule when
you approach the 5-hour usage limit, so the other agent (Claude Code ↔ Codex) can
continue your work from exactly where you left off.

The short alias `aho` is installed on PATH and is equivalent to `ai-handoff` in every
context below.

## Sub-commands (invoke directly or via argument)

- `/handoff` (bare) — resume: ingest the pending capsule for this project and continue.
- `/handoff status` — show whether a capsule is pending for this project.
- `/handoff preview` — show the pending capsule without consuming it.
- `/handoff checkpoint` — save a handoff capsule right now (`handoff-checkpoint`).
- `/handoff doctor` — diagnose install health and capsule integrity (`handoff-doctor`).
- `/handoff recent` — list recent capsules across all projects (`handoff-recent`).
- `/handoff clear` — clear pending/used capsules for this project (`handoff-clear`).
- `/handoff config` — view or change unified settings (`handoff-config`).

Use `/handoff-x` in Claude Code or `@handoff-x` in Codex to invoke each sub-skill directly.

## Underlying CLI (v2 native Rust)

The daemon and all management operations are driven by `ai-handoff` (alias `aho`):

    ai-handoff doctor            # health check
    ai-handoff daemon            # start the background daemon
    ai-handoff checkpoint --message "..."   # save a capsule now
    ai-handoff dashboard         # open the GUI capsule browser

Capsule and memory state are references only. Current user instructions, repository
files, Git history, and tests always take precedence over capsule content.
