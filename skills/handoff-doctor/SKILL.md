---
name: handoff-doctor
description: Diagnose why a handoff is not appearing — fingerprint/basis, store location, capsule integrity, stale claims, approval state, and capsules pending under a different directory/fingerprint.
---

# handoff-doctor

Run `handoff:doctor --cwd "<project dir>"`. Report `basis` (how the project
fingerprint was derived: git remote / git root / path), `dataRoot` (where
capsules live), `cwdResolved`, current `pending`/`issues`, `approval`, and
`claudeStatusline`.

If `otherPending` is non-empty, a capsule exists under a DIFFERENT fingerprint —
tell the user which directory/remote it belongs to and that both agents must run
from the same project (a git repo gives a path-independent remote-based
fingerprint). Do not consume, rewrite, or delete a capsule during diagnosis.

If `claudeStatusline.shadowed` is true, explain that Claude settings precedence
is the cause: project-local `.claude/settings.local.json` and project
`.claude/settings.json` can override user `~/.claude/settings.json`. The report
includes the Claude settings precedence documentation URL. To repair the user
statusline runner, run:

    node <pluginRoot>/core/cli.mjs handoff:doctor --fix-statusline --cwd "<project dir>"

This installs or refreshes the user settings entry but intentionally does not
edit project/local Claude settings. If the report remains shadowed after the
fix, tell the user which higher-precedence file owns the active `statusLine`.
