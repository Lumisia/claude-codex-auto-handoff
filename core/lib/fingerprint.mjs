import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { sha256Hex } from './hash.mjs';

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function projectFingerprintInfo(cwd) {
  let basis = null;
  const url = git(cwd, ['config', '--get', 'remote.origin.url']);
  if (url) basis = { type: 'remote', value: 'remote:' + url };
  if (!basis) {
    const root = git(cwd, ['rev-parse', '--show-toplevel']);
    if (root) {
      let resolved = root;
      try { resolved = realpathSync(root); } catch {}
      basis = { type: 'gitroot', value: 'gitroot:' + resolved };
    }
  }
  if (!basis) {
    let resolved = cwd;
    try { resolved = realpathSync(cwd); } catch {}
    basis = { type: 'path', value: 'path:' + resolved };
  }
  return { fingerprint: sha256Hex(basis.value).slice(0, 24), basis };
}

export function projectFingerprint(cwd) {
  return projectFingerprintInfo(cwd).fingerprint;
}
