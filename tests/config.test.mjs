import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveProject } from '../core/lib/config.mjs';

test('loadConfig returns defaults when no user file', () => {
  const cfg = loadConfig({ path: join(tmpdir(), '__none__', 'config.json') });
  assert.equal(cfg.triggers.five_hour.threshold_percent, 80);
  assert.equal(cfg.triggers.five_hour.mode, 'ask');
  assert.equal(cfg.sensors.claude.freshness_ms, 10_000);
  assert.equal(cfg.approval.ttl_ms, 900_000);
  assert.equal(cfg.realtime.enabled, true);
  assert.equal(cfg.realtime.poll_interval_ms, 1_000);
});

test('loadConfig deep-merges user overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-cfg-'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify({ triggers: { five_hour: { threshold_percent: 70 } } }));
  const cfg = loadConfig({ path: p });
  assert.equal(cfg.triggers.five_hour.threshold_percent, 70);
  assert.equal(cfg.triggers.five_hour.mode, 'ask');
});

test('resolveProject applies per-project override', () => {
  const cfg = loadConfig({ path: join(tmpdir(), '__none__', 'config.json') });
  cfg.project_overrides = { fp1: { triggers: { five_hour: { mode: 'auto' } } } };
  const r = resolveProject(cfg, 'fp1');
  assert.equal(r.triggers.five_hour.mode, 'auto');
  assert.equal(r.triggers.five_hour.threshold_percent, 80);
});
