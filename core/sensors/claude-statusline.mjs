import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { claudeRateLimitDir } from '../lib/paths.mjs';
import { sha256Hex } from '../lib/hash.mjs';
import { writeFileAtomic } from '../lib/fsx.mjs';
import { appendSample } from './samples.mjs';
import { projectFingerprint } from '../lib/fingerprint.mjs';

function samplePath(sessionId) {
  if (!sessionId) return null;
  return join(claudeRateLimitDir(), `${sha256Hex(String(sessionId))}.json`);
}

export function recordClaudeRateLimit(input, { now = Date.now() } = {}) {
  const fiveHour = input?.rate_limits?.five_hour;
  const used = fiveHour?.used_percentage;
  const path = samplePath(input?.session_id);
  if (!path || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) return false;

  writeFileAtomic(path, JSON.stringify({
    session_id: input.session_id,
    used_percent: used,
    resets_at: fiveHour.resets_at ?? null,
    captured_at: now,
  }, null, 2) + '\n');
  const cwd = input.cwd || input.workspace?.current_dir;
  if (cwd) { try { appendSample(projectFingerprint(cwd), 'claude-code', { usedPercent: used, at: now }); } catch {} }
  return true;
}

// A five-hour usage reading stays meaningful for far longer than a couple of
// minutes, and Claude Code only re-renders the status line on events (the
// refreshInterval timer does not always carry rate-limit data), so a tight
// freshness window leaves the Stop hook reading nothing between renders. Use a
// generous default and instead reject readings whose window has already reset
// (a passed-window percentage would belong to the previous five-hour window).
export function readClaudeRateLimit({ sessionId, freshnessMs = 900_000, now = Date.now() } = {}) {
  const path = samplePath(sessionId);
  if (!path) return null;
  let sample;
  try { sample = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (sample.session_id !== sessionId) return null;
  if (typeof sample.captured_at !== 'number' || now - sample.captured_at > freshnessMs) return null;
  if (typeof sample.used_percent !== 'number') return null;
  // resets_at is unix SECONDS; now is ms. Past the reset boundary the sample
  // describes a window that no longer applies.
  if (typeof sample.resets_at === 'number' && now >= sample.resets_at * 1000) return null;
  return {
    usedPercent: sample.used_percent,
    windowMinutes: 300,
    resetsAt: sample.resets_at,
    source: 'claude-statusline',
    capturedAt: sample.captured_at,
  };
}
