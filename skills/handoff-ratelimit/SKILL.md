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

## Checking usage from the CLI (coming in this release)

Two commands are landing in this release:

    ai-handoff usage       # token usage so far in the current 5-hour window
    ai-handoff limits      # local estimate of remaining quota

These are not available yet. Until they land, check the statusline indicator or open the
dashboard:

    ai-handoff dashboard   # GUI view with usage history

## Automatic handoff modes

Configured via `mode` in `~/.ai-handoff/config.toml`:

- `auto` — daemon creates and publishes a capsule automatically when the threshold is crossed.
- `ask` — daemon prompts you to run `/handoff checkpoint` or dismiss the request.
- `off` — no automatic detection; manual checkpoints only.

Invoke as `/handoff-ratelimit` in Claude Code or `@handoff-ratelimit` in Codex to
display this information in context.
