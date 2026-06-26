---
name: handoff-doctor
description: Diagnose the ai-handoff install and capsule health — fingerprint, store location, daemon status, capsule integrity, and statusline wiring.
---

# handoff-doctor

Run a full health check of the ai-handoff installation and report findings.

## Usage

    ai-handoff doctor
    aho doctor

Invoke as `/handoff-doctor` in Claude Code or `@handoff-doctor` in Codex.

## What it reports

- **Install health** — whether the `ai-handoff` binary is on PATH and the daemon is running.
- **Data root** — the directory where capsules are stored (`~/.ai-handoff/` by default,
  or the `AI_HANDOFF_ROOT` override if set).
- **Project fingerprint** — how the current project is identified (git remote, git root,
  or path fallback) and the resolved fingerprint value.
- **Pending capsules** — whether a capsule is waiting to be ingested for this project,
  and any integrity issues found.
- **Other-fingerprint capsules** — if a capsule exists under a different fingerprint, the
  doctor will tell you which directory or remote it belongs to. Both agents must run from
  the same project root (a git repo gives a path-independent remote-based fingerprint).
- **Statusline** — whether the usage indicator is wired into the agent's statusline and
  whether any project-local settings are shadowing the user-level config.

## If the statusline is not showing

Run `ai-handoff install` to (re-)install the statusline runner into user-level Claude
settings (`~/.claude/settings.json`). Project-local `.claude/settings.json` and
`.claude/settings.local.json` take precedence and can shadow the user setting; the
doctor report will name which file is shadowing.

Do not consume, rewrite, or delete capsules during diagnosis.
