import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  '.claude-plugin/plugin.json', '.codex-plugin/plugin.json',
  '.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json',
  'hooks/hooks.json', 'monitors/monitors.json',
  'scripts/run-hook.mjs', 'scripts/usage-monitor.mjs', 'core/cli.mjs',
  'schemas/capsule.schema.json', 'schemas/memory-shard.schema.json',
];
for (const relative of required) {
  if (!existsSync(join(root, relative))) throw new Error(`missing package file: ${relative}`);
}
const claude = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
const codex = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const hooks = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
const monitors = JSON.parse(readFileSync(join(root, 'monitors/monitors.json'), 'utf8'));
if (claude.name !== codex.name || claude.version !== codex.version || pkg.version !== codex.version) {
  throw new Error('manifest mismatch');
}
if (claude.experimental?.monitors !== './monitors/monitors.json') {
  throw new Error('Claude manifest does not declare monitors/monitors.json');
}
if (!Array.isArray(monitors) || !monitors.some((entry) => entry.name === 'claude-usage-threshold')) {
  throw new Error('missing Claude usage monitor');
}
for (const event of ['SessionStart', 'Stop', 'UserPromptSubmit']) {
  if (!Array.isArray(hooks.hooks?.[event])) throw new Error(`missing hook event: ${event}`);
}
const claudeMarket = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
const codexMarket = JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
for (const [label, market] of [['claude', claudeMarket], ['codex', codexMarket]]) {
  if (market.name !== 'claude-codex-auto-handoff') throw new Error(`${label} marketplace name mismatch`);
  if (!(market.plugins || []).some((entry) => entry.name === claude.name)) {
    throw new Error(`${label} marketplace does not list plugin ${claude.name}`);
  }
}
process.stdout.write(`package valid: ${claude.name}@${claude.version} (marketplace: ${claudeMarket.name})\n`);
