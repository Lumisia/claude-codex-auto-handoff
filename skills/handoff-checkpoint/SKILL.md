---
name: handoff-checkpoint
description: Manually save a handoff capsule right now. Pass a short goal description as the argument.
---

# handoff-checkpoint

Save a handoff capsule immediately so the other agent can pick up where you left off.
Use this any time you want to preserve current progress without waiting for the
automatic 5-hour threshold.

## Usage

    ai-handoff checkpoint --message "<goal summary>"
    aho checkpoint --message "<goal summary>"

The `--message` flag is required and should describe what you were working on and what
comes next. Keep it concise but specific enough for the receiving agent to act on.

## When to use

- Before switching agents intentionally (Claude Code → Codex or vice versa).
- Before a long break where context may be lost.
- After reaching a meaningful milestone mid-session.

## In Claude Code / Codex

Invoke as `/handoff-checkpoint <goal>` in Claude Code or `@handoff-checkpoint <goal>`
in Codex. The agent will run `ai-handoff checkpoint --message "<goal>"` and report the
capsule ID on success.

Never include secrets, credentials, or raw transcript text in the message.
