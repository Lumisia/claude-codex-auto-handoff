import {
  openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync,
  existsSync, readFileSync, unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';

export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, typeof data === 'string' ? data : Buffer.from(data));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

// 단일 사용자·로컬용 best-effort lease lock.
export function acquireLock(lockPath, { leaseMs = 30000, now = Date.now() } = {}) {
  if (existsSync(lockPath)) {
    let expiresAt = 0;
    try { expiresAt = JSON.parse(readFileSync(lockPath, 'utf8')).expiresAt || 0; } catch {}
    if (expiresAt > now) return null;
  }
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileAtomic(lockPath, JSON.stringify({ token, expiresAt: now + leaseMs }));
  try {
    if (JSON.parse(readFileSync(lockPath, 'utf8')).token === token) return { token, lockPath };
  } catch {}
  return null;
}

export function releaseLock(lock) {
  if (!lock) return;
  try {
    const cur = JSON.parse(readFileSync(lock.lockPath, 'utf8'));
    if (cur.token === lock.token) unlinkSync(lock.lockPath);
  } catch {}
}
