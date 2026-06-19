import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statusFor, previewFor } from '../core/hooks/handoff.mjs';
import { projectFingerprint } from '../core/lib/fingerprint.mjs';
import { publishCapsule, findPendingCapsule } from '../core/capsule/store.mjs';

function withRoot(fn) {
  const prev = process.env.AI_HANDOFF_ROOT;
  process.env.AI_HANDOFF_ROOT = mkdtempSync(join(tmpdir(), 'ah-hq-'));
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AI_HANDOFF_ROOT; else process.env.AI_HANDOFF_ROOT = prev;
  }
}

function cap(fp) {
  return {
    schema_version: '1.0.0', capsule_id: 'c1', task_id: 't-x-dddddddddddd',
    created_at: 'z', source: { agent: 'codex' }, target: { agent: 'claude-code' },
    checkpoint: { status: 'in_progress' }, task: { goal: 'do X', next_actions: ['a'] },
    integrity: { payload_sha256: 'sha256:x' },
  };
}

test('statusFor and previewFor report pending without consuming', () => withRoot(() => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const fp = projectFingerprint(cwd);
  publishCapsule(fp, cap(fp), { now: 1 });
  const s = statusFor(cwd);
  assert.equal(s.pending, true);
  assert.equal(s.state, 'AVAILABLE');
  const p = previewFor(cwd);
  assert.equal(p.goal, 'do X');
  assert.ok(findPendingCapsule(fp));
}));

test('no pending → not pending', () => withRoot(() => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  assert.equal(statusFor(cwd).pending, false);
  assert.equal(previewFor(cwd).pending, false);
}));
