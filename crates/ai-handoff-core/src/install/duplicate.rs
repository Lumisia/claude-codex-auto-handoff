//! Detect leftover v1 `ai-handoff` plugin hooks that would double-fire
//! alongside v2 user-level hooks.
//!
//! This module is **advisory only** — all detection is best-effort.
//! Malformed or absent inputs are silently skipped; no panics, no hard errors.

use toml_edit::DocumentMut;

/// A single finding produced by [`detect`].
#[derive(Debug, PartialEq)]
pub struct DuplicateFinding {
    /// Which agent the finding belongs to: `"codex"` or `"claude"`.
    pub agent: &'static str,
    /// Human-readable guidance describing the conflict and how to resolve it.
    pub detail: String,
}

/// Scan `codex_config_text` and `claude_settings_text` for leftover v1
/// `ai-handoff` plugin hooks.
///
/// # Codex
/// Parses `codex_config_text` as TOML using `toml_edit`. If the `[hooks.state]`
/// table contains any key that includes `ai-handoff@`, a finding is returned
/// advising the user to reject / disable those v1 hooks via Codex `/hooks`.
///
/// # Claude
/// Parses `claude_settings_text` as JSON. If `enabledPlugins` contains any key
/// that starts with `ai-handoff@` whose value is `true`, a finding is returned
/// advising the user to set that plugin to false or uninstall the v1 plugin.
///
/// # Error handling
/// `None` inputs and parse failures are silently ignored — this function
/// never panics and always returns (possibly empty) `Vec`.
pub fn detect(
    codex_config_text: Option<&str>,
    claude_settings_text: Option<&str>,
) -> Vec<DuplicateFinding> {
    let mut findings = Vec::new();

    // --- Codex ---
    if let Some(text) = codex_config_text {
        if let Ok(doc) = text.parse::<DocumentMut>() {
            if let Some(hook_keys) = hooks_state_keys(&doc) {
                let v1_keys: Vec<String> = hook_keys
                    .into_iter()
                    .filter(|k| k.contains("ai-handoff@"))
                    .collect();
                if !v1_keys.is_empty() {
                    findings.push(DuplicateFinding {
                        agent: "codex",
                        detail: format!(
                            "Leftover v1 ai-handoff plugin hook(s) detected in Codex hooks.state: \
                             {}. These will double-fire alongside v2 user-level hooks. \
                             Open Codex `/hooks`, locate the ai-handoff entries, and choose \
                             \"Reject\" or \"Disable\" to remove them.",
                            v1_keys.join(", ")
                        ),
                    });
                }
            }
        }
    }

    // --- Claude ---
    if let Some(text) = claude_settings_text {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
            if let Some(plugins) = val.get("enabledPlugins").and_then(|v| v.as_object()) {
                let v1_keys: Vec<&str> = plugins
                    .iter()
                    .filter(|(k, v)| k.starts_with("ai-handoff@") && v.as_bool() == Some(true))
                    .map(|(k, _)| k.as_str())
                    .collect();
                if !v1_keys.is_empty() {
                    findings.push(DuplicateFinding {
                        agent: "claude",
                        detail: format!(
                            "Leftover v1 ai-handoff plugin(s) enabled in Claude settings: \
                             {}. These will double-fire alongside v2 user-level hooks. \
                             Set the plugin to false in your Claude settings \
                             (`enabledPlugins[\"{}\"] = false`) or uninstall the v1 plugin.",
                            v1_keys.join(", "),
                            v1_keys.first().copied().unwrap_or("ai-handoff@...")
                        ),
                    });
                }
            }
        }
    }

    findings
}

/// Extract all keys from the `[hooks.state]` table in a parsed Codex config,
/// returning `None` if the table path does not exist.
fn hooks_state_keys(doc: &DocumentMut) -> Option<Vec<String>> {
    let state = doc.get("hooks")?.as_table()?.get("state")?.as_table()?;
    Some(state.iter().map(|(k, _)| k.to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codex_fixture() -> String {
        std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/codex-config-complex.toml"
        ))
        .unwrap()
    }

    // (1) Fixture codex config → exactly one codex finding
    #[test]
    fn detects_v1_codex_hook_in_fixture() {
        let findings = detect(Some(&codex_fixture()), None);
        assert_eq!(findings.len(), 1, "expected exactly one finding");
        assert_eq!(findings[0].agent, "codex");
        assert!(
            findings[0].detail.contains("ai-handoff@"),
            "detail should mention the v1 plugin key"
        );
        assert!(
            findings[0].detail.to_lowercase().contains("reject")
                || findings[0].detail.to_lowercase().contains("disable"),
            "detail should include remediation guidance"
        );
    }

    // (2) Claude settings with ai-handoff@ plugin enabled → one claude finding
    #[test]
    fn detects_v1_claude_plugin_enabled() {
        let settings = r#"{"enabledPlugins":{"ai-handoff@cm":true}}"#;
        let findings = detect(None, Some(settings));
        assert_eq!(findings.len(), 1, "expected exactly one finding");
        assert_eq!(findings[0].agent, "claude");
        assert!(
            findings[0].detail.contains("ai-handoff@cm"),
            "detail should name the offending plugin"
        );
        assert!(
            findings[0].detail.to_lowercase().contains("false")
                || findings[0].detail.to_lowercase().contains("uninstall"),
            "detail should include remediation guidance"
        );
    }

    // (3) Clean inputs → empty findings
    #[test]
    fn clean_inputs_produce_no_findings() {
        let clean_codex = r#"
model = "gpt-5.5"
approval_policy = "on-request"

[hooks.state."some-other-plugin@vendor:hooks/hooks.json:session_start:0:0"]
trusted_hash = "sha256:aabbcc"
"#;
        let clean_claude = r#"{"enabledPlugins":{"some-other-plugin@vendor":true}}"#;
        let findings = detect(Some(clean_codex), Some(clean_claude));
        assert!(
            findings.is_empty(),
            "expected no findings for clean inputs, got: {findings:?}"
        );
    }

    // (3b) Both None → empty
    #[test]
    fn none_inputs_produce_no_findings() {
        let findings = detect(None, None);
        assert!(findings.is_empty());
    }

    // (4) Malformed inputs → empty, no panic
    #[test]
    fn malformed_codex_is_skipped_gracefully() {
        let findings = detect(Some("not = = valid toml !!!"), None);
        assert!(
            findings.is_empty(),
            "expected no findings for malformed TOML"
        );
    }

    #[test]
    fn malformed_claude_is_skipped_gracefully() {
        let findings = detect(None, Some("{not json at all"));
        assert!(
            findings.is_empty(),
            "expected no findings for malformed JSON"
        );
    }

    // (4b) Disabled claude plugin → no finding (value is false)
    #[test]
    fn disabled_claude_plugin_is_not_flagged() {
        let settings = r#"{"enabledPlugins":{"ai-handoff@cm":false}}"#;
        let findings = detect(None, Some(settings));
        assert!(
            findings.is_empty(),
            "a disabled plugin should not be flagged"
        );
    }

    // Both agents fire simultaneously
    #[test]
    fn detects_both_agents_when_both_have_v1_hooks() {
        let settings = r#"{"enabledPlugins":{"ai-handoff@cm":true}}"#;
        let findings = detect(Some(&codex_fixture()), Some(settings));
        assert_eq!(findings.len(), 2);
        let agents: Vec<&str> = findings.iter().map(|f| f.agent).collect();
        assert!(agents.contains(&"codex"));
        assert!(agents.contains(&"claude"));
    }
}
