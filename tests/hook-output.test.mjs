import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopContinuationOutput } from '../core/lib/hook-output.mjs';

test('Claude Stop continuation uses hookSpecificOutput.additionalContext', () => {
  assert.deepEqual(stopContinuationOutput('claude-code', 'ask user'), {
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'ask user' },
  });
});

test('Codex Stop continuation uses decision:block', () => {
  assert.deepEqual(stopContinuationOutput('codex', 'ask user'), {
    decision: 'block', reason: 'ask user',
  });
});

test('any non-claude agent uses decision:block', () => {
  assert.deepEqual(stopContinuationOutput('whatever', 'go on'), {
    decision: 'block', reason: 'go on',
  });
});

test('empty or whitespace continuation lets the stop proceed', () => {
  assert.deepEqual(stopContinuationOutput('claude-code', ''), { continue: true });
  assert.deepEqual(stopContinuationOutput('codex', '   '), { continue: true });
  assert.deepEqual(stopContinuationOutput('claude-code', null), { continue: true });
});
