import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('handoff:doctor reports Claude user statusline shadowed by project-local settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-doc-'));
  const home = mkdtempSync(join(tmpdir(), 'ah-doc-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ah-doc-proj-'));
  const pluginRoot = join(root, 'plugin-cache', 'ai-handoff');
  const env = { AI_HANDOFF_ROOT: root, HOME: home, USERPROFILE: home, LOCALAPPDATA: home };

  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({
    statusLine: { type: 'command', command: 'project-status' },
  }));

  run(['setup:claude-statusline', '--plugin-root', pluginRoot], '', env);
  const out = JSON.parse(run(['handoff:doctor', '--cwd', cwd], '', env));

  assert.equal(out.claudeStatusline.userInstalled, true);
  assert.equal(out.claudeStatusline.shadowed, true);
  assert.equal(out.claudeStatusline.active.name, 'project-local');
  assert.match(out.claudeStatusline.docs.settingsPrecedence, /settings#settings-precedence/);
  assert.ok(out.warnings.some((w) => w.type === 'claude-statusline-shadowed'));
});

test('handoff:doctor --fix-statusline installs user settings and reports remaining shadowing', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-doc-'));
  const home = mkdtempSync(join(tmpdir(), 'ah-doc-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ah-doc-proj-'));
  const env = { AI_HANDOFF_ROOT: root, HOME: home, USERPROFILE: home, LOCALAPPDATA: home };

  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({
    statusLine: { type: 'command', command: 'project-status' },
  }));

  const out = JSON.parse(run(['handoff:doctor', '--fix-statusline', '--cwd', cwd], '', env));
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));

  assert.equal(out.fixStatusline.installed, true);
  assert.match(settings.statusLine.command, /claude-statusline-runner\.mjs/);
  assert.equal(settings.statusLine.refreshInterval, 15);
  assert.equal(out.claudeStatusline.userInstalled, true);
  assert.equal(out.claudeStatusline.shadowed, true);
  assert.equal(out.claudeStatusline.active.name, 'project-local');
});
