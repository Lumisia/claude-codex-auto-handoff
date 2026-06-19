import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sha256File } from '../lib/hash.mjs';

function toPosix(p) { return p.split(sep).join('/'); }

export function buildManifest(projectDir, { now = Date.now() } = {}) {
  const files = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files[toPosix(relative(projectDir, full))] = sha256File(full);
    }
  };
  if (existsSync(projectDir) && statSync(projectDir).isDirectory()) walk(projectDir);
  return { version: now, files };
}

export function diffManifest(oldM, newM) {
  const o = (oldM && oldM.files) || {};
  const n = (newM && newM.files) || {};
  const changed = [];
  for (const [p, h] of Object.entries(n)) {
    if (!(p in o)) changed.push({ path: p, status: 'NEW' });
    else if (o[p] !== h) changed.push({ path: p, status: 'MODIFIED' });
  }
  for (const p of Object.keys(o)) {
    if (!(p in n)) changed.push({ path: p, status: 'DELETED' });
  }
  return changed;
}
