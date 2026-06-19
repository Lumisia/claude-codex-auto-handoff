import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactJson } from '../core/lib/redact.mjs';

test('redacts an openai-style key', () => {
  const r = redactText('token sk-abcdef012345678901234567890 end');
  assert.match(r.text, /\[REDACTED\]/);
  assert.equal(r.count, 1);
});

test('clean text is unchanged with count 0', () => {
  const r = redactText('nothing secret here');
  assert.equal(r.text, 'nothing secret here');
  assert.equal(r.count, 0);
});

test('redactJson preserves structure and counts redactions', () => {
  const { value, count } = redactJson({ note: 'ghp_abcdefghijklmnopqrstuvwxyz0123', ok: 1 });
  assert.equal(value.ok, 1);
  assert.match(value.note, /\[REDACTED\]/);
  assert.equal(count, 1);
});
