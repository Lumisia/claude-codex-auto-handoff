import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { handoffDir } from '../lib/paths.mjs';
import { writeFileAtomic, acquireLock, releaseLock, withLock } from '../lib/fsx.mjs';

export const DEFAULT_APPROVAL_TTL_MS = 900_000;

function approvalPath(fingerprint) { return join(handoffDir(fingerprint), 'approval-state.json'); }

function readApprovals(fingerprint) {
  try { return JSON.parse(readFileSync(approvalPath(fingerprint), 'utf8')); }
  catch { return { approvals: {} }; }
}

function mutate(fingerprint, fn, now) {
  const path = approvalPath(fingerprint);
  const lock = acquireLock(`${path}.lock`, { now });
  if (!lock) throw new Error('approval state is locked');
  try {
    const state = readApprovals(fingerprint);
    const result = fn(state);
    writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n');
    return result;
  } finally {
    releaseLock(lock);
  }
}

export function saveApproval({ fingerprint, key, context, now = Date.now(), ttlMs = DEFAULT_APPROVAL_TTL_MS }) {
  return mutate(fingerprint, (state) => {
    const approvalTtlMs = Number.isFinite(ttlMs) ? ttlMs : DEFAULT_APPROVAL_TTL_MS;
    const entry = {
      key,
      status: 'AWAITING_USER',
      context,
      created_at: now,
      expires_at: approvalTtlMs > 0 ? now + approvalTtlMs : null,
      updated_at: now,
    };
    state.approvals[key] = entry;
    return entry;
  }, now);
}

function isExpired(entry, now) {
  if (!entry || now == null) return false;
  if (typeof entry.expires_at === 'number') return now >= entry.expires_at;
  if (typeof entry.updated_at === 'number') return now - entry.updated_at >= DEFAULT_APPROVAL_TTL_MS;
  return false;
}

export function findApproval(fingerprint, { key, now = Date.now() } = {}) {
  const entries = Object.values(readApprovals(fingerprint).approvals || {})
    .filter((entry) => entry.status === 'AWAITING_USER' && (!key || entry.key === key))
    .filter((entry) => !isExpired(entry, now))
    .sort((a, b) => b.updated_at - a.updated_at);
  return entries[0] || null;
}

// Move a GENERATING approval back to AWAITING_USER so a failed capsule build or
// publish does not permanently consume the approval. findApproval only returns
// AWAITING_USER entries, so without this a publish failure silently strands the
// user with neither a capsule nor a retryable approval.
//
// This is itself an error-path recovery, so it must not throw on lock
// contention (that would mask the original failure AND leave the approval
// stranded in GENERATING). Unlike `mutate` it retries the lock with backoff and
// returns the restored entry, or null if it could not restore.
export function restoreApprovalForRetry(fingerprint, { key, now = Date.now() }) {
  const path = approvalPath(fingerprint);
  let restored = null;
  withLock(`${path}.lock`, () => {
    const state = readApprovals(fingerprint);
    const current = state.approvals?.[key];
    if (!current || current.status !== 'GENERATING') return;
    restored = { ...current, status: 'AWAITING_USER', updated_at: now };
    state.approvals[key] = restored;
    writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n');
  });
  return restored;
}

export function resolveApproval(fingerprint, { key, decision, now = Date.now() }) {
  const status = decision === 'create' ? 'GENERATING' : decision === 'skip' ? 'SKIPPED' : null;
  if (!status) throw new Error(`invalid approval decision: ${decision}`);
  return mutate(fingerprint, (state) => {
    const current = state.approvals?.[key];
    if (!current || current.status !== 'AWAITING_USER') throw new Error('approval is not awaiting user');
    if (isExpired(current, now)) throw new Error('approval is expired');
    const resolved = { ...current, status, updated_at: now };
    state.approvals[key] = resolved;
    return resolved;
  }, now);
}
