import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newestSessionFile } from '../core/lib/sessions.mjs';

test('returns null when no session files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-sess-'));
  assert.equal(newestSessionFile(dir), null);
});

test('returns the most recently modified rollout file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-sess-'));
  const sub = join(dir, '2026', '06', '19');
  mkdirSync(sub, { recursive: true });
  const older = join(sub, 'rollout-older.jsonl');
  const newer = join(sub, 'rollout-newer.jsonl');
  writeFileSync(older, 'a');
  writeFileSync(newer, 'b');
  utimesSync(older, new Date(1000), new Date(1000));
  utimesSync(newer, new Date(2000), new Date(2000));
  assert.equal(newestSessionFile(dir), newer);
});
