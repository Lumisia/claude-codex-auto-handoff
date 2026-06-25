use regex::Regex;
use serde_json::Value;

const REDACTED: &str = "«redacted»";

pub fn redact(text: &str) -> (String, bool) {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        let mut hit = false;
        let redacted = redact_value(value, &mut hit);
        let out = serde_json::to_string(&redacted).unwrap_or_else(|_| text.to_string());
        return (out, hit);
    }

    redact_text_patterns(text)
}

fn redact_value(value: Value, hit: &mut bool) -> Value {
    match value {
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|value| redact_value(value, hit))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    if is_sensitive_key(&key) {
                        match value {
                            Value::String(value) if !value.is_empty() => {
                                *hit = true;
                                (key, Value::String(REDACTED.to_string()))
                            }
                            other => (key, redact_value(other, hit)),
                        }
                    } else {
                        (key, redact_value(value, hit))
                    }
                })
                .collect(),
        ),
        Value::String(value) => {
            let (redacted, replaced) = redact_text_patterns(&value);
            if replaced {
                *hit = true;
            }
            Value::String(redacted)
        }
        other => other,
    }
}

fn redact_text_patterns(text: &str) -> (String, bool) {
    let mut out = text.to_string();
    let mut hit = false;
    let patterns = [
        r"sk-proj-[A-Za-z0-9_-]{20,}",
        r"sk-[A-Za-z0-9]{20,}",
        r"xox[baprs]-[A-Za-z0-9-]{10,}",
        r"github_pat_[A-Za-z0-9_]{22,}",
        r"gh[pousr]_[A-Za-z0-9]{20,}",
        r"AKIA[0-9A-Z]{16}",
        r"(?i)\b(?:Authorization\s*:\s*)?Bearer\s+[A-Za-z0-9._~+/=-]{12,}",
        r#"(?i)\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[:=]\s*["']?[^\s"',;}{]{8,}["']?"#,
        r"\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    ];

    for pattern in patterns {
        let re = Regex::new(pattern).expect("redaction pattern compiles");
        let replaced = re.replace_all(&out, REDACTED).to_string();
        if replaced != out {
            hit = true;
            out = replaced;
        }
    }

    let json_field = Regex::new(
        r#"(?i)"([^"]*(?:password|passwd|passphrase|token|secret|credential|cookie|authorization)[^"]*)"\s*:\s*"[^"]*""#,
    )
    .expect("json field redaction pattern compiles");
    let replaced = json_field
        .replace_all(&out, |caps: &regex::Captures<'_>| {
            format!("\"{}\":\"{}\"", &caps[1], REDACTED)
        })
        .to_string();
    if replaced != out {
        hit = true;
        out = replaced;
    }

    (out, hit)
}

fn is_sensitive_key(key: &str) -> bool {
    let norm: String = key
        .chars()
        .filter(|c| *c != '_' && *c != '-' && !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect();

    let suffix = [
        "passwd",
        "password",
        "passphrase",
        "secret",
        "token",
        "credentials",
        "credential",
        "cookie",
        "authorization",
    ];
    let key_compound = [
        "apikey",
        "privatekey",
        "accesskey",
        "secretkey",
        "clientkey",
        "encryptionkey",
        "signingkey",
        "sessionkey",
    ];
    let prefix = [
        "privatekey",
        "apikey",
        "accesskey",
        "secretkey",
        "clientsecret",
        "accesstoken",
        "refreshtoken",
        "authtoken",
        "sessionkey",
        "sessiontoken",
        "encryptionkey",
        "signingkey",
    ];

    suffix.iter().any(|suffix| norm.ends_with(suffix))
        || key_compound.iter().any(|key| norm.ends_with(key))
        || prefix.iter().any(|prefix| norm.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_and_env_key() {
        let (out, hit) = redact("Authorization: Bearer abcDEF123456789 and OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz");
        assert!(hit);
        assert!(!out.contains("abcDEF123456789"));
        assert!(!out.contains("sk-abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn redacts_github_token_and_aws_key() {
        let (out, hit) = redact("ghp_abcdefghijklmnopqrstuvwxyz0123 AKIA1234567890ABCDEF");
        assert!(hit);
        assert!(!out.contains("ghp_abcdefghijklmnopqrstuvwxyz0123"));
        assert!(!out.contains("AKIA1234567890ABCDEF"));
    }

    #[test]
    fn redacts_json_sensitive_field() {
        let (out, hit) = redact(r#"{"password":"short","token":"abc","safe":"ok"}"#);
        assert!(hit);
        assert!(!out.contains("short"));
        assert!(!out.contains("abc"));
        assert!(out.contains(r#""safe":"ok""#));
    }

    #[test]
    fn redact_noop_on_clean_text() {
        let (out, hit) = redact("just a normal sentence");
        assert!(!hit);
        assert_eq!(out, "just a normal sentence");
    }
}
