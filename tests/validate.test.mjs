import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../core/lib/validate.mjs';

const schema = {
  type: 'object',
  required: ['name', 'status'],
  properties: {
    name: { type: 'string' },
    status: { type: 'string', enum: ['in_progress', 'blocked', 'completed'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

test('valid object passes', () => {
  assert.deepEqual(validate({ name: 'x', status: 'blocked', tags: ['a'] }, schema), { valid: true, errors: [] });
});

test('missing required field fails', () => {
  const r = validate({ name: 'x' }, schema);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('status')));
});

test('enum violation fails', () => {
  const r = validate({ name: 'x', status: 'nope' }, schema);
  assert.equal(r.valid, false);
});

test('wrong item type fails', () => {
  const r = validate({ name: 'x', status: 'blocked', tags: [1] }, schema);
  assert.equal(r.valid, false);
});
