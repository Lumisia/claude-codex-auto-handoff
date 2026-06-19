import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleStop } from '../core/hooks/stop.mjs';
import { projectFingerprint } from '../core/lib/fingerprint.mjs';
import { findPendingCapsule } from '../core/capsule/store.mjs';
import { loadConfig } from '../core/lib/config.mjs';

function withRoot(fn) {
  const prev = process.env.AI_HANDOFF_ROOT;
  process.env.AI_HANDOFF_ROOT = mkdtempSync(join(tmpdir(), 'ah-stop-'));
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.AI_HANDOFF_ROOT; else process.env.AI_HANDOFF_ROOT = prev;
  });
}

const cfgAuto = loadConfig({});
cfgAuto.triggers.five_hour.mode = 'auto';

const reading = { usedPercent: 85, windowMinutes: 300, resetsAt: 111, source: 'app-server' };

test('auto over threshold creates and publishes a capsule', async () => {
  await withRoot(async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
    const r = await handleStop({ input: { session_id: 's1', cwd }, config: cfgAuto, readSensor: async () => reading, agent: 'codex', now: 1000 });
    assert.equal(r.action, 'create');
    const fp = projectFingerprint(cwd);
    assert.equal(r.fingerprint, fp);
    assert.ok(findPendingCapsule(fp));
  });
});

test('second Stop in same window is deduped to none', async () => {
  await withRoot(async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
    const args = { input: { session_id: 's1', cwd }, config: cfgAuto, readSensor: async () => reading, agent: 'codex', now: 1000 };
    await handleStop(args);
    const r2 = await handleStop({ ...args, now: 2000 });
    assert.equal(r2.action, 'none');
    assert.equal(r2.reason, 'deduped');
  });
});

test('below threshold does nothing', async () => {
  await withRoot(async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
    const r = await handleStop({ input: { session_id: 's2', cwd }, config: cfgAuto, readSensor: async () => ({ ...reading, usedPercent: 10 }), agent: 'codex', now: 1 });
    assert.equal(r.action, 'none');
  });
});
