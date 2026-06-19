import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256Hex, sha256OfJson } from '../core/lib/hash.mjs';

test('canonicalJson sorts object keys recursively', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('sha256Hex matches known vector', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256OfJson is stable regardless of key order', () => {
  assert.equal(sha256OfJson({ a: 1, b: 2 }), sha256OfJson({ b: 2, a: 1 }));
});
