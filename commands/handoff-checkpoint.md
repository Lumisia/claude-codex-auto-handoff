---
description: Manually save a handoff capsule now
argument-hint: "[short goal description]"
---

Use the handoff-session skill to author a capsule now via `handoff:checkpoint`.
Build a sentinel JSON with the current `goal` and `next_actions` (use
`$ARGUMENTS` as a hint for the goal when provided), then publish it. Never
include secrets, hidden reasoning, or transcript text.
