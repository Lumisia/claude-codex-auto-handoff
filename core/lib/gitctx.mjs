import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function gitContext(cwd) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!head) return { is_git: false, branch: null, head: null, dirty: null };
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = git(cwd, ['status', '--porcelain']);
  return { is_git: true, branch, head: head.slice(0, 12), dirty: !!(status && status.length) };
}
