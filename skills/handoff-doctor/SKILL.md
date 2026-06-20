---
name: handoff-doctor
description: Diagnose why a handoff is not appearing — fingerprint/basis, store location, capsule integrity, stale claims, approval state, and capsules pending under a different directory/fingerprint.
---

# handoff-doctor

Run `handoff:doctor --cwd "<project dir>"`. Report `basis` (how the project
fingerprint was derived: git remote / git root / path), `dataRoot` (where
capsules live), `cwdResolved`, current `pending`/`issues`, and `approval`.

If `otherPending` is non-empty, a capsule exists under a DIFFERENT fingerprint —
tell the user which directory/remote it belongs to and that both agents must run
from the same project (a git repo gives a path-independent remote-based
fingerprint). Do not consume, rewrite, or delete a capsule during diagnosis.
