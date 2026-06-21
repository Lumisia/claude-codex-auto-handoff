---
name: handoff-recent
description: List recent handoff capsules across all projects, newest first.
---

# handoff-recent

Run `handoff:recent --cwd "<project dir>"` (optionally `--limit <n>`, default
10). It scans every project bucket — not just the current one — and returns
recent capsules newest-first.

Report each row's `created_at`, `status` (AVAILABLE / CONSUMED / EXPIRED /
REJECTED / ...), `source -> target`, `goal`, `branch`, `fingerprint`, and
`taskId`. The `current` flag marks the bucket of the project you ran from, so the
user can tell "this project" apart from the rest. Read-only: it never claims,
consumes, or expires a capsule.
