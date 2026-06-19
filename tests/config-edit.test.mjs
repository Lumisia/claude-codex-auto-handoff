import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getAt, setAt, unsetAt, validateKeyValue,
  setConfigValue, unsetConfigValue, readUserConfig,
} from '../core/lib/config-edit.mjs';

test('getAt/setAt/unsetAt walk dotted keys without mutating input', () => {
  const base = { a: { b: 1 } };
  const next = setAt(base, 'a.c.d', 2);
  assert.equal(getAt(next, 'a.b'), 1);
  assert.equal(getAt(next, 'a.c.d'), 2);
  assert.equal(base.a.c, undefined, 'input is not mutated');
  const removed = unsetAt(next, 'a.c.d');
  assert.equal(getAt(removed, 'a.c.d'), undefined);
});

test('validateKeyValue enforces enums and coerces numeric/boolean strings', () => {
  assert.equal(validateKeyValue('triggers.five_hour.mode', 'auto'), 'auto');
  assert.throws(() => validateKeyValue('triggers.five_hour.mode', 'sometimes'), /one of: auto, ask, off/);
  assert.equal(validateKeyValue('triggers.five_hour.threshold_percent', '75'), 75);
  assert.throws(() => validateKeyValue('triggers.five_hour.threshold_percent', 150), />= 1|<= 100/);
  assert.equal(validateKeyValue('memory.auto_recall', 'false'), false);
  assert.equal(validateKeyValue('notification.method', 'off'), 'off');
});

test('unknown keys are rejected with the known-key list', () => {
  assert.throws(() => validateKeyValue('triggers.bogus', 1), /unknown config key/);
});

test('setConfigValue writes only the overridden keys; unset removes them', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ah-cfg-')), 'config.json');
  setConfigValue(path, 'triggers.five_hour.mode', 'auto');
  setConfigValue(path, 'notification.method', 'off');
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(written, {
    triggers: { five_hour: { mode: 'auto' } },
    notification: { method: 'off' },
  });
  unsetConfigValue(path, 'notification.method');
  assert.equal(getAt(readUserConfig(path), 'notification.method'), undefined);
  assert.equal(getAt(readUserConfig(path), 'triggers.five_hour.mode'), 'auto');
});

test('setConfigValue rejects an unknown key before writing anything', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ah-cfg-')), 'config.json');
  assert.throws(() => setConfigValue(path, 'nope.nope', 1), /unknown config key/);
  assert.deepEqual(readUserConfig(path), {});
});
