import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectFingerprint, projectFingerprintInfo } from '../core/lib/fingerprint.mjs';

test('fingerprint is deterministic and 24 hex chars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-fp-'));
  const a = projectFingerprint(dir);
  const b = projectFingerprint(dir);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{24}$/);
});

test('different dirs give different fingerprints', () => {
  const d1 = mkdtempSync(join(tmpdir(), 'ah-fp-'));
  const d2 = mkdtempSync(join(tmpdir(), 'ah-fp-'));
  assert.notEqual(projectFingerprint(d1), projectFingerprint(d2));
});

test('projectFingerprintInfo reports a path basis for a non-repo dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-fp-'));
  const info = projectFingerprintInfo(dir);
  assert.equal(info.basis.type, 'path');
  assert.match(info.basis.value, /^path:/);
  assert.equal(info.fingerprint.length, 24);
});
