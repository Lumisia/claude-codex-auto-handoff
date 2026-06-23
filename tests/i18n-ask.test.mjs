import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askInstruction } from '../core/lib/i18n.mjs';

test('Claude ask instruction drives AskUserQuestion and maps Yes/No/Other', () => {
  for (const locale of ['en', 'ko']) {
    const msg = askInstruction('claude-code', locale);
    assert.match(msg, /AskUserQuestion/);
    assert.match(msg, /\/handoff create/);
    assert.match(msg, /\/handoff skip/);
  }
  // Claude relies on AskUserQuestion's auto-added Other — the instruction must
  // tell the model NOT to add its own Other option.
  assert.match(askInstruction('claude-code', 'en'), /do not add your own/i);
  assert.match(askInstruction('claude-code', 'ko'), /기타.*직접 넣지 마세요|직접 넣지 마세요.*기타/);
});

test('Codex ask instruction uses request_user_input and keeps Other client-side', () => {
  const en = askInstruction('codex', 'en');
  assert.match(en, /request_user_input/);
  assert.match(en, /Do not add an "Other" option/);
  assert.match(en, /unavailable or refused/i); // text fallback path
  assert.match(en, /\/handoff create/);
  assert.match(en, /\/handoff skip/);

  const ko = askInstruction('codex', 'ko');
  assert.match(ko, /request_user_input/);
  assert.match(ko, /기타.*직접 넣지 마세요|직접 넣지 마세요.*기타/);
});

test('both agents instruct the model to summarize before create, and not to pre-decide', () => {
  for (const agent of ['claude-code', 'codex']) {
    const msg = askInstruction(agent, 'en');
    assert.match(msg, /summarize/i);
    assert.match(msg, /do not/i);
  }
});
