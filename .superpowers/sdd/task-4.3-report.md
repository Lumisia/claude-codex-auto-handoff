# Task 4.3 Report — Wire samples + burn-rate into handleStop

## Per-file changes

### `core/hooks/stop.mjs`
- Added import: `import { appendSample, readSamples } from '../sensors/samples.mjs';`
- In the live trigger path (after `const reading = await readSensor();`), added a guard that calls `appendSample(fp, agent, { usedPercent: reading.usedPercent, at: now })` when `reading.usedPercent` is a number.
- Expanded the `evaluateTrigger` call to pass `samples: readSamples(fp, agent)`, `burnRate: tcfg.burn_rate && { enabled: tcfg.burn_rate.enabled, runwayMinutes: tcfg.burn_rate.runway_minutes }`, and `now`. The `tcfg.burn_rate &&` guard keeps `burnRate` as `undefined` (evaluateTrigger ignores it) when the config key is absent.

### `core/sensors/claude-statusline.mjs`
- Added imports: `import { appendSample } from './samples.mjs';` and `import { projectFingerprint } from '../lib/fingerprint.mjs';`
- In `recordClaudeRateLimit`, just before the final `return true;`, added:
  ```js
  const cwd = input.cwd || input.workspace?.current_dir;
  if (cwd) { try { appendSample(projectFingerprint(cwd), 'claude-code', { usedPercent: used, at: now }); } catch {} }
  ```

### `tests/burn-rate-stop.test.mjs` (new)
- Created per the brief: exercises `handleStop` with a pre-seeded sample (60% at t-10min) and a live reading of 80%, threshold 95%, runway 30 min.
- Expected result: `action === 'ask'`, `reason === 'burn-rate'`.

## Test commands and output

### Failing run (before implementation)
```
node --test tests/burn-rate-stop.test.mjs

✖ handleStop fires on burn-rate below threshold when enabled (101.5853ms)
AssertionError: Expected values to be strictly equal:
'none' !== 'ask'
tests: 1, fail: 1
```

### Passing run (after implementation)
```
node --test tests/burn-rate-stop.test.mjs

✔ handleStop fires on burn-rate below threshold when enabled (132.695ms)
tests: 1, pass: 1
```

### Full suite
```
node --test

ℹ tests 167
ℹ pass 166
ℹ fail 0
ℹ skipped 1  (pre-existing: reads live rate limit from codex app-server)
```

## Concerns

None. The `tcfg.burn_rate &&` guard correctly leaves `burnRate` as `undefined` for all existing test configs that omit the field, keeping existing stop tests green. The `stop_hook_active` branch was not touched.
