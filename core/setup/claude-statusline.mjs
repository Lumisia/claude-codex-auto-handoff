import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeFileAtomic } from '../lib/fsx.mjs';
import { claudeStatuslineStatePath } from '../lib/paths.mjs';

export function defaultClaudeSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

function readJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
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

export function readClaudeStatuslineState() {
  return readJson(claudeStatuslineStatePath(), null);
}

export function statuslineCommand(pluginRoot) {
  const cli = join(pluginRoot, 'core', 'cli.mjs').replaceAll('\\', '/');
  return `node "${cli}" sensor:claude-statusline`;
}

export function installClaudeStatusline({
  settingsPath = defaultClaudeSettingsPath(), pluginRoot, refreshInterval = 2,
} = {}) {
  if (!pluginRoot) throw new Error('pluginRoot is required');
  const settings = readSettings(settingsPath);
  const command = statuslineCommand(pluginRoot);
  const existingState = readClaudeStatuslineState();
  // refreshInterval re-runs the status line command every N seconds, so the
  // rate-limit sample the Stop hook reads back stays fresh between turns
  // (https://code.claude.com/docs/en/statusline). Omit it when not positive.
  const desired = refreshInterval > 0
    ? { type: 'command', command, refreshInterval }
    : { type: 'command', command };
  const commandMatches = settings.statusLine?.command === command;
  if (!commandMatches) {
    const relocating = existingState && settings.statusLine?.command === existingState.installed_command;
    const previous = relocating ? existingState.previous : (settings.statusLine ?? null);
    writeFileAtomic(claudeStatuslineStatePath(), JSON.stringify({
      version: 1, settings_path: settingsPath, previous, installed_command: command,
    }, null, 2) + '\n');
    settings.statusLine = desired;
    writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } else {
    // Command is already ours. Re-create the reversible backup if it went
    // missing (older build, or a data root that changed) so re-running setup
    // self-heals instead of dead-ending the user, then re-assert the desired
    // statusLine (e.g. backfill a refreshInterval an older build never wrote).
    if (!existingState) {
      writeFileAtomic(claudeStatuslineStatePath(), JSON.stringify({
        version: 1, settings_path: settingsPath, previous: null, installed_command: command,
      }, null, 2) + '\n');
    }
    if (JSON.stringify(settings.statusLine) !== JSON.stringify(desired)) {
      settings.statusLine = desired;
      writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    }
  }
  return { installed: true, command, settingsPath, refreshInterval };
}

export function restoreClaudeStatusline({ settingsPath } = {}) {
  const state = readClaudeStatuslineState();
  if (!state) return { restored: false, reason: 'no-install-state' };
  const path = settingsPath || state.settings_path;
  const settings = readSettings(path);
  if (settings.statusLine?.command !== state.installed_command) {
    if (JSON.stringify(settings.statusLine ?? null) === JSON.stringify(state.previous)) {
      return { restored: false, reason: 'already-restored', settingsPath: path };
    }
    throw new Error('refusing to overwrite a statusLine changed after installation');
  }
  if (state.previous === null) delete settings.statusLine;
  else settings.statusLine = state.previous;
  writeFileAtomic(path, JSON.stringify(settings, null, 2) + '\n');
  return { restored: true, settingsPath: path };
}

export function runPreviousStatusline(rawInput, { spawn = spawnSync } = {}) {
  const command = readClaudeStatuslineState()?.previous?.command;
  if (!command) return '';
  const result = spawn(command, {
    shell: true, input: rawInput, encoding: 'utf8', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`previous statusLine exited ${result.status}: ${result.stderr || ''}`);
  return result.stdout || '';
}
