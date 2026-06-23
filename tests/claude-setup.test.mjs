import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installClaudeStatusline, restoreClaudeStatusline, readClaudeStatuslineState,
  runPreviousStatusline, statuslineCommand,
} from '../core/setup/claude-statusline.mjs';

function withRoot(fn) {
  const prev = process.env.AI_HANDOFF_ROOT;
  const root = mkdtempSync(join(tmpdir(), 'ah-claude-setup-'));
  process.env.AI_HANDOFF_ROOT = root;
  try { return fn(root); } finally {
    if (prev === undefined) delete process.env.AI_HANDOFF_ROOT; else process.env.AI_HANDOFF_ROOT = prev;
  }
}

test('install preserves an existing statusLine and is idempotent', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const previous = { type: 'command', command: 'old-status', padding: 2 };
  writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', statusLine: previous }));
  const first = installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  const second = installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.match(settings.statusLine.command, /sensor:claude-statusline/);
  assert.deepEqual(readClaudeStatuslineState().previous, previous);
  assert.equal(first.command, second.command);
}));

test('re-running install backfills a refreshInterval missing from an older install', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const previous = { type: 'command', command: 'old-status' };
  writeFileSync(settingsPath, JSON.stringify({ statusLine: previous }));
  // Simulate an install from a plugin version that predates refreshInterval:
  // same command, but no refreshInterval written.
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin', refreshInterval: 0 });
  assert.equal('refreshInterval' in JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine, false);
  // Upgrading and re-running setup must add the refreshInterval even though the
  // command string is unchanged (the alreadyInstalled short-circuit used to skip it).
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin', refreshInterval: 30 });
  const upgraded = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(upgraded.statusLine.refreshInterval, 30);
  assert.match(upgraded.statusLine.command, /sensor:claude-statusline/);
  // The reversible backup must still point at the user's original statusLine.
  assert.deepEqual(readClaudeStatuslineState().previous, previous);
}));

test('re-running install self-heals a missing reversible backup instead of throwing', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const command = statuslineCommand('C:/plugin');
  // statusLine is already ours, but the reversible backup state file was never
  // written (older build, or installed under a different data root).
  writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command } }));
  assert.equal(readClaudeStatuslineState(), null);
  const result = installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin', refreshInterval: 30 });
  assert.equal(result.installed, true);
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.statusLine.refreshInterval, 30);
  assert.equal(settings.statusLine.command, command);
  // The backup is recreated; restore then simply removes our statusLine.
  const state = readClaudeStatuslineState();
  assert.equal(state.previous, null);
  assert.equal(state.installed_command, command);
  restoreClaudeStatusline({ settingsPath });
  assert.equal('statusLine' in JSON.parse(readFileSync(settingsPath, 'utf8')), false);
}));

test('re-running install applies a changed --refresh-interval without touching the backup', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'old-status' } }));
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin', refreshInterval: 30 });
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin', refreshInterval: 60 });
  assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine.refreshInterval, 60);
  restoreClaudeStatusline({ settingsPath });
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine, { type: 'command', command: 'old-status' });
}));

test('restore reinstates the previous statusLine exactly', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const previous = { type: 'command', command: 'old-status' };
  writeFileSync(settingsPath, JSON.stringify({ statusLine: previous }));
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  restoreClaudeStatusline({ settingsPath });
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine, previous);
}));

test('restore removes statusLine when none existed before install', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }));
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  restoreClaudeStatusline({ settingsPath });
  assert.equal('statusLine' in JSON.parse(readFileSync(settingsPath, 'utf8')), false);
}));

test('previous statusLine command receives the original JSON and its output is preserved', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'old-status' } }));
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  const seen = [];
  const output = runPreviousStatusline('{"session_id":"s"}', {
    spawn(command, options) {
      seen.push({ command, options });
      return { status: 0, stdout: 'OLD\n', stderr: '' };
    },
  });
  assert.equal(output, 'OLD\n');
  assert.equal(seen[0].command, 'old-status');
  assert.equal(seen[0].options.input, '{"session_id":"s"}');
}));

test('relocating the plugin preserves the original statusLine backup', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const previous = { type: 'command', command: 'old-status' };
  writeFileSync(settingsPath, JSON.stringify({ statusLine: previous }));
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/old-plugin' });
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/new-plugin' });
  assert.deepEqual(readClaudeStatuslineState().previous, previous);
  restoreClaudeStatusline({ settingsPath });
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine, previous);
}));

test('restore is idempotent after the original statusLine is back', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'old-status' } }));
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  restoreClaudeStatusline({ settingsPath });
  assert.equal(restoreClaudeStatusline({ settingsPath }).restored, false);
}));

test('install refuses to overwrite malformed Claude settings JSON', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, '{broken');
  assert.throws(() => installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' }), /invalid Claude settings JSON/);
  assert.equal(readFileSync(settingsPath, 'utf8'), '{broken');
}));
