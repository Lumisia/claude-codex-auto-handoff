import { join } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { writeFileAtomic } from '../lib/fsx.mjs';
import { projectDir } from '../lib/paths.mjs';

function samplesPath(fingerprint, agent) {
  return join(projectDir(fingerprint), `samples-${agent}.json`);
}

export function readSamples(fingerprint, agent) {
  try {
    const v = JSON.parse(readFileSync(samplesPath(fingerprint, agent), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function appendSample(fingerprint, agent, { usedPercent, at = Date.now() }, { max = 6 } = {}) {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return;
  try { mkdirSync(projectDir(fingerprint), { recursive: true }); } catch {}
  const next = [...readSamples(fingerprint, agent), { usedPercent, at }].slice(-max);
  writeFileAtomic(samplesPath(fingerprint, agent), JSON.stringify(next, null, 2) + '\n');
}
