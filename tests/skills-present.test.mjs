import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'skills/handoff-ratelimit/SKILL.md',
  'skills/handoff-session/SKILL.md',
  'skills/handoff-recover/SKILL.md',
  'commands/handoff.md',
  'commands/handoff-status.md',
  'commands/handoff-preview.md',
  'commands/handoff-checkpoint.md',
  'commands/handoff-create.md',
  'commands/handoff-skip.md',
  'commands/handoff-config.md',
];

test('skill/command files exist with frontmatter', () => {
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    assert.match(text, /^---/, `${f} should start with frontmatter`);
    assert.match(text, /description:/, `${f} should have a description`);
  }
});
