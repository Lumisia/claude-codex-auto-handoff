import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyCommand, notify, sendNotification } from '../core/lib/notify.mjs';

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

test('sendNotification off delivers nothing', () => {
  let os = 0; let term = 0;
  const r = sendNotification('T', 'B', { method: 'off' },
    { osNotify: () => { os++; return true; }, toTerminal: () => { term++; } });
  assert.equal(r, false);
  assert.equal(os, 0);
  assert.equal(term, 0);
});

test('sendNotification terminal writes to the terminal, not the OS', () => {
  let os = 0; let term = 0;
  const r = sendNotification('T', 'B', { method: 'terminal' },
    { osNotify: () => { os++; return true; }, toTerminal: () => { term++; } });
  assert.equal(r, true);
  assert.equal(os, 0);
  assert.equal(term, 1);
});

test('sendNotification os falls back to terminal when the OS notifier fails', () => {
  let term = 0;
  const r = sendNotification('T', 'B', { method: 'os', fallback: 'terminal' },
    { osNotify: () => false, toTerminal: () => { term++; } });
  assert.equal(r, true);
  assert.equal(term, 1);
});
