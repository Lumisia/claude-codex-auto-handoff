# Task 1.1 — Expose fingerprint basis

You are implementing ONE task in the ai-handoff repo (Node ≥18, zero runtime deps, ES modules `.mjs`, tests via `node:test`). Follow TDD exactly: failing test → run (see it fail) → implement → run (see it pass) → commit.

## Files
- Modify: `core/lib/fingerprint.mjs`
- Test: `tests/fingerprint.test.mjs`

## Goal / Produces
`projectFingerprintInfo(cwd) -> { fingerprint, basis: { type: 'remote'|'gitroot'|'path', value } }`. `projectFingerprint(cwd)` must keep returning the same 24-char string as before (now via the new function).

## Current `core/lib/fingerprint.mjs`
It has `git(cwd, args)` helper, imports `realpathSync` from `node:fs` and `sha256Hex` from `./hash.mjs`. `projectFingerprint(cwd)` computes a basis string (`remote:<url>` if git remote, else `gitroot:<realpath>`, else `path:<realpath>`) and returns `sha256Hex(basis).slice(0,24)`. Preserve that exact basis-string format so existing fingerprints do not change.

## Step 1 — failing test (append to `tests/fingerprint.test.mjs`)
```js
import { projectFingerprintInfo } from '../core/lib/fingerprint.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('projectFingerprintInfo reports a path basis for a non-repo dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-fp-'));
  const info = projectFingerprintInfo(dir);
  assert.equal(info.basis.type, 'path');
  assert.match(info.basis.value, /^path:/);
  assert.equal(info.fingerprint.length, 24);
});
```
(If `test`/`assert` are already imported at the top of the file, do not duplicate those imports — only add what's missing. Check the file first.)

## Step 2 — run, expect FAIL
`node --test tests/fingerprint.test.mjs` → fails (projectFingerprintInfo not exported).

## Step 3 — implement
Replace `projectFingerprint` in `core/lib/fingerprint.mjs` with:
```js
export function projectFingerprintInfo(cwd) {
  let basis = null;
  const url = git(cwd, ['config', '--get', 'remote.origin.url']);
  if (url) basis = { type: 'remote', value: 'remote:' + url };
  if (!basis) {
    const root = git(cwd, ['rev-parse', '--show-toplevel']);
    if (root) {
      let resolved = root;
      try { resolved = realpathSync(root); } catch {}
      basis = { type: 'gitroot', value: 'gitroot:' + resolved };
    }
  }
  if (!basis) {
    let resolved = cwd;
    try { resolved = realpathSync(cwd); } catch {}
    basis = { type: 'path', value: 'path:' + resolved };
  }
  return { fingerprint: sha256Hex(basis.value).slice(0, 24), basis };
}

export function projectFingerprint(cwd) {
  return projectFingerprintInfo(cwd).fingerprint;
}
```
Keep the `git` helper and imports intact.

## Step 4 — run, expect PASS
`node --test tests/fingerprint.test.mjs` → all pass. Also run the full suite `node --test` to confirm no regression (existing fingerprints unchanged).

## Step 5 — commit
```
git add core/lib/fingerprint.mjs tests/fingerprint.test.mjs
git commit -m "refactor: expose fingerprint basis via projectFingerprintInfo"
```

## Global constraints
Node ≥18, zero runtime deps (stdlib only). Do not touch other files. `node --test` must stay green.
