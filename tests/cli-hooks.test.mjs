import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectFingerprint } from '../core/lib/fingerprint.mjs';
import { buildMemoryShard, storeMemoryShard } from '../core/memory/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'core', 'cli.mjs');

function run(args, input, env) {
  return execFileSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('hook:session-start with no pending prints empty context', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-cli-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const out = run(['hook:session-start'], JSON.stringify({ cwd }), { AI_HANDOFF_ROOT: root });
  assert.equal(out.trim(), '');
});

test('hook:session-start does not auto-fetch a pending capsule by default', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-cli-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const env = { AI_HANDOFF_ROOT: root };
  run(['handoff:checkpoint', '--agent', 'claude-code'], JSON.stringify({
    cwd, session_id: 'claude-s', sentinel: { goal: 'manual only' },
  }), env);

  const out = run(['hook:session-start', '--agent', 'codex'], JSON.stringify({
    cwd, session_id: 'codex-s',
  }), env);

  assert.equal(out.trim(), '');
  assert.equal(JSON.parse(run(['handoff:status'], JSON.stringify({ cwd }), env)).pending, true);
});

test('hook:session-start auto-fetches a pending capsule when explicitly enabled', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-cli-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const env = { AI_HANDOFF_ROOT: root };
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    handoff: { session_start_auto_fetch: true },
  }));
  run(['handoff:checkpoint', '--agent', 'claude-code'], JSON.stringify({
    cwd, session_id: 'claude-s', sentinel: { goal: 'automatic fetch enabled' },
  }), env);

  const out = run(['hook:session-start', '--agent', 'codex'], JSON.stringify({
    cwd, session_id: 'codex-s',
  }), env);

  assert.match(out, /automatic fetch enabled/);
  run(['hook:user-prompt', '--agent', 'codex'], JSON.stringify({
    cwd, session_id: 'codex-s', prompt: 'continue',
  }), env);
  assert.equal(JSON.parse(run(['handoff:status'], JSON.stringify({ cwd }), env)).pending, false);
});

test('Claude SessionStart auto-installs the stable statusline runner without stdout noise', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-cli-'));
  const home = mkdtempSync(join(tmpdir(), 'ah-home-'));
  const pluginRoot = join(root, 'plugin-cache', 'ai-handoff');
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));

  const out = run(['hook:session-start', '--agent', 'claude-code'], JSON.stringify({ cwd }), {
    AI_HANDOFF_ROOT: root,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: home,
  });

  assert.equal(out.trim(), '');

  const settingsPath = join(home, '.claude', 'settings.json');
  const statePath = join(root, 'claude-statusline.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  assert.match(settings.statusLine.command, /claude-statusline-runner\.mjs/);
  assert.doesNotMatch(settings.statusLine.command, /plugin-cache/);
  assert.equal(settings.statusLine.refreshInterval, 2);
  assert.equal(state.plugin_root, pluginRoot);
  assert.ok(existsSync(state.runner_path));
});

test('hook:stop off mode is a no-op and exits 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-cli-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const out = run(['hook:stop', '--agent', 'codex', '--mode', 'off'], JSON.stringify({ session_id: 's', cwd }), {
    AI_HANDOFF_ROOT: root, AH_NO_APPSERVER: '1', CODEX_HOME: join(root, '__none__'),
  });
  assert.deepEqual(JSON.parse(out), { continue: true });
});

test('hook:user-prompt injects relevant verified memory only once', () => {
  const root = mkdtempSync(join(tmpdir(), 'ah-cli-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ah-proj-'));
  const previous = process.env.AI_HANDOFF_ROOT;
  process.env.AI_HANDOFF_ROOT = root;
  try {
    const fp = projectFingerprint(cwd);
    storeMemoryShard(fp, buildMemoryShard({
      fingerprint: fp, fact: 'OAuth tokens rotate', tags: ['oauth'],
      evidence: [{ type: 'test', value: 'auth passed' }],
    }));
  } finally {
    if (previous === undefined) delete process.env.AI_HANDOFF_ROOT;
    else process.env.AI_HANDOFF_ROOT = previous;
  }
  const input = JSON.stringify({ cwd, session_id: 's', prompt: 'oauth' });
  const env = { AI_HANDOFF_ROOT: root };
  assert.match(run(['hook:user-prompt', '--agent', 'codex'], input, env), /OAuth tokens/);
  assert.equal(run(['hook:user-prompt', '--agent', 'codex'], input, env), '');
});
