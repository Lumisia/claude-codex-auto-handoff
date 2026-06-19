import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = join(here, '..', '..', 'config', 'defaults.json');

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadConfig({ path, defaultsPath = DEFAULTS_PATH } = {}) {
  const defaults = readJson(defaultsPath) || {};
  const user = (path && readJson(path)) || {};
  return deepMerge(defaults, user);
}

export function resolveProject(cfg, fingerprint) {
  const over = cfg.project_overrides && cfg.project_overrides[fingerprint];
  return over ? deepMerge(cfg, over) : cfg;
}
