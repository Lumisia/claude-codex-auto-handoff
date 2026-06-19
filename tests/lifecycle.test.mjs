import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, canTransition, transition } from '../core/capsule/lifecycle.mjs';

test('legal transitions allowed', () => {
  assert.ok(canTransition(STATES.AVAILABLE, STATES.CLAIMED));
  assert.ok(canTransition(STATES.CLAIMED, STATES.CONSUMED));
  assert.ok(canTransition(STATES.CLAIMED, STATES.AVAILABLE));
  assert.ok(canTransition(STATES.GENERATING, STATES.DEGRADED_AVAILABLE));
});

test('illegal transitions rejected', () => {
  assert.equal(canTransition(STATES.CONSUMED, STATES.CLAIMED), false);
  assert.equal(canTransition(STATES.AVAILABLE, STATES.CONSUMED), false);
});

test('transition returns target or throws', () => {
  assert.equal(transition(STATES.AVAILABLE, STATES.CLAIMED), STATES.CLAIMED);
  assert.throws(() => transition(STATES.CONSUMED, STATES.CLAIMED), /illegal/);
});
