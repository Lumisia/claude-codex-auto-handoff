# Task 1.2 — Rename recover → doctor and expand diagnosis

ai-handoff repo, branch v1.1-enhancements. Node ≥18, zero deps, ES modules. TDD.

## Files
- Modify: `core/hooks/handoff.mjs` (rename `recoverFor` → `doctorFor`, expand)
- Modify: `core/cli.mjs` (dispatch `handoff:recover` → `handoff:doctor`, handler `handoffRecover` → `handoffDoctor`)
- Rename: `skills/handoff-recover/SKILL.md` → `skills/handoff-doctor/SKILL.md` (use `git mv`)
- Modify references: `tests/skills-present.test.mjs` + any test / README referencing recover
- Test: create `tests/cli-doctor.test.mjs`

## Consumes (already exists)
- `projectFingerprintInfo(cwd) -> { fingerprint, basis: { type, value } }` from `core/lib/fingerprint.mjs` (Task 1.1, committed).
- In `core/hooks/handoff.mjs`: existing `findPendingCapsule`, `verifyStoredCapsule`, `findApproval`, and the current `recoverFor`.
- `dataRoot()` from `core/lib/paths.mjs`; `projectDir`/`handoffDir` also there.

## Produces
- `doctorFor(cwd, { now }) -> { fingerprint, basis, cwdResolved, dataRoot, healthy, issues, pending, approval, otherPending }`
- CLI command `handoff:doctor`.

## Step 1 — failing test: create `tests/cli-doctor.test.mjs`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'cli.mjs');
const run = (args, input, env) =>
  execFileSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } });

test('handoff:doctor reports basis and cross-fingerprint pending capsules', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-doc-'));
  const projA = mkdtempSync(join(tmpdir(), 'ah-a-'));
  const projB = mkdtempSync(join(tmpdir(), 'ah-b-'));
  const env = { AI_HANDOFF_ROOT: root };
  run(['handoff:checkpoint', '--agent', 'codex', '--cwd', projA],
    JSON.stringify({ session_id: 's', sentinel: { goal: 'find me', next_actions: ['x'] } }), env);
  const out = JSON.parse(run(['handoff:doctor', '--cwd', projB], '', env));
  assert.equal(out.basis.type, 'path');
  assert.equal(out.pending, null);
  assert.equal(out.otherPending.length, 1);
  assert.equal(out.otherPending[0].goal, 'find me');
});
```

## Step 2 — run, expect FAIL
`node --test tests/cli-doctor.test.mjs` → `unknown command: handoff:doctor`.

## Step 3 — expand + rename in `core/hooks/handoff.mjs`
At top, ensure these imports exist (merge, do not duplicate): `import { projectFingerprintInfo } from '../lib/fingerprint.mjs';`, `import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';`, `import { join } from 'node:path';`, `import { dataRoot } from '../lib/paths.mjs';`. (The file already imports `projectFingerprint` — keep it if still used elsewhere; it is used by statusFor/createFromApproval/etc., so keep that import.)

Remove the old `recoverFor` and add:
```js
function scanOtherPending(currentFp) {
  const projects = join(dataRoot(), 'projects');
  const out = [];
  let names = [];
  try { names = readdirSync(projects); } catch { return out; }
  for (const fp of names) {
    if (fp === currentFp) continue;
    const hdir = join(projects, fp, 'handoff');
    let tasks = [];
    try { tasks = readdirSync(hdir); } catch { continue; }
    for (const taskId of tasks) {
      const statePath = join(hdir, taskId, 'state.json');
      const capPath = join(hdir, taskId, 'capsule.json');
      if (!existsSync(statePath) || !existsSync(capPath)) continue;
      let state; let cap;
      try { state = JSON.parse(readFileSync(statePath, 'utf8')); cap = JSON.parse(readFileSync(capPath, 'utf8')); }
      catch { continue; }
      if (state.status !== 'AVAILABLE' && state.status !== 'DEGRADED_AVAILABLE') continue;
      out.push({
        fingerprint: fp, taskId,
        goal: cap.task && cap.task.goal,
        source: cap.source && cap.source.agent,
        branch: cap.project && cap.project.git_branch,
      });
    }
  }
  return out;
}

export function doctorFor(cwd, { now = Date.now() } = {}) {
  const { fingerprint, basis } = projectFingerprintInfo(cwd);
  let cwdResolved = cwd;
  try { cwdResolved = realpathSync(cwd); } catch {}
  const pending = findPendingCapsule(fingerprint, { now });
  const approval = findApproval(fingerprint);
  const issues = [];
  let verified = null;
  if (pending?.capsule) {
    verified = verifyStoredCapsule(fingerprint, pending.taskId, { now });
    issues.push(...verified.errors);
  }
  return {
    fingerprint,
    basis,
    cwdResolved,
    dataRoot: dataRoot(),
    healthy: issues.length === 0,
    issues,
    pending: pending ? {
      taskId: pending.taskId,
      status: pending.state.status,
      recoveredAt: pending.state.recovered_at || null,
      verified: verified?.valid ?? false,
    } : null,
    approval: approval ? { key: approval.key, status: approval.status } : null,
    otherPending: scanOtherPending(fingerprint),
  };
}
```

## Step 4 — rename command in `core/cli.mjs`
- Change the import `recoverFor` → `doctorFor`.
- Rename handler `handoffRecover` → `handoffDoctor`, body:
```js
async function handoffDoctor(args) {
  const input = await readInput(args);
  await writeStdout(JSON.stringify(doctorFor(input.cwd || process.cwd()), null, 2) + '\n');
}
```
- In the dispatch map, replace `'handoff:recover': handoffRecover` with `'handoff:doctor': handoffDoctor`.

## Step 5 — rename the skill
`git mv skills/handoff-recover skills/handoff-doctor`, then rewrite `skills/handoff-doctor/SKILL.md`:
```markdown
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
```

## Step 6 — update references
In `tests/skills-present.test.mjs`, change `'skills/handoff-recover/SKILL.md'` → `'skills/handoff-doctor/SKILL.md'`. Then run `git grep -n "handoff:recover\|recoverFor\|handoff-recover"` and update any remaining matches in `tests/` and `README*.md` (e.g. README command tables: `/handoff recover` → `/handoff doctor`). It must return no matches when done. (Note: the handoff-session SKILL.md mentions `handoff:recover` — update it to `handoff:doctor`.)

## Step 7 — run tests
`node --test tests/cli-doctor.test.mjs tests/skills-present.test.mjs` → PASS. Then full `node --test` → no regressions.

## Step 8 — commit
```
git add -A
git commit -m "feat: rename recover to doctor and add basis + cross-fingerprint scan"
```

## Global constraints
Node ≥18, zero deps. `node --test` green. Use `readInput(args)` for CLI input (already in cli.mjs). Do not change unrelated behavior.
