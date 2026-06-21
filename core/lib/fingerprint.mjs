import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { sha256Hex } from './hash.mjs';

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// Strip credentials embedded in the remote URL so a token never reaches the
// fingerprint hash or doctor output. Two carriers are removed for scheme://
// URLs: userinfo (https://user:TOKEN@host) and the query/fragment
// (https://host/repo.git?access_token=TOKEN#frag). scp-style SSH
// ("git@host:path") has no "://" and is left untouched — git@ is a conventional
// username, not a secret, and it has no query/fragment grammar.
//
// The userinfo class is [^/?#] (everything up to the authority terminator), not
// [^/@]: git/curl treat the LAST "@" before the path as the userinfo<->host
// delimiter, so a password may itself contain "@" (e.g. user:p@ss). Matching
// only up to the first "@" would leak the password tail. The class must also
// exclude "?" and "#" — the authority ends at the first "/", "?" or "#", so a
// "@" inside a query/fragment (e.g. host?token=ab@cd, no path) is not userinfo;
// matching across it would eat the real host and leak the query/fragment tail.
function sanitizeRemoteUrl(url) {
  let out = url.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/?#]*@/, '$1');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(out)) {
    out = out.replace(/[?#].*$/, '');
  }
  return out;
}

function isSchemeUrl(u) { return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u); }
function isWindowsDrive(u) { return /^[A-Za-z]:[\\/]/.test(u); }
// git scp syntax: [user@]host:path — a colon before any slash, and not a scheme
// URL or a Windows drive path. The user part is OPTIONAL ("host:path" with an
// ssh-config host alias is valid), so we must not require an "@".
function isScpLike(u) {
  if (isSchemeUrl(u) || isWindowsDrive(u)) return false;
  return /^[^/:]+:/.test(u);
}

export function projectFingerprintInfo(cwd) {
  let basis = null;
  const url = git(cwd, ['config', '--get', 'remote.origin.url']);
  if (url) {
    const cleaned = sanitizeRemoteUrl(url);
    let value = cleaned;
    // A RELATIVE local remote (e.g. "../upstream.git") hashes identically across
    // unrelated repos that happen to share the spelling, so they would share one
    // capsule store. Anchor it to an absolute path against the repo root so two
    // different checkouts get distinct fingerprints. Scheme URLs, scp-style SSH
    // remotes, and already-absolute paths are global identifiers and left as-is.
    if (!isSchemeUrl(cleaned) && !isScpLike(cleaned) && !isAbsolute(cleaned) && !isWindowsDrive(cleaned)) {
      // Resolve LEXICALLY against the repo root — never realpathSync. The remote
      // target may not exist locally (it is a git URL, not a checkout), and
      // resolving symlinks would make the fingerprint depend on filesystem state
      // (target presence / mount), orphaning capsules when that changes.
      const root = git(cwd, ['rev-parse', '--show-toplevel']) || cwd;
      value = resolve(root, cleaned);
    }
    basis = { type: 'remote', value: 'remote:' + value };
  }
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
