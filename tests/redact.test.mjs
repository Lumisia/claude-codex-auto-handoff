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

test('redacts bearer, JWT, cookie, and credential assignments', () => {
  const input = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz cookie=sessionid123456 password=supersecret123 abcdefgh.verylongpayload.signaturevalue';
  const r = redactText(input);
  assert.equal(r.count, 4);
  assert.equal(r.text.includes('supersecret123'), false);
  assert.equal(r.text.includes('sessionid123456'), false);
});

test('redacts a modern openai project key (sk-proj-)', () => {
  const r = redactText('key sk-proj-AbCdEf012345_678-9012345678 end');
  assert.match(r.text, /\[REDACTED\]/);
  assert.equal(r.text.includes('sk-proj-AbCdEf'), false);
  assert.equal(r.count, 1);
});

test('redacts a github fine-grained PAT (github_pat_)', () => {
  const r = redactText('token github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789 end');
  assert.match(r.text, /\[REDACTED\]/);
  assert.equal(r.text.includes('github_pat_11ABCDEFG'), false);
  assert.equal(r.count, 1);
});

test('redactJson redacts a value under a sensitive key even when it matches no pattern', () => {
  // "password":"short" defeats the flat text patterns (the quote sits between
  // the key and the colon); structural key redaction must still catch it.
  const { value, count } = redactJson({ password: 'short', config: { api_key: 'x' }, keep: 'ok' });
  assert.equal(value.password, '[REDACTED]');
  assert.equal(value.config.api_key, '[REDACTED]');
  assert.equal(value.keep, 'ok');
  assert.equal(count, 2);
});

test('redactJson catches camelCase secret keys but spares benign key/id fields', () => {
  const { value } = redactJson({
    accessToken: 'shortsecret', clientSecret: 'x', apiKey: 'y',
    publicKey: 'safe-not-a-secret', sessionId: 'keep-me', tokenCount: 7,
  });
  assert.equal(value.accessToken, '[REDACTED]');
  assert.equal(value.clientSecret, '[REDACTED]');
  assert.equal(value.apiKey, '[REDACTED]');
  assert.equal(value.publicKey, 'safe-not-a-secret'); // public keys are not secrets
  assert.equal(value.sessionId, 'keep-me');           // an id is not a secret
  assert.equal(value.tokenCount, 7);                  // "…Count" must not match "token"
});

test('redactJson handles secret-prefixed compounds and never corrupts non-string values', () => {
  const { value } = redactJson({
    privateKeyPem: 'BEGINKEYMATERIAL', clientSecretValue: 'abc', accessTokenHeader: 'bearer-x',
    requiresAuthorization: true, retries: 3, credentials: { password: 'p' },
  });
  assert.equal(value.privateKeyPem, '[REDACTED]');
  assert.equal(value.clientSecretValue, '[REDACTED]');
  assert.equal(value.accessTokenHeader, '[REDACTED]');
  assert.equal(value.requiresAuthorization, true); // boolean preserved, not stringified
  assert.equal(value.retries, 3);
  assert.equal(value.credentials.password, '[REDACTED]'); // nested object still walked
});
