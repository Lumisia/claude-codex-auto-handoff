---
name: handoff-config
description: View or change ai-handoff settings. Both Claude Code and Codex read the same unified config file.
---

# handoff-config

ai-handoff uses a single unified config file shared by both agents:

    ~/.ai-handoff/config.toml

Any setting changed here applies to both Claude Code and Codex — there is no per-agent
config split.

## Key settings

| Key | Values | Default | Effect |
|-----|--------|---------|--------|
| `threshold_percent` | 0–100 | 80 | Trigger handoff at this % of the 5-hour limit |
| `mode` | `off` / `ask` / `auto` | `ask` | How automatic handoff behaves |
| `burn_rate` | number | — | Expected token burn rate for early-warning estimate |
| `statusline` | bool | true | Show usage indicator in the agent statusline |

## Today: edit the TOML directly

Open `~/.ai-handoff/config.toml` in any editor and change the values. The daemon picks
up changes on the next check cycle; no restart is required.

## Coming in this release: `config get/set`

    ai-handoff config get threshold_percent
    ai-handoff config set threshold_percent 75
    ai-handoff config set mode auto
    aho config set statusline false

These commands are not available yet but are landing in this release.

## In Claude Code / Codex

Invoke as `/handoff-config` in Claude Code or `@handoff-config` in Codex. Report the
current value of the requested key from `config.toml`, or apply the requested change by
editing that file. Surface any parse errors verbatim.
