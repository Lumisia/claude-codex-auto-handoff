import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRateLimitLine } from '../core/sensors/codex-jsonl.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('parses primary 5h rate limit from a token_count line', () => {
  const line = readFileSync(join(here, 'fixtures', 'token_count-line.json'), 'utf8').trim();
  const r = parseRateLimitLine(line);
  assert.deepEqual(r, { usedPercent: 46, windowMinutes: 300, resetsAt: 1781851481, source: 'jsonl' });
});

test('returns null for a line without rate_limits', () => {
  assert.equal(parseRateLimitLine('{"type":"event_msg","payload":{"type":"reasoning"}}'), null);
});

test('returns null for non-json', () => {
  assert.equal(parseRateLimitLine('not json'), null);
});
