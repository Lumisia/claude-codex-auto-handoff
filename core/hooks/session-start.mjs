import { projectFingerprint } from '../lib/fingerprint.mjs';
import { findPendingCapsule, claimCapsule, consumeCapsule } from '../capsule/store.mjs';

function renderInjection(cap) {
  const t = cap.task || {};
  const p = cap.project || {};
  return [
    '[CURRENT HANDOFF — 현재 작업 상태]',
    `goal: ${t.goal || ''}`,
    `from: ${cap.source && cap.source.agent} → ${cap.target && cap.target.agent}`,
    `branch: ${p.git_branch || ''} @ ${p.git_head || ''}`,
    `next_actions: ${(t.next_actions || []).join('; ')}`,
    '',
    '(capsule은 참고 상태다. 현재 사용자 지시·실제 파일·Git이 우선한다.)',
  ].join('\n');
}

export function handleSessionStart({ input, now = Date.now() }) {
  const cwd = (input && input.cwd) || process.cwd();
  const fp = projectFingerprint(cwd);
  const pending = findPendingCapsule(fp);
  if (!pending || !pending.capsule) return { injected: false, reason: 'no-pending' };

  const c = pending.capsule;
  if (c.expires_at && Date.parse(c.expires_at) < now) return { injected: false, reason: 'expired' };

  const claim = claimCapsule(fp, pending.taskId, { now });
  if (!claim) return { injected: false, reason: 'claim-failed' };

  const context = renderInjection(c);
  consumeCapsule(claim, { now });
  return { injected: true, taskId: pending.taskId, context };
}
