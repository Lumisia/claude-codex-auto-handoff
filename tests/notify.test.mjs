import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyCommand, notify } from '../core/lib/notify.mjs';

test('darwin uses osascript', () => {
  const c = notifyCommand('darwin', 'T', 'B');
  assert.equal(c.cmd, 'osascript');
  assert.ok(c.args.join(' ').includes('display notification'));
});

test('linux uses notify-send', () => {
  const c = notifyCommand('linux', 'T', 'B');
  assert.equal(c.cmd, 'notify-send');
  assert.deepEqual(c.args, ['T', 'B']);
});

test('win32 uses powershell', () => {
  const c = notifyCommand('win32', 'T', 'B');
  assert.equal(c.cmd, 'powershell');
});

test('notify never throws and returns a boolean', () => {
  assert.equal(typeof notify('T', 'B'), 'boolean');
});
