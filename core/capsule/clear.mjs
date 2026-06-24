import {
  existsSync, readdirSync, readFileSync, rmSync, statSync,
} from 'node:fs';
import {
  basename, join, relative, resolve,
} from 'node:path';
import { dataRoot, handoffDir, projectDir } from '../lib/paths.mjs';
import { projectFingerprint } from '../lib/fingerprint.mjs';
import { acquireLock, releaseLock } from '../lib/fsx.mjs';
import { appendHistory } from './history.mjs';
import { readState } from './store.mjs';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CLEAR_OLDER_THAN_DAYS = 30;

const STATUS_SCOPES = {
  pending: new Set(['AVAILABLE', 'DEGRADED_AVAILABLE']),
  consumed: new Set(['CONSUMED']),
  expired: new Set(['EXPIRED']),
  used: new Set(['CONSUMED', 'EXPIRED', 'REJECTED', 'SKIPPED', 'FAILED']),
};

export function normalizeClearScope(scope) {
  const s = String(scope || '').trim().toLowerCase().replaceAll('-', '_');
  const aliases = {
    consume: 'consumed',
    consumed: 'consumed',
    expired: 'expired',
    pending: 'pending',
    used: 'used',
    this_project: 'this_project',
    project: 'this_project',
  };
  return aliases[s] || s;
}

export function parseOlderThan(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value * DAY_MS;
  const text = String(value).trim().toLowerCase();
  const m = text.match(/^(\d+(?:\.\d+)?)(ms|m|h|d)?$/);
  if (!m) throw new Error(`invalid --older-than value: ${value}`);
  const n = Number(m[1]);
  const unit = m[2] || 'd';
  if (unit === 'ms') return n;
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  return n * DAY_MS;
}

export function configuredOlderThanMs(config = {}) {
  const days = Number(config.clear?.older_than_days ?? DEFAULT_CLEAR_OLDER_THAN_DAYS);
  return (Number.isFinite(days) ? days : DEFAULT_CLEAR_OLDER_THAN_DAYS) * DAY_MS;
}

function readCapsuleCreatedAt(dir) {
  try {
    const cap = JSON.parse(readFileSync(join(dir, 'capsule.json'), 'utf8'));
    const t = Date.parse(cap.created_at);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

function taskRows(fingerprint) {
  const hd = handoffDir(fingerprint);
  let names = [];
  try { names = readdirSync(hd); } catch { return []; }
  return names.flatMap((taskId) => {
    const dir = join(hd, taskId);
    try { if (!statSync(dir).isDirectory()) return []; } catch { return []; }
    const statePath = join(dir, 'state.json');
    const state = readState(statePath);
    const createdMs = readCapsuleCreatedAt(dir)
      ?? (typeof state.updated_at === 'number' ? state.updated_at : null)
      ?? statSync(dir).mtimeMs;
    return [{ taskId, dir, statePath, status: state.status, createdMs }];
  });
}

export function summarizeProjectState(fingerprint) {
  const root = projectDir(fingerprint);
  const rows = taskRows(fingerprint);
  const byStatus = {};
  for (const row of rows) byStatus[row.status || 'UNKNOWN'] = (byStatus[row.status || 'UNKNOWN'] || 0) + 1;
  return {
    fingerprint,
    path: root,
    exists: existsSync(root),
    capsules: rows.length,
    byStatus,
  };
}

function assertSafeProjectTarget(fingerprint, target) {
  if (!/^[0-9a-f]{24}$/.test(fingerprint)) throw new Error(`refusing to clear invalid fingerprint: ${fingerprint}`);
  const projectsRoot = resolve(dataRoot(), 'projects');
  const resolved = resolve(target);
  const rel = relative(projectsRoot, resolved);
  if (rel.startsWith('..') || rel === '' || resolve(projectsRoot, rel) !== resolved || basename(resolved) !== fingerprint) {
    throw new Error(`refusing to clear path outside project store: ${target}`);
  }
}

export function clearProjectState({ cwd, confirmed = false } = {}) {
  const fingerprint = projectFingerprint(cwd || process.cwd());
  const target = projectDir(fingerprint);
  const summary = summarizeProjectState(fingerprint);
  if (!confirmed) {
    return {
      cleared: false,
      confirmationRequired: true,
      scope: 'this_project',
      fingerprint,
      path: target,
      summary,
    };
  }
  assertSafeProjectTarget(fingerprint, target);
  rmSync(target, { recursive: true, force: true });
  return {
    cleared: true,
    confirmationRequired: false,
    scope: 'this_project',
    fingerprint,
    path: target,
    summary,
  };
}

export function clearCapsules({
  cwd, scope = 'used', olderThanMs = null, now = Date.now(),
} = {}) {
  const normalizedScope = normalizeClearScope(scope);
  const statuses = STATUS_SCOPES[normalizedScope];
  if (!statuses) throw new Error(`unknown clear scope: ${scope}`);
  const fingerprint = projectFingerprint(cwd || process.cwd());
  const hd = handoffDir(fingerprint);
  const candidates = taskRows(fingerprint).filter((row) => {
    if (!statuses.has(row.status)) return false;
    if (olderThanMs != null && now - row.createdMs < olderThanMs) return false;
    return true;
  });
  const publishLock = acquireLock(join(hd, '.publish.lock'), { now });
  if (!publishLock) return {
    cleared: false, scope: normalizedScope, fingerprint, deleted: 0, skipped: candidates.length, reason: 'publish-locked',
  };
  const deleted = [];
  const skipped = [];
  try {
    for (const row of candidates) {
      const claimLock = acquireLock(join(row.dir, '.claim.lock'), { now });
      if (!claimLock) { skipped.push({ taskId: row.taskId, reason: 'claim-locked' }); continue; }
      try {
        const fresh = readState(row.statePath);
        if (!statuses.has(fresh.status)) {
          skipped.push({ taskId: row.taskId, reason: 'state-changed', status: fresh.status });
          continue;
        }
        rmSync(row.dir, { recursive: true, force: true });
        appendHistory(fingerprint, {
          event: 'purged',
          taskId: row.taskId,
          status: fresh.status,
          scope: normalizedScope,
        }, { now });
        deleted.push({ taskId: row.taskId, status: fresh.status });
      } finally {
        releaseLock(claimLock);
      }
    }
  } finally {
    releaseLock(publishLock);
  }
  return {
    cleared: deleted.length > 0,
    scope: normalizedScope,
    fingerprint,
    olderThanMs,
    deleted: deleted.length,
    skipped: skipped.length,
    deletedTasks: deleted,
    skippedTasks: skipped,
  };
}

export function clearSummary({ cwd, config = {} } = {}) {
  const fingerprint = projectFingerprint(cwd || process.cwd());
  return {
    cleared: false,
    scope: 'summary',
    defaultOlderThanDays: Number(config.clear?.older_than_days ?? DEFAULT_CLEAR_OLDER_THAN_DAYS),
    autoEnabled: config.clear?.auto?.enabled === true,
    summary: summarizeProjectState(fingerprint),
    usage: [
      'handoff clear pending',
      'handoff clear consumed',
      'handoff clear expired',
      'handoff clear used [--older-than 7d]',
      'handoff clear this_project [-c]',
    ],
  };
}
