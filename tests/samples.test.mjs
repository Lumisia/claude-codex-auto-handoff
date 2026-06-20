import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('appendSample keeps the last N samples in order', async () => {
  process.env.AI_HANDOFF_ROOT = mkdtempSync(join(tmpdir(), 'ah-smp-'));
  const { appendSample, readSamples } = await import('../core/sensors/samples.mjs');
  for (let i = 0; i < 8; i++) appendSample('fp', 'codex', { usedPercent: i * 10, at: i * 1000 }, { max: 6 });
  const s = readSamples('fp', 'codex');
  assert.equal(s.length, 6);
  assert.equal(s[0].usedPercent, 20);                 // oldest kept
  assert.equal(s[s.length - 1].usedPercent, 70);      // newest
  delete process.env.AI_HANDOFF_ROOT;
});
