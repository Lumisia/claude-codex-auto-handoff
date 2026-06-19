import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRateLimit } from '../core/sensors/ratelimit.mjs';

const app = { usedPercent: 57, windowMinutes: 300, resetsAt: 1781851482, source: 'app-server' };
const js = { usedPercent: 46, windowMinutes: 300, resetsAt: 1781851481, source: 'jsonl' };

test('prefers app-server when available', async () => {
  const r = await readRateLimit({ readApp: async () => app, readJsonl: async () => js });
  assert.equal(r.source, 'app-server');
  assert.equal(r.usedPercent, 57);
});

test('falls back to jsonl when app-server returns null', async () => {
  const r = await readRateLimit({ readApp: async () => null, readJsonl: async () => js });
  assert.equal(r.source, 'jsonl');
});

test('returns unknown when both fail', async () => {
  const r = await readRateLimit({ readApp: async () => null, readJsonl: async () => null });
  assert.deepEqual(r, { source: 'unknown' });
});

test('shadow mode reports mismatch but still returns app-server', async () => {
  let seen = null;
  const r = await readRateLimit({
    readApp: async () => app,
    readJsonl: async () => js,
    shadow: true,
    onMismatch: (a, j) => { seen = { a, j }; },
  });
  assert.equal(r.source, 'app-server');
  assert.ok(seen, 'onMismatch should fire when values differ beyond tolerance');
});

test('app-server thrown error is treated as unavailable', async () => {
  const r = await readRateLimit({ readApp: async () => { throw new Error('boom'); }, readJsonl: async () => js });
  assert.equal(r.source, 'jsonl');
});
