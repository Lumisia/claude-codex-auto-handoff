---
name: handoff-clear
description: Clear ai-handoff capsules or this project's ai-handoff state. Accepts [pending|consumed|expired|used|this_project] plus options like --older-than 7d and -c.
---

# handoff-clear

Use the handoff skill's `handoff:clear` CLI command to clear local ai-handoff
state. This never deletes the source repository; it only touches the
ai-handoff data store under the current project's fingerprint.

Pass the project directory with `--cwd` rather than embedding Windows paths in
JSON:

    node <pluginRoot>/core/cli.mjs handoff:clear used --older-than 7d --cwd "<project dir>"
    node <pluginRoot>/core/cli.mjs handoff:clear --older-than 7d --cwd "<project dir>"
    node <pluginRoot>/core/cli.mjs handoff:clear pending --cwd "<project dir>"
    node <pluginRoot>/core/cli.mjs handoff:clear this_project --cwd "<project dir>"
    node <pluginRoot>/core/cli.mjs handoff:clear this_project -c --cwd "<project dir>"

Scopes:

- `pending`: clear AVAILABLE and DEGRADED_AVAILABLE capsules for this project.
- `consumed`: clear CONSUMED capsules.
- `expired`: clear EXPIRED capsules.
- `used`: clear old terminal capsules such as CONSUMED, EXPIRED, REJECTED,
  SKIPPED, and FAILED.
- `this_project`: clear the entire ai-handoff project-state folder for the
  current fingerprint.

`used`, `consumed`, and `expired` use the configured age cutoff when the user
does not pass `--older-than`; the default is 30 days. If the user passes only
`--older-than` with no scope, treat it as `used`. `--older-than` accepts values
like `7d`, `12h`, `30m`, or raw days such as `7`.

For `this_project`, the first call without `-c` is a confirmation preview. If
the CLI returns `confirmationRequired: true`, ask the user once whether to
clear the shown fingerprint/path. If they approve, rerun with `-c`. If the user
already provided `-c`, do not ask again.

Report the CLI result, especially `deleted`, `skipped`, `fingerprint`, and
`path`. Surface errors verbatim.
