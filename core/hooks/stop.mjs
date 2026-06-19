import { projectFingerprint } from '../lib/fingerprint.mjs';
import { gitContext } from '../lib/gitctx.mjs';
import { evaluateTrigger } from './trigger.mjs';
import { resolveProject } from '../lib/config.mjs';
import { instanceKey, deriveTaskId } from '../lib/taskid.mjs';
import { buildCapsule } from '../capsule/create.mjs';
import { publishCapsule, readState, writeState } from '../capsule/store.mjs';
import { dedupeKey, hasSeen, markSeen } from '../lib/dedupe.mjs';
import { globalStatePath } from '../lib/paths.mjs';

export async function handleStop({ input, config, readSensor, agent, now = Date.now() }) {
  const cwd = input.cwd || process.cwd();
  const fp = projectFingerprint(cwd);
  const tcfg = resolveProject(config, fp).triggers.five_hour;
  const reading = await readSensor();

  const gpath = globalStatePath();
  const gstate = readState(gpath);
  const dkey = dedupeKey({
    source: agent,
    windowDuration: reading && reading.windowMinutes,
    resetsAt: reading && reading.resetsAt,
    sessionId: input.session_id,
    projectFingerprint: fp,
    threshold: tcfg.threshold_percent,
  });
  const deduped = hasSeen(gstate, dkey);

  const ev = evaluateTrigger({
    usedPercent: reading && reading.usedPercent,
    threshold: tcfg.threshold_percent,
    mode: tcfg.mode,
    deduped,
  });
  if (ev.action === 'none') return { action: 'none', reason: ev.reason, fingerprint: fp };

  // ask/create 모두 같은 window 재트리거 방지 위해 seen 기록
  writeState(gpath, markSeen(gstate, dkey, now));
  if (ev.action === 'ask') return { action: 'ask', reason: ev.reason, fingerprint: fp };

  const git = gitContext(cwd);
  const goal = `auto checkpoint at ${reading.usedPercent}% (${git.branch || 'no-branch'})`;
  const taskId = deriveTaskId({
    projectFingerprint: fp,
    instanceKey: instanceKey({ agent, sessionId: input.session_id }),
    goalSlug: goal,
  });
  const capsule = buildCapsule({
    taskId,
    now: new Date(now).toISOString(),
    source: { agent, session_id: input.session_id },
    target: { agent: agent === 'codex' ? 'claude-code' : 'codex' },
    trigger: { type: 'rate_limit', threshold_percent: tcfg.threshold_percent, observed_percent: reading.usedPercent, measurement_source: reading.source },
    project: { fingerprint: fp, git_branch: git.branch, git_head: git.head, working_tree_dirty: git.dirty },
    checkpoint: { status: 'in_progress' },
    task: { goal, next_actions: [] },
  });
  publishCapsule(fp, capsule, { status: 'AVAILABLE', now });
  return { action: 'create', reason: ev.reason, taskId, fingerprint: fp };
}
