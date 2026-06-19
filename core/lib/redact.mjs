const PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,                 // openai-style
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,        // slack
  /gh[pousr]_[A-Za-z0-9]{20,}/g,          // github
  /AKIA[0-9A-Z]{16}/g,                    // aws access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactText(text) {
  let count = 0;
  let out = String(text);
  for (const re of PATTERNS) {
    out = out.replace(re, () => { count++; return '[REDACTED]'; });
  }
  return { text: out, count };
}

export function redactJson(value) {
  const { text, count } = redactText(JSON.stringify(value));
  return { value: JSON.parse(text), count };
}
