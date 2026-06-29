import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  '.claude-plugin/plugin.json', '.codex-plugin/plugin.json',
  '.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json',
  'scripts/install.sh',
  'skills/handoff-checkpoint/SKILL.md',
  'skills/handoff-doctor/SKILL.md',
  'skills/handoff-config/SKILL.md',
  'schemas/capsule.schema.json', 'schemas/memory-shard.schema.json',
];
for (const relative of required) {
  if (!existsSync(join(root, relative))) throw new Error(`missing package file: ${relative}`);
}
const claude = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
const codex = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (claude.name !== codex.name || claude.version !== codex.version || pkg.version !== codex.version) {
  throw new Error('manifest mismatch');
}
if (claude.experimental?.monitors || codex.hooks) {
  throw new Error('source plugin must not expose legacy v1 monitors or hook templates');
}
for (const skill of ['handoff-checkpoint', 'handoff-doctor', 'handoff-config']) {
  const text = readFileSync(join(root, 'skills', skill, 'SKILL.md'), 'utf8');
  if (!text.startsWith('---') || !text.includes('name:') || !text.includes('description:')) {
    throw new Error(`invalid skill frontmatter: ${skill}`);
  }
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
