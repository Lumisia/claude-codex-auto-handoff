import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeFileAtomic } from '../lib/fsx.mjs';
import { claudeStatuslineStatePath, dataRoot } from '../lib/paths.mjs';

export function defaultClaudeSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

function readJson(path, fallback = {}) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readSettings(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch (error) {
    throw new Error(`invalid Claude settings JSON: ${error.message}`);
  }
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function slashPath(path) {
  return String(path).replaceAll('\\', '/');
}

function quoteForStatuslineCommand(path) {
  return `"${slashPath(path).replaceAll('"', '\\"')}"`;
}

export function stableClaudeStatuslineRunnerPath() {
  return join(dataRoot(), 'claude-statusline-runner.mjs');
}

export function readClaudeStatuslineState() {
  return readJson(claudeStatuslineStatePath(), null);
}

export function isHandoffStatuslineCommand(command) {
  return (
    typeof command === 'string'
    && (
      command.includes('sensor:claude-statusline')
      || command.includes('claude-statusline-runner.mjs')
    )
  );
}

export function statuslineCommand(pluginRoot, { stableShim = true } = {}) {
  if (stableShim) return `node ${quoteForStatuslineCommand(stableClaudeStatuslineRunnerPath())}`;
  const cli = join(pluginRoot, 'core', 'cli.mjs');
  return `node ${quoteForStatuslineCommand(cli)} sensor:claude-statusline`;
}

function stableRunnerSource() {
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function readStatuslineInput() {
  if (process.stdin.isTTY) return '{}';
  try {
    return readFileSync(0, 'utf8').replace(/^\\uFEFF/, '');
  } catch {
    return '{}';
  }
}

function readState() {
  const here = dirname(fileURLToPath(import.meta.url));
  const statePath = join(here, 'claude-statusline.json');
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

const raw = readStatuslineInput();
const state = readState();

if (!state || !state.plugin_root) {
  process.exit(0);
}

const cli = join(state.plugin_root, 'core', 'cli.mjs');

if (!existsSync(cli)) {
  process.stderr.write('[handoff] Claude statusline plugin root is stale: ' + cli + '\\n');
  process.exit(0);
}

const env = { ...process.env };

if (state.data_root) {
  env.AI_HANDOFF_ROOT = state.data_root;
}

env.AI_HANDOFF_STABLE_STATUSLINE = '1';

const child = spawnSync(
  process.execPath,
  [cli, 'sensor:claude-statusline'],
  {
    input: raw || '{}',
    encoding: 'utf8',
    env,
    windowsHide: true
  }
);

if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);

if (child.error) {
  process.stderr.write('[handoff] Claude statusline runner failed: ' + child.error.message + '\\n');
  process.exit(0);
}

process.exit(child.status ?? 0);
`;
}

function writeStableRunner() {
  const runnerPath = stableClaudeStatuslineRunnerPath();
  writeFileAtomic(runnerPath, stableRunnerSource());
  return runnerPath;
}

function desiredStatusLine(command, refreshInterval) {
  return refreshInterval > 0
    ? { type: 'command', command, refreshInterval }
    : { type: 'command', command };
}

function stateWithUpdate(state, patch) {
  return {
    ...(state || {}),
    ...patch,
    updated_at: new Date().toISOString(),
  };
}

function writeState(state) {
  writeFileAtomic(claudeStatuslineStatePath(), JSON.stringify(state, null, 2) + '\n');
}

function previousStatusLineForInstall({ settings, existingState, command }) {
  const current = settings.statusLine ?? null;

  if (current?.command === command) return existingState?.previous ?? null;
  if (existingState && current?.command === existingState.installed_command) return existingState.previous ?? null;
  if (isHandoffStatuslineCommand(current?.command)) return existingState?.previous ?? null;

  return current;
}

function shouldSkipAutoInstall({ settings, existingState, command }) {
  if (!existingState) return null;
  if (existingState.disabled) return 'disabled-by-restore';

  const current = settings.statusLine ?? null;

  if (current?.command === command) return null;
  if (current?.command === existingState.installed_command) return null;
  if (sameJson(current, existingState.previous ?? null)) return 'already-restored';

  return 'user-modified-statusline';
}

export function installClaudeStatusline({
  settingsPath = defaultClaudeSettingsPath(),
  pluginRoot,
  refreshInterval = 2,
  stableShim = true,
  auto = false,
  force = false,
} = {}) {
  if (process.env.AI_HANDOFF_NO_AUTO_STATUSLINE === '1' && auto) {
    return { installed: false, reason: 'disabled-by-env' };
  }
  if (!pluginRoot) throw new Error('pluginRoot is required');

  const settings = readSettings(settingsPath);
  const command = statuslineCommand(pluginRoot, { stableShim });
  const existingState = readClaudeStatuslineState();

  if (auto && !force) {
    const skipReason = shouldSkipAutoInstall({ settings, existingState, command });
    if (skipReason) return { installed: false, reason: skipReason, settingsPath };
  }

  const runnerPath = stableShim ? writeStableRunner() : null;
  const desired = desiredStatusLine(command, refreshInterval);
  const previous = previousStatusLineForInstall({ settings, existingState, command });
  const nextState = stateWithUpdate(existingState, {
    version: 2,
    mode: stableShim ? 'stable-shim' : 'direct',
    settings_path: settingsPath,
    data_root: dataRoot(),
    runner_path: runnerPath,
    plugin_root: pluginRoot,
    previous,
    installed_command: command,
    refresh_interval: refreshInterval,
    disabled: false,
  });

  const changed = !sameJson(settings.statusLine ?? null, desired);
  if (changed) {
    settings.statusLine = desired;
    writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
  writeState(nextState);

  return {
    installed: true,
    changed,
    command,
    settingsPath,
    runnerPath,
    stableShim,
    refreshInterval,
  };
}

export function restoreClaudeStatusline({ settingsPath } = {}) {
  const state = readClaudeStatuslineState();
  if (!state) return { restored: false, reason: 'no-install-state' };

  const path = settingsPath || state.settings_path || defaultClaudeSettingsPath();
  const settings = readSettings(path);
  const current = settings.statusLine ?? null;
  const previous = state.previous ?? null;

  if (current?.command !== state.installed_command) {
    if (sameJson(current, previous)) {
      writeState(stateWithUpdate(state, {
        disabled: true,
        disabled_reason: 'already-restored',
      }));
      return { restored: false, reason: 'already-restored', settingsPath: path };
    }
    throw new Error('refusing to overwrite a statusLine changed after installation');
  }

  if (previous === null) delete settings.statusLine;
  else settings.statusLine = previous;

  writeFileAtomic(path, JSON.stringify(settings, null, 2) + '\n');
  writeState(stateWithUpdate(state, {
    disabled: true,
    disabled_reason: 'restore',
    restored_at: new Date().toISOString(),
  }));

  return { restored: true, settingsPath: path };
}

export function runPreviousStatusline(rawInput, { spawn = spawnSync } = {}) {
  const command = readClaudeStatuslineState()?.previous?.command;
  if (!command) return '';
  if (isHandoffStatuslineCommand(command)) return '';

  const result = spawn(command, {
    shell: true,
    input: rawInput,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`previous statusLine exited ${result.status}: ${result.stderr || ''}`);
  return result.stdout || '';
}
