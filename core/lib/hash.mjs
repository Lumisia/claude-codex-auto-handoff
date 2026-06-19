import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(input) {
  const data = typeof input === 'string' ? input : Buffer.from(input);
  return createHash('sha256').update(data).digest('hex');
}

export function sha256OfJson(value) {
  return sha256Hex(canonicalJson(value));
}

export function sha256File(path) {
  return sha256Hex(readFileSync(path));
}
