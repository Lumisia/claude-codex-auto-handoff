---
name: handoff-ratelimit
description: Shows how close you are to the 5-hour usage limit and explains how automatic handoff triggers near that limit.
---

# handoff-ratelimit

ai-handoff watches your 5-hour usage window. When usage crosses the configured
`threshold_percent` (default 80 %), the daemon automatically creates a handoff capsule
so the other agent can continue without losing context.

## Statusline indicator (exists now)

The current usage level is displayed live in the agent statusline after you run
`ai-handoff install`. The indicator updates every check cycle from the daemon.

To install or refresh it:

    ai-handoff install
    aho install

## Checking token usage from the CLI

`ai-handoff usage` estimates token usage by scanning your local Claude and Codex logs
(read-only) and prints totals plus an approximate cost. It is a **local estimate, not an
official bill or quota**.

    ai-handoff usage                          # summary: total tokens + est cost, per agent
    ai-handoff usage --group-by day           # break down by day
    ai-handoff usage --group-by model         # by model
    ai-handoff usage --group-by project       # by project
    ai-handoff usage --source codex --since 2026-06-01
    ai-handoff usage --json                   # machine-readable

`ai-handoff limits` (local estimate of remaining 5-hour quota) is still coming in a later
release. For the live 5-hour-window level, use the statusline indicator or the dashboard:

    ai-handoff dashboard   # GUI view

## Automatic handoff modes

Configured via `mode` in `~/.ai-handoff/config.toml`:

- `auto` — daemon creates and publishes a capsule automatically when the threshold is crossed.
- `ask` — daemon prompts you to run `/handoff checkpoint` or dismiss the request.
- `off` — no automatic detection; manual checkpoints only.

Invoke as `/handoff-ratelimit` in Claude Code or `@handoff-ratelimit` in Codex to
display this information in context.
