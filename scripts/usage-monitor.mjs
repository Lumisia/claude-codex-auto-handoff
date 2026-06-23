#!/usr/bin/env node
import { loadConfig } from '../core/lib/config.mjs';
import { configPath } from '../core/lib/paths.mjs';
import { readClaudeRateLimit } from '../core/sensors/claude-statusline.mjs';
import { checkClaudeUsageMonitor } from '../core/monitors/usage-monitor.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

async function tick({ cwd, now = Date.now() } = {}) {
  const config = loadConfig({ path: configPath() });
  const result = await checkClaudeUsageMonitor({
    cwd,
    config,
    now,
    readSensor: () => readClaudeRateLimit({
      freshnessMs: config.sensors?.claude?.freshness_ms ?? 10_000,
      now,
    }),
  });
  if (result.message) process.stdout.write(`${result.message.replace(/\r?\n/g, ' ')}\n`);
  return { result, config };
}

const args = process.argv.slice(2);
const cwd = argValue(args, '--cwd', process.env.CLAUDE_PROJECT_DIR || process.cwd());
const once = args.includes('--once');

try {
  if (once) {
    await tick({ cwd });
  } else {
    for (;;) {
      const { config } = await tick({ cwd });
      const waitMs = Math.max(250, config.realtime?.poll_interval_ms ?? 1000);
      await sleep(waitMs);
    }
  }
} catch (error) {
  process.stderr.write(`[handoff-monitor] ${error?.stack || error}\n`);
  process.exit(1);
}
