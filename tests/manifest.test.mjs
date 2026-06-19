import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, diffManifest } from '../core/project/manifest.mjs';

test('buildManifest hashes files with posix relative keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-man-'));
  mkdirSync(join(dir, 'references'), { recursive: true });
  writeFileSync(join(dir, 'format.md'), 'A');
  writeFileSync(join(dir, 'references', 'rules.md'), 'B');
  const m = buildManifest(dir);
  assert.ok(m.files['format.md']);
  assert.ok(m.files['references/rules.md']);
});

test('diffManifest reports NEW, MODIFIED, DELETED', () => {
  const oldM = { files: { 'a.md': 'h1', 'gone.md': 'h2' } };
  const newM = { files: { 'a.md': 'h1x', 'b.md': 'h3' } };
  const changed = diffManifest(oldM, newM);
  const byPath = Object.fromEntries(changed.map((c) => [c.path, c.status]));
  assert.equal(byPath['a.md'], 'MODIFIED');
  assert.equal(byPath['b.md'], 'NEW');
  assert.equal(byPath['gone.md'], 'DELETED');
});
