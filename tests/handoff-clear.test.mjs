import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectFingerprint } from '../core/lib/fingerprint.mjs';
import { projectDir, handoffDir } from '../core/lib/paths.mjs';
import { publishCapsule, writeState } from '../core/capsule/store.mjs';
import { buildCapsule } from '../core/capsule/create.mjs';
import { doctorFor } from '../core/hooks/handoff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'core', 'cli.mjs');

function run(args, input, env) {
  return execFileSync(process.execPath, [cli, ...args], {
    input, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

function withRoot(fn) {
  const prev = process.env.AI_HANDOFF_ROOT;
  process.env.AI_HANDOFF_ROOT = mkdtempSync(join(tmpdir(), 'ah-clear-'));
  try { return fn(process.env.AI_HANDOFF_ROOT); } finally {
    if (prev === undefined) delete process.env.AI_HANDOFF_ROOT; else process.env.AI_HANDOFF_ROOT = prev;
  }
}

function capsule(fp, taskId, createdAt) {
  return buildCapsule({
    taskId,
    now: createdAt,
    source: { agent: 'codex' },
    target: { agent: 'claude-code' },
    trigger: { type: 'manual_checkpoint' },
    project: { fingerprint: fp, git_branch: 'main', git_head: 'abc123' },
    checkpoint: { status: 'in_progress' },
    task: { goal: taskId, next_actions: ['continue'] },
  });
}

function publishState(fp, taskId, status, ageDays) {
  const createdAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
  const published = publishCapsule(fp, capsule(fp, taskId, createdAt), { now: Date.parse(createdAt) });
  writeState(published.statePath, { status, task_id: taskId, updated_at: Date.parse(createdAt) });
  return published;
}

test('handoff:clear used purges old used capsules and keeps pending or recent capsules', () => withRoot((root) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const fp = projectFingerprint(cwd);
  const oldConsumed = publishState(fp, 't-clear-old-consumed', 'CONSUMED', 45);
  const oldExpired = publishState(fp, 't-clear-old-expired', 'EXPIRED', 60);
  const recentConsumed = publishState(fp, 't-clear-recent-consumed', 'CONSUMED', 2);
  const pending = publishState(fp, 't-clear-pending', 'AVAILABLE', 45);

  const out = JSON.parse(run(['handoff:clear', 'used', '--older-than', '30d', '--cwd', cwd], '', {
    AI_HANDOFF_ROOT: root,
  }));

  assert.equal(out.cleared, true);
  assert.equal(out.deleted, 2);
  assert.equal(existsSync(oldConsumed.dir), false);
  assert.equal(existsSync(oldExpired.dir), false);
  assert.equal(existsSync(recentConsumed.dir), true);
  assert.equal(existsSync(pending.dir), true);
  assert.equal(doctorFor(cwd).healthy, true);
}));

test('handoff:clear --older-than defaults to used scope', () => withRoot((root) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const fp = projectFingerprint(cwd);
  const oldConsumed = publishState(fp, 't-clear-default-used', 'CONSUMED', 45);

  const out = JSON.parse(run(['handoff:clear', '--older-than', '30d', '--cwd', cwd], '', {
    AI_HANDOFF_ROOT: root,
  }));

  assert.equal(out.scope, 'used');
  assert.equal(out.deleted, 1);
  assert.equal(existsSync(oldConsumed.dir), false);
}));

test('handoff:clear this_project requires confirmation unless -c is supplied', () => withRoot((root) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const fp = projectFingerprint(cwd);
  publishState(fp, 't-clear-project', 'CONSUMED', 45);

  const preview = JSON.parse(run(['handoff:clear', 'this_project', '--cwd', cwd], '', {
    AI_HANDOFF_ROOT: root,
  }));
  assert.equal(preview.confirmationRequired, true);
  assert.equal(preview.cleared, false);
  assert.equal(existsSync(projectDir(fp)), true);

  const cleared = JSON.parse(run(['handoff:clear', 'this_project', '-c', '--cwd', cwd], '', {
    AI_HANDOFF_ROOT: root,
  }));
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.scope, 'this_project');
  assert.equal(cleared.fingerprint, fp);
  assert.equal(existsSync(projectDir(fp)), false);
}));

test('clear.auto.enabled removes old used capsules on SessionStart', () => withRoot((root) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const fp = projectFingerprint(cwd);
  const oldConsumed = publishState(fp, 't-clear-auto-consumed', 'CONSUMED', 45);
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    clear: { auto: { enabled: true }, older_than_days: 30 },
  }));

  run(['hook:session-start', '--agent', 'codex'], JSON.stringify({ cwd, session_id: 's1' }), {
    AI_HANDOFF_ROOT: root,
  });

  assert.equal(existsSync(oldConsumed.dir), false);
}));
