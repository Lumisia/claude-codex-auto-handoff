import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installClaudeStatusline, restoreClaudeStatusline, readClaudeStatuslineState,
  runPreviousStatusline, statuslineCommand, isHandoffStatuslineCommand,
  inspectClaudeStatuslineScopes,
} from '../core/setup/claude-statusline.mjs';

function withRoot(fn) {
  const prev = process.env.AI_HANDOFF_ROOT;
  const root = mkdtempSync(join(tmpdir(), 'ah-claude-setup-'));
  process.env.AI_HANDOFF_ROOT = root;
  try { return fn(root); } finally {
    if (prev === undefined) delete process.env.AI_HANDOFF_ROOT; else process.env.AI_HANDOFF_ROOT = prev;
  }
}

test('statusline command uses the install-time Node executable path', () => withRoot(() => {
  const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
  const stable = statuslineCommand('C:/plugin', { nodePath });
  const direct = statuslineCommand('C:/plugin', { stableShim: false, nodePath });

  assert.match(stable, /^"C:\/Program Files\/nodejs\/node\.exe" "/);
  assert.match(stable, /claude-statusline-runner\.mjs/);
  assert.doesNotMatch(stable, /^node /);
  assert.match(direct, /^"C:\/Program Files\/nodejs\/node\.exe" "/);
  assert.match(direct, /core\/cli\.mjs" sensor:claude-statusline$/);
  assert.doesNotMatch(direct, /^node /);
}));

test('install preserves an existing statusLine and is idempotent', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const previous = { type: 'command', command: 'old-status', padding: 2 };
  writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', statusLine: previous }));
  const first = installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  const second = installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.match(settings.statusLine.command, /claude-statusline-runner\.mjs/);
  assert.doesNotMatch(settings.statusLine.command, /core\/cli\.mjs/);
  assert.equal(settings.statusLine.refreshInterval, 15);
  assert.deepEqual(readClaudeStatuslineState().previous, previous);
  assert.equal(first.command, second.command);
}));

test('install writes a stable runner and records the current plugin root', () => withRoot((root) => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const pluginRoot = join(root, 'plugin-cache', 'ai-handoff');
  const result = installClaudeStatusline({ settingsPath, pluginRoot });

  assert.equal(result.installed, true);
  assert.equal(result.stableShim, true);
  assert.ok(result.runnerPath.endsWith('claude-statusline-runner.mjs'));
  assert.ok(existsSync(result.runnerPath));
  assert.ok(result.command.includes('claude-statusline-runner.mjs'));
  assert.ok(!result.command.includes('sensor:claude-statusline'));

  const state = readClaudeStatuslineState();
  assert.equal(state.mode, 'stable-shim');
  assert.equal(state.plugin_root, pluginRoot);
  assert.equal(state.data_root, root);
  assert.equal(state.installed_command, result.command);
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
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  const upgraded = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(upgraded.statusLine.refreshInterval, 15);
  assert.match(upgraded.statusLine.command, /claude-statusline-runner\.mjs/);
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
  const result = installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin' });
  assert.equal(result.installed, true);
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.statusLine.refreshInterval, 15);
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

test('direct install keeps the legacy cache-root command available by opt-in', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const result = installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin', stableShim: false });

  assert.match(result.command, /sensor:claude-statusline/);
  assert.ok(result.command.includes('core/cli.mjs'));
  assert.equal(readClaudeStatuslineState().mode, 'direct');
}));

test('inspect reports a user statusline shadowed by project-local Claude settings', () => withRoot(() => {
  const cwd = mkdtempSync(join(tmpdir(), 'ah-claude-project-'));
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  const userDir = mkdtempSync(join(tmpdir(), 'ah-claude-user-'));
  const userSettingsPath = join(userDir, 'settings.json');
  const localSettingsPath = join(cwd, '.claude', 'settings.local.json');
  const command = statuslineCommand('C:/plugin', { nodePath: 'C:/node/node.exe' });

  writeFileSync(userSettingsPath, JSON.stringify({
    statusLine: { type: 'command', command, refreshInterval: 15 },
  }));
  writeFileSync(localSettingsPath, JSON.stringify({
    statusLine: { type: 'command', command: 'project-status' },
  }));

  const result = inspectClaudeStatuslineScopes({ cwd, userSettingsPath });

  assert.equal(result.userInstalled, true);
  assert.equal(result.shadowed, true);
  assert.equal(result.active.name, 'project-local');
  assert.equal(result.active.path, localSettingsPath);
  assert.match(result.docs.settingsPrecedence, /settings#settings-precedence/);
}));

test('auto install does not overwrite a user-modified statusLine after install', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin-v1' });
  writeFileSync(settingsPath, JSON.stringify({
    statusLine: { type: 'command', command: 'user-status' },
  }));

  const result = installClaudeStatusline({
    settingsPath,
    pluginRoot: 'C:/plugin-v2',
    auto: true,
  });

  assert.equal(result.installed, false);
  assert.equal(result.reason, 'user-modified-statusline');
  assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine.command, 'user-status');
}));

test('restore disables future automatic reinstall', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const previous = { type: 'command', command: 'old-status' };
  writeFileSync(settingsPath, JSON.stringify({ statusLine: previous }));
  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin-v1' });

  assert.equal(restoreClaudeStatusline({ settingsPath }).restored, true);
  assert.equal(readClaudeStatuslineState().disabled, true);

  const result = installClaudeStatusline({
    settingsPath,
    pluginRoot: 'C:/plugin-v2',
    auto: true,
  });

  assert.equal(result.installed, false);
  assert.equal(result.reason, 'disabled-by-restore');
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine, previous);
}));

test('does not chain an old handoff statusLine command as previous', () => withRoot(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ah-claude-settings-'));
  const settingsPath = join(dir, 'settings.json');
  const previous = {
    type: 'command',
    command: 'node "C:/old-plugin/core/cli.mjs" sensor:claude-statusline',
  };
  writeFileSync(settingsPath, JSON.stringify({ statusLine: previous }));

  installClaudeStatusline({ settingsPath, pluginRoot: 'C:/plugin-v2' });

  assert.equal(isHandoffStatuslineCommand(previous.command), true);
  assert.equal(readClaudeStatuslineState().previous, null);
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
