import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function json(path) { return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')); }

test('Claude and Codex manifests expose the same plugin version', () => {
  const claude = json('../.claude-plugin/plugin.json');
  const codex = json('../.codex-plugin/plugin.json');
  assert.equal(claude.name, 'ai-handoff');
  assert.equal(codex.name, claude.name);
  assert.equal(codex.version, claude.version);
});

test('both marketplace manifests list the plugin under the repo marketplace name', () => {
  const claudeMarket = json('../.claude-plugin/marketplace.json');
  const codexMarket = json('../.agents/plugins/marketplace.json');
  for (const market of [claudeMarket, codexMarket]) {
    assert.equal(market.name, 'claude-codex-auto-handoff');
    assert.ok(market.plugins.some((entry) => entry.name === 'ai-handoff'));
  }
});

test('shared hooks wire both automatic directions and memory recall', () => {
  const hooks = json('../hooks/hooks.json').hooks;
  assert.ok(hooks.SessionStart);
  assert.ok(hooks.Stop);
  assert.ok(hooks.UserPromptSubmit);
  const commands = JSON.stringify(hooks);
  assert.match(commands, /run-hook\.mjs/);
  assert.match(commands, /CLAUDE_PLUGIN_ROOT/);
});

test('Claude plugin declares an always-on usage monitor with real plugin-root paths', () => {
  const manifest = json('../.claude-plugin/plugin.json');
  assert.equal(manifest.experimental?.monitors, './monitors/monitors.json');
  const monitors = json('../monitors/monitors.json');
  const usage = monitors.find((entry) => entry.name === 'claude-usage-threshold');
  assert.ok(usage, 'usage monitor is declared');
  assert.match(usage.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/usage-monitor\.mjs"$/);
  assert.equal(usage.when ?? 'always', 'always');
  assert.match(usage.description, /Claude 5-hour usage/);
});
