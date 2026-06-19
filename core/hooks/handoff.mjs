import { projectFingerprint } from '../lib/fingerprint.mjs';
import { findPendingCapsule } from '../capsule/store.mjs';

export function statusFor(cwd) {
  const fp = projectFingerprint(cwd);
  const p = findPendingCapsule(fp);
  return {
    fingerprint: fp,
    pending: !!(p && p.capsule),
    taskId: p && p.taskId,
    state: p && p.state && p.state.status,
  };
}

export function previewFor(cwd) {
  const fp = projectFingerprint(cwd);
  const p = findPendingCapsule(fp);
  if (!p || !p.capsule) return { pending: false };
  const c = p.capsule;
  return {
    pending: true,
    taskId: p.taskId,
    goal: c.task && c.task.goal,
    source: c.source && c.source.agent,
    next_actions: (c.task && c.task.next_actions) || [],
  };
}
