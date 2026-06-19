import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSessionStart } from '../core/hooks/session-start.mjs';
import { projectFingerprint } from '../core/lib/fingerprint.mjs';
import { publishCapsule } from '../core/capsule/store.mjs';

function withRoot(fn) {
  const prev = process.env.AI_HANDOFF_ROOT;
  process.env.AI_HANDOFF_ROOT = mkdtempSync(join(tmpdir(), 'ah-ss-'));
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AI_HANDOFF_ROOT; else process.env.AI_HANDOFF_ROOT = prev;
  }
}

function cap(fp) {
  return {
    schema_version: '1.0.0', capsule_id: 'c1', task_id: 't-x-cccccccccccc',
    created_at: 'z', source: { agent: 'codex' }, target: { agent: 'claude-code' },
    project: { fingerprint: fp, git_branch: 'main', git_head: 'abc123' },
    checkpoint: { status: 'in_progress' },
    task: { goal: 'fix the thing', next_actions: ['run tests'] },
    integrity: { payload_sha256: 'sha256:x' },
  };
}

test('injects pending capsule then consumes it', () => withRoot(() => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const fp = projectFingerprint(cwd);
  publishCapsule(fp, cap(fp), { now: 1 });
  const r = handleSessionStart({ input: { cwd }, now: 10 });
  assert.equal(r.injected, true);
  assert.match(r.context, /fix the thing/);
  assert.match(r.context, /CURRENT HANDOFF/);
  assert.equal(handleSessionStart({ input: { cwd }, now: 11 }).injected, false);
}));

test('no pending capsule → not injected', () => withRoot(() => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  assert.equal(handleSessionStart({ input: { cwd }, now: 1 }).injected, false);
}));
