export function evaluateTrigger({ usedPercent, threshold, mode, deduped }) {
  if (mode === 'off') return { action: 'none', reason: 'off' };
  if (typeof usedPercent !== 'number') return { action: 'none', reason: 'unknown' };
  if (usedPercent < threshold) return { action: 'none', reason: 'below' };
  if (deduped) return { action: 'none', reason: 'deduped' };
  return { action: mode === 'auto' ? 'create' : 'ask', reason: 'threshold' };
}
