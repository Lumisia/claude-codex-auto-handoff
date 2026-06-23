// Stop-hook continuation output, shaped per agent. Both Claude Code and Codex
// keep the model going after a Stop, but through different documented fields:
//   - Codex: `decision:"block"` + `reason` IS the continuation prompt
//     (https://developers.openai.com/codex/hooks#stop).
//   - Claude Code: Stop also accepts `hookSpecificOutput.additionalContext` as
//     non-error feedback that continues the conversation
//     (https://code.claude.com/docs/en/hooks#stop). Using it instead of
//     `decision:"block"` avoids surfacing a normal nudge as a hook "block".
// An empty message means "let the stop proceed" for both agents.
export function stopContinuationOutput(agent, text) {
  const message = String(text || '').trim();
  if (!message) return { continue: true };
  if (agent === 'claude-code') {
    return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: message } };
  }
  return { decision: 'block', reason: message };
}
