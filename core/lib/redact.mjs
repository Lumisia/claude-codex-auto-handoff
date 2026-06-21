// Known secret shapes. These run over free text. redactJson ADDITIONALLY
// redacts by sensitive key name, so a secret stored as a structured value
// (e.g. {"password":"hunter2"}) is caught even when its value matches no
// pattern — a JSON-quoted key defeats the flat PATTERNS because the closing
// quote sits between the key and the ":".
const PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]{20,}/g,          // openai project key (sk-proj-…)
  /sk-[A-Za-z0-9]{20,}/g,                 // openai-style
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,        // slack
  /github_pat_[A-Za-z0-9_]{22,}/g,        // github fine-grained PAT
  /gh[pousr]_[A-Za-z0-9]{20,}/g,          // github classic token
  /AKIA[0-9A-Z]{16}/g,                    // aws access key id
  /\b(?:Authorization\s*:\s*)?Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|secret|password)\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi,
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// Field names whose VALUE is sensitive regardless of its shape. The key is
// normalised (lowercased, separators stripped) so snake_case, kebab-case, and
// camelCase compounds collapse together: access_token / access-token /
// accessToken all end in "token". Bare "key" is intentionally NOT sensitive
// (publicKey, primaryKey, cacheKey are not secrets) — only known secret-key
// compounds match.
const SECRET_SUFFIX = /(?:passwd|password|passphrase|secret|token|credentials?|cookie|authorization)$/;
const SECRET_KEY_COMPOUND = /(?:api|private|access|secret|client|encryption|signing|session)key$/;
// Secret nouns used as a PREFIX of a longer field (privateKeyPem,
// clientSecretValue, accessTokenHeader). Only multi-word compounds — never bare
// "token"/"secret"/"key" — so benign suffixes like "tokenCount" stay clear.
const SECRET_PREFIX = /^(?:privatekey|apikey|accesskey|secretkey|clientsecret|accesstoken|refreshtoken|authtoken|sessionkey|sessiontoken|encryptionkey|signingkey)/;

function isSensitiveKey(key) {
  const norm = String(key).toLowerCase().replace(/[_\-\s]/g, '');
  return SECRET_SUFFIX.test(norm) || SECRET_KEY_COMPOUND.test(norm) || SECRET_PREFIX.test(norm);
}

export function redactText(text) {
  let count = 0;
  let out = String(text);
  for (const re of PATTERNS) {
    out = out.replace(re, () => { count++; return '[REDACTED]'; });
  }
  return { text: out, count };
}

function redactValue(value, stats) {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, stats));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Only a non-empty STRING under a sensitive key is treated as a secret.
      // Booleans/numbers (e.g. requiresAuthorization: true) are not secrets, and
      // redacting them would corrupt the value's type; objects/arrays are walked
      // so nested secrets are still caught.
      if (isSensitiveKey(k) && typeof v === 'string' && v !== '') {
        out[k] = '[REDACTED]';
        stats.count++;
      } else {
        out[k] = redactValue(v, stats);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    const { text, count } = redactText(value);
    stats.count += count;
    return text;
  }
  return value;
}

// Redact a JSON-serializable value: walk the structure, redact values under a
// sensitive key, and apply the text PATTERNS to every string. Unlike a
// stringify → regex → parse round-trip this cannot emit invalid JSON, and it
// catches secrets stored as quoted-key values that the flat PATTERNS miss.
export function redactJson(value) {
  const stats = { count: 0 };
  const redacted = redactValue(value, stats);
  return { value: redacted, count: stats.count };
}
