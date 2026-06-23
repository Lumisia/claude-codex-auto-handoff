import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRootSplitRisk } from '../core/lib/rootcheck.mjs';

const claudePkgs = () => ['SomeVendor.App_8wekyb', 'Claude_pzs8sxrjxfjjc', 'Microsoft.Foo'];

test('non-Windows platforms never warn', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(detectRootSplitRisk({ platform, aiHandoffRoot: undefined, listPackages: claudePkgs }), null);
  }
});

test('an explicit AI_HANDOFF_ROOT means both agents are already unified', () => {
  assert.equal(detectRootSplitRisk({
    platform: 'win32', aiHandoffRoot: 'C:/Users/me/ai-handoff-store', listPackages: claudePkgs,
  }), null);
});

// `aiHandoffRoot: ''` is how the tests say "env var unset" without leaking the
// real process.env through the destructuring default (which fires on undefined).
test('Windows + no root + a Claude MSIX package present warns with an actionable fix', () => {
  const r = detectRootSplitRisk({ platform: 'win32', aiHandoffRoot: '', listPackages: claudePkgs });
  assert.ok(r, 'expected a finding');
  assert.equal(r.code, 'windows-store-split-risk');
  assert.equal(r.severity, 'warn');
  assert.match(r.recommendation, /AI_HANDOFF_ROOT/);
  assert.equal(r.detail.claudePackage, 'Claude_pzs8sxrjxfjjc');
});

test('Windows + no root but no Claude package does not cry wolf', () => {
  assert.equal(detectRootSplitRisk({
    platform: 'win32', aiHandoffRoot: '', listPackages: () => ['Microsoft.Foo', 'OtherApp_123'],
  }), null);
  assert.equal(detectRootSplitRisk({
    platform: 'win32', aiHandoffRoot: '', listPackages: () => [],
  }), null);
});

test('an empty-string AI_HANDOFF_ROOT is treated as unset', () => {
  const r = detectRootSplitRisk({ platform: 'win32', aiHandoffRoot: '', listPackages: claudePkgs });
  assert.ok(r, 'empty root must not count as unified');
  assert.equal(r.code, 'windows-store-split-risk');
});
