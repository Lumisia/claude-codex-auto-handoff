---
name: handoff-config
description: View or change ai-handoff settings. Both Claude Code and Codex read the same unified config file.
---

# handoff-config

ai-handoff uses a single unified config file shared by both agents:

    ~/.ai-handoff/config.toml

Any setting changed here applies to both Claude Code and Codex — there is no per-agent
config split.

## Editable keys

| Key | Values | Default | Effect |
|-----|--------|---------|--------|
| `triggers.five_hour.enabled` | bool | true | Master switch for the 5-hour-limit handoff trigger |
| `triggers.five_hour.threshold_percent` | 0–100 | 80 | Trigger handoff at this % of the 5-hour limit |
| `triggers.five_hour.mode` | `off` / `ask` / `auto` | `ask` | How automatic handoff behaves |
| `triggers.five_hour.burn_rate.enabled` | bool | false | Enable burn-rate early-warning estimate |
| `triggers.five_hour.burn_rate.runway_minutes` | number > 0 | 30 | Runway used by the burn-rate estimate |
| `autostart.enabled` | bool | false | Start the daemon at logon |
| `statusline.show` | bool | true | Show the usage indicator in the agent statusline |

## Commands

    ai-handoff config list                                   # every key + effective value
    ai-handoff config get triggers.five_hour.threshold_percent
    ai-handoff config set triggers.five_hour.threshold_percent 75
    ai-handoff config set triggers.five_hour.mode auto
    aho config set statusline.show false

`set` is never-clobber: it edits exactly the one key and preserves every other line,
comment and section. Unknown keys and out-of-range values are rejected with a non-zero
exit and an `error:` message; nothing is written. The daemon picks up changes on its
next check cycle — no restart required.

You can still edit `~/.ai-handoff/config.toml` by hand; the `config` commands are just a
validated front end to the same file.

## In Claude Code / Codex

Invoke as `/handoff-config` in Claude Code or `@handoff-config` in Codex. To read, run
`ai-handoff config get <key>` (or `config list`); to change a value, run
`ai-handoff config set <key> <value>` and report the confirmation line or surface any
`error:` output verbatim.
