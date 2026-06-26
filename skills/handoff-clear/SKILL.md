---
name: handoff-clear
description: Clear pending or used handoff capsules for the current project. Accepts optional scope and age arguments.
---

# handoff-clear

Clears ai-handoff capsule state for the current project. This never deletes the source
repository; it only touches the ai-handoff data store under the current project's
fingerprint.

## Current status

A dedicated `ai-handoff clear` sub-command is coming in this release. Until it lands,
capsule state can be managed through the GUI:

    ai-handoff dashboard    # open the GUI capsule browser — delete from there

If you need to clear state from the command line today, locate the data directory with:

    ai-handoff doctor       # shows the data root where capsules are stored

Then remove the relevant capsule files from that directory manually.

## Forthcoming CLI (coming in this release)

Once `ai-handoff clear` lands, the interface will look like:

    ai-handoff clear pending              # clear capsules awaiting pickup
    ai-handoff clear used                 # clear consumed/expired/rejected capsules
    ai-handoff clear used --older-than 7d # only those older than 7 days
    ai-handoff clear this_project         # clear all ai-handoff state for this project

Invoke as `/handoff-clear` in Claude Code or `@handoff-clear` in Codex.

For `this_project`, a confirmation step will be required before anything is deleted —
this clears only ai-handoff's state folder for the current fingerprint, not the repository.
