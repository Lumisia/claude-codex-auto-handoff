import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrigger } from '../core/hooks/trigger.mjs';

test('below threshold → none', () => {
  assert.equal(evaluateTrigger({ usedPercent: 50, threshold: 80, mode: 'auto', deduped: false }).action, 'none');
});
test('off mode → none', () => {
  assert.equal(evaluateTrigger({ usedPercent: 90, threshold: 80, mode: 'off', deduped: false }).action, 'none');
});
test('auto over threshold → create', () => {
  assert.equal(evaluateTrigger({ usedPercent: 85, threshold: 80, mode: 'auto', deduped: false }).action, 'create');
});
test('ask over threshold → ask', () => {
  assert.equal(evaluateTrigger({ usedPercent: 85, threshold: 80, mode: 'ask', deduped: false }).action, 'ask');
});
test('deduped → none', () => {
  assert.equal(evaluateTrigger({ usedPercent: 85, threshold: 80, mode: 'auto', deduped: true }).action, 'none');
});
test('unknown usedPercent → none', () => {
  assert.equal(evaluateTrigger({ usedPercent: undefined, threshold: 80, mode: 'auto', deduped: false }).action, 'none');
});
