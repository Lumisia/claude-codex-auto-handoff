import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../core/lib/config.mjs';
import { checkClaudeUsageMonitor } from '../core/monitors/usage-monitor.mjs';
import { findApproval } from '../core/capsule/approval.mjs';
import { findPendingCapsule } from '../core/capsule/store.mjs';

function withRoot(fn) {
  const previous = process.env.AI_HANDOFF_ROOT;
  process.env.AI_HANDOFF_ROOT = mkdtempSync(join(tmpdir(), 'ah-usage-monitor-'));
  return Promise.resolve(fn()).finally(() => {
    if (previous === undefined) delete process.env.AI_HANDOFF_ROOT;
    else process.env.AI_HANDOFF_ROOT = previous;
  });
}

const reading = {
  usedPercent: 91,
  windowMinutes: 300,
  resetsAt: 9_999_999_999,
  source: 'claude-statusline',
  capturedAt: 1_000,
};

test('ask mode creates one approval and emits Claude AskUserQuestion instructions', async () => withRoot(async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-monitor-project-'));
  const config = loadConfig({});
  config.triggers.five_hour.mode = 'ask';
  config.notification = { method: 'off' };

  const first = await checkClaudeUsageMonitor({
    cwd, config, readSensor: async () => reading, now: 2_000,
  });

  assert.equal(first.action, 'ask');
  assert.match(first.message, /AskUserQuestion/);
  assert.equal(findApproval(first.fingerprint, { now: 2_000 })?.status, 'AWAITING_USER');
  assert.equal(findPendingCapsule(first.fingerprint, { now: 2_000 }), null);

  const second = await checkClaudeUsageMonitor({
    cwd, config, readSensor: async () => reading, now: 3_000,
  });
  assert.equal(second.action, 'none');
  assert.equal(second.reason, 'awaiting-approval');
}));

test('auto mode publishes a degraded capsule immediately and dedupes the window', async () => withRoot(async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-monitor-project-'));
  const config = loadConfig({});
  config.triggers.five_hour.mode = 'auto';
  config.notification = { method: 'off' };

  const first = await checkClaudeUsageMonitor({
    cwd, config, readSensor: async () => ({ ...reading, usedPercent: 94 }), now: 2_000,
  });

  assert.equal(first.action, 'create');
  assert.equal(first.degraded, true);
  assert.match(first.message, /emergency capsule created/i);
  const pending = findPendingCapsule(first.fingerprint, { now: 2_000 });
  assert.equal(pending.state.status, 'DEGRADED_AVAILABLE');
  assert.equal(pending.capsule.source.agent, 'claude-code');
  assert.equal(pending.capsule.target.agent, 'codex');

  const second = await checkClaudeUsageMonitor({
    cwd, config, readSensor: async () => ({ ...reading, usedPercent: 94 }), now: 3_000,
  });
  assert.equal(second.action, 'none');
  assert.equal(second.reason, 'deduped');
}));

test('disabled realtime monitor never reads sensor', async () => withRoot(async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-monitor-project-'));
  const config = loadConfig({});
  config.realtime.enabled = false;
  let reads = 0;

  const result = await checkClaudeUsageMonitor({
    cwd, config, readSensor: async () => { reads++; return reading; }, now: 2_000,
  });

  assert.equal(result.action, 'none');
  assert.equal(result.reason, 'realtime-disabled');
  assert.equal(reads, 0);
}));
