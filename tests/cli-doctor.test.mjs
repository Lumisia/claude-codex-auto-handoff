import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'cli.mjs');
const run = (args, input, env) =>
  execFileSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } });

test('handoff:doctor reports basis and cross-fingerprint pending capsules', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-doc-'));
  const projA = mkdtempSync(join(tmpdir(), 'ah-a-'));
  const projB = mkdtempSync(join(tmpdir(), 'ah-b-'));
  const env = { AI_HANDOFF_ROOT: root };
  run(['handoff:checkpoint', '--agent', 'codex', '--cwd', projA],
    JSON.stringify({ session_id: 's', sentinel: { goal: 'find me', next_actions: ['x'] } }), env);
  const out = JSON.parse(run(['handoff:doctor', '--cwd', projB], '', env));
  assert.equal(out.basis.type, 'path');
  assert.equal(out.pending, null);
  assert.equal(out.otherPending.length, 1);
  assert.equal(out.otherPending[0].goal, 'find me');
});
