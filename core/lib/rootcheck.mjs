import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function defaultListPackages(localAppData) {
  if (!localAppData) return [];
  try { return readdirSync(join(localAppData, 'Packages')); } catch { return []; }
}

// On Windows the Claude desktop app is an MSIX/Store package whose filesystem
// layer transparently redirects %LOCALAPPDATA% into its private container.
// ai-handoff derives its whole store (config, capsules, approvals, memory,
// sensors) from %LOCALAPPDATA% unless AI_HANDOFF_ROOT is set, so without that
// env var the packaged Claude app and a peer Codex write to two DIFFERENT
// physical roots and never see each other's handoffs. Detect the at-risk
// configuration so `doctor` can warn with an actionable fix.
//
// Signal: win32 + no AI_HANDOFF_ROOT + a `Claude*` package present under
// %LOCALAPPDATA%\Packages (proof the redirecting app is installed). We stay
// silent otherwise so a plain Claude Code CLI user (no packaged app) is never
// nagged. Returns a finding or null. Deps are injectable for testing.
export function detectRootSplitRisk({
  platform = process.platform,
  aiHandoffRoot = process.env.AI_HANDOFF_ROOT,
  localAppData = process.env.LOCALAPPDATA,
  listPackages = defaultListPackages,
} = {}) {
  if (platform !== 'win32') return null;   // redirection is Windows-only
  if (aiHandoffRoot) return null;          // an explicit root already unifies both agents
  const packages = listPackages(localAppData) || [];
  const claudePackage = packages.find((name) => /claude/i.test(name)) || null;
  if (!claudePackage) return null;         // no packaged Claude app → no known redirect
  return {
    code: 'windows-store-split-risk',
    severity: 'warn',
    message:
      'The Windows Store (MSIX) Claude app redirects %LOCALAPPDATA%, so without '
      + 'AI_HANDOFF_ROOT this store can split from Codex and handoffs will not cross.',
    recommendation:
      'Set AI_HANDOFF_ROOT to a shared path OUTSIDE AppData (e.g. '
      + 'C:\\Users\\<you>\\ai-handoff-store) for BOTH Claude and Codex, then restart both.',
    detail: { claudePackage },
  };
}
