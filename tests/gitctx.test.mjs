import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitContext } from '../core/lib/gitctx.mjs';

test('non-git dir reports is_git false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-git-'));
  assert.deepEqual(gitContext(dir), { is_git: false, branch: null, head: null, dirty: null });
});

test('git dir reports head and dirty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-git-'));
  const run = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  run(['init']);
  run(['config', 'user.email', 't@t']);
  run(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'x');
  run(['add', '.']);
  run(['commit', '-m', 'init']);
  const ctx = gitContext(dir);
  assert.equal(ctx.is_git, true);
  assert.match(ctx.head, /^[0-9a-f]{12}$/);
  assert.equal(ctx.dirty, false);
  writeFileSync(join(dir, 'b.txt'), 'y');
  assert.equal(gitContext(dir).dirty, true);
});
