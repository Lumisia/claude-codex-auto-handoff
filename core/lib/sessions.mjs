import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

// sessionsDir 하위를 재귀 탐색해 rollout-*.jsonl 중 mtime 최신 파일 경로를 반환.
export function newestSessionFile(sessionsDir) {
  let best = null;
  let bestMtime = -Infinity;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.startsWith('rollout-') || !e.name.endsWith('.jsonl')) continue;
      const m = statSync(full).mtimeMs;
      if (m > bestMtime) { bestMtime = m; best = full; }
    }
  };
  walk(sessionsDir);
  return best;
}
