import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, MESSAGES } from '../core/lib/i18n.mjs';

test('t interpolates and falls back to en', () => {
  assert.equal(t('ask.create_or_skip', {}, 'ko'), MESSAGES.ko['ask.create_or_skip']);
  assert.equal(t('ask.create_or_skip', {}, 'xx'), MESSAGES.en['ask.create_or_skip']); // unknown locale
  assert.equal(t('notify.capsule_ready', { agent: 'codex' }, 'en'), MESSAGES.en['notify.capsule_ready'].replace('{agent}', 'codex'));
});

test('every locale defines the same keys as en (completeness)', () => {
  const enKeys = Object.keys(MESSAGES.en).sort();
  for (const loc of ['ko', 'ja', 'zh']) {
    assert.deepEqual(Object.keys(MESSAGES[loc]).sort(), enKeys, `${loc} key set must match en`);
  }
});
