import { readFileSync } from 'node:fs';

// 한 JSONL 줄에서 payload.rate_limits.primary 를 추출. 아니면 null.
export function parseRateLimitLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const p = o?.payload?.rate_limits?.primary;
  if (!p || typeof p.used_percent !== 'number') return null;
  return {
    usedPercent: p.used_percent,
    windowMinutes: p.window_minutes,
    resetsAt: p.resets_at,
    source: 'jsonl',
  };
}

// 파일을 끝에서부터 스캔해 마지막 유효한 rate_limits 줄을 반환. 없으면 null.
export function readJsonlRateLimit(filePath) {
  let text;
  try { text = readFileSync(filePath, 'utf8'); } catch { return null; }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const r = parseRateLimitLine(line);
    if (r) return r;
  }
  return null;
}
