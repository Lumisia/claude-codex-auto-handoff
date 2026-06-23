import { projectFingerprint } from '../lib/fingerprint.mjs';
import { resolveProject } from '../lib/config.mjs';
import { readState, writeState, publishCapsule } from '../capsule/store.mjs';
import { globalStatePath } from '../lib/paths.mjs';
import { dedupeKey, hasSeen, markSeen } from '../lib/dedupe.mjs';
import { evaluateTrigger } from '../hooks/trigger.mjs';
import { saveApproval, findApproval } from '../capsule/approval.mjs';
import { buildCheckpointCapsule } from '../capsule/checkpoint.mjs';
import { appendSample, readSamples } from '../sensors/samples.mjs';
import { askInstruction } from '../lib/i18n.mjs';

const AGENT = 'claude-code';

function monitorDedupeKey({ reading, fingerprint, threshold }) {
  return dedupeKey({
    source: AGENT,
    windowDuration: reading?.windowMinutes,
    resetsAt: reading?.resetsAt,
    projectFingerprint: fingerprint,
    threshold,
  });
}

function askMessage({ usedPercent, threshold, locale }) {
  return `AI handoff: Claude 5-hour usage reached ${usedPercent}% (threshold ${threshold}%). ${askInstruction(AGENT, locale)}`;
}

function createMessage({ taskId, usedPercent }) {
  return `AI handoff: emergency capsule created for Codex at Claude 5-hour usage ${usedPercent}% (taskId: ${taskId}).`;
}

export async function checkClaudeUsageMonitor({
  cwd = process.cwd(),
  config,
  readSensor,
  now = Date.now(),
} = {}) {
  if (!config) throw new Error('config is required');
  if (config.realtime?.enabled === false) return { action: 'none', reason: 'realtime-disabled' };

  const fp = projectFingerprint(cwd);
  const pcfg = resolveProject(config, fp);
  if (pcfg.realtime?.enabled === false) return { action: 'none', reason: 'realtime-disabled', fingerprint: fp };

  const tcfg = pcfg.triggers?.five_hour || {};
  if (tcfg.enabled === false) return { action: 'none', reason: 'disabled', fingerprint: fp };

  const reading = await readSensor();
  if (reading && typeof reading.usedPercent === 'number') {
    appendSample(fp, AGENT, { usedPercent: reading.usedPercent, at: now });
  }

  const threshold = tcfg.threshold_percent ?? 80;
  const dkey = monitorDedupeKey({ reading, fingerprint: fp, threshold });
  const gpath = globalStatePath();
  const gstate = readState(gpath);
  const deduped = hasSeen(gstate, dkey);
  const ev = evaluateTrigger({
    usedPercent: reading?.usedPercent,
    threshold,
    mode: tcfg.mode ?? 'ask',
    deduped,
    samples: readSamples(fp, AGENT),
    burnRate: tcfg.burn_rate && {
      enabled: tcfg.burn_rate.enabled,
      runwayMinutes: tcfg.burn_rate.runway_minutes,
    },
    now,
  });

  if (ev.action === 'none') return { action: 'none', reason: ev.reason, fingerprint: fp };

  if (ev.action === 'ask') {
    const existing = findApproval(fp, { key: dkey, now });
    if (existing) return { action: 'none', reason: 'awaiting-approval', fingerprint: fp, approvalKey: dkey };
    saveApproval({
      fingerprint: fp,
      key: dkey,
      now,
      ttlMs: pcfg.approval?.ttl_ms,
      context: { agent: AGENT, cwd, reading, threshold, realtime: true },
    });
    return {
      action: 'ask',
      reason: ev.reason,
      fingerprint: fp,
      approvalKey: dkey,
      message: askMessage({ usedPercent: reading.usedPercent, threshold, locale: pcfg.locale || 'en' }),
    };
  }

  const sentinel = {
    goal: `emergency checkpoint at ${reading.usedPercent}% Claude 5-hour usage`,
    next_actions: [],
    completed: [],
    open_issues: ['Created automatically by realtime monitor; verify git diff and tests before continuing.'],
    status: 'in_progress',
  };
  const { capsule } = buildCheckpointCapsule({
    sentinel,
    cwd,
    agent: AGENT,
    sessionId: null,
    checkpointKey: dkey,
    now,
    trigger: {
      type: 'rate_limit_realtime',
      threshold_percent: threshold,
      observed_percent: reading.usedPercent,
      measurement_source: reading.source,
    },
  });
  publishCapsule(fp, capsule, { status: 'DEGRADED_AVAILABLE', now });
  writeState(gpath, markSeen(gstate, dkey, now));
  return {
    action: 'create',
    reason: ev.reason,
    fingerprint: fp,
    taskId: capsule.task_id,
    degraded: true,
    message: createMessage({ taskId: capsule.task_id, usedPercent: reading.usedPercent }),
  };
}
