//! Typed, file-backed AI Handoff config (`~/.ai-handoff/config.toml`).
//!
//! Embedded defaults match v1's `defaults.json`. `parse`/`resolve` are pure;
//! `load` is the only IO entry point. A missing or malformed config resolves to
//! defaults so a hook is never broken by a bad config.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use toml_edit::{value, DocumentMut, Item, Table};

use crate::trigger::{BurnRate, TriggerMode};

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Config {
    pub triggers: Triggers,
    pub autostart: Autostart,
    pub statusline: Statusline,
    pub language: Language,
    pub project_overrides: HashMap<String, ProjectOverride>,
}

/// UI language preference. Serialized as a short code; defaults to English.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Ko,
    Ja,
    Zh,
}

/// Statusline display options. Opt-in: defaults to enabled (`show = true`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct Statusline {
    pub show: bool,
}

impl Default for Statusline {
    fn default() -> Self {
        Self { show: true }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Triggers {
    pub five_hour: FiveHour,
}

/// Run the daemon automatically at logon. Opt-in: defaults to disabled (the
/// `bool` default), so a fresh install registers no autostart unless the user
/// sets `[autostart] enabled = true`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct Autostart {
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(default)]
pub struct FiveHour {
    pub enabled: bool,
    pub threshold_percent: f64,
    pub mode: ModeCfg,
    pub burn_rate: BurnRateCfg,
}

impl Default for FiveHour {
    fn default() -> Self {
        Self {
            enabled: true,
            threshold_percent: 80.0,
            mode: ModeCfg::Ask,
            burn_rate: BurnRateCfg::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModeCfg {
    Off,
    Ask,
    Auto,
}

impl ModeCfg {
    pub fn to_trigger_mode(self) -> TriggerMode {
        match self {
            ModeCfg::Off => TriggerMode::Off,
            ModeCfg::Ask => TriggerMode::Ask,
            ModeCfg::Auto => TriggerMode::Auto,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(default)]
pub struct BurnRateCfg {
    pub enabled: bool,
    pub runway_minutes: f64,
}

impl Default for BurnRateCfg {
    fn default() -> Self {
        Self {
            enabled: false,
            runway_minutes: 30.0,
        }
    }
}

impl BurnRateCfg {
    pub fn to_burn(self) -> BurnRate {
        BurnRate {
            enabled: self.enabled,
            runway_minutes: self.runway_minutes,
        }
    }
}

/// A per-project override: every field optional, deep-merged over the global.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct ProjectOverride {
    pub triggers: TriggersOverride,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct TriggersOverride {
    pub five_hour: FiveHourOverride,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct FiveHourOverride {
    pub enabled: Option<bool>,
    pub threshold_percent: Option<f64>,
    pub mode: Option<ModeCfg>,
    pub burn_rate: Option<BurnRateOverride>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct BurnRateOverride {
    pub enabled: Option<bool>,
    pub runway_minutes: Option<f64>,
}

/// The concrete trigger inputs after applying any project override.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedTrigger {
    pub enabled: bool,
    pub threshold: f64,
    pub mode: TriggerMode,
    pub burn: BurnRate,
}

/// Parse config text. Propagates TOML/type errors so `load` can fall back.
pub fn parse(text: &str) -> Result<Config, toml::de::Error> {
    toml::from_str(text)
}

/// Resolve the effective trigger for a project: apply the matching
/// `project_overrides[fingerprint]` (if any) over the global config, then clamp.
pub fn resolve(cfg: &Config, fingerprint: &str) -> ResolvedTrigger {
    let g = &cfg.triggers.five_hour;
    let mut enabled = g.enabled;
    let mut threshold = g.threshold_percent;
    let mut mode = g.mode;
    let mut burn = g.burn_rate;

    if let Some(ov) = cfg.project_overrides.get(fingerprint) {
        let f = &ov.triggers.five_hour;
        if let Some(v) = f.enabled {
            enabled = v;
        }
        if let Some(v) = f.threshold_percent {
            threshold = v;
        }
        if let Some(v) = f.mode {
            mode = v;
        }
        if let Some(b) = f.burn_rate.as_ref() {
            if let Some(v) = b.enabled {
                burn.enabled = v;
            }
            if let Some(v) = b.runway_minutes {
                burn.runway_minutes = v;
            }
        }
    }

    ResolvedTrigger {
        enabled,
        threshold: threshold.clamp(0.0, 100.0),
        mode: mode.to_trigger_mode(),
        burn: burn.to_burn(),
    }
}

/// Load config from the default path, falling back to defaults on any error.
pub fn load() -> Config {
    load_from(&crate::paths::config_path())
}

/// Load config from `path`. A missing file or any parse error yields
/// `Config::default()` — the daemon must never break a hook over a bad config.
pub fn load_from(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(text) => parse(&text).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

// ---------------------------------------------------------------------------
// Write API (`config get` / `config set`)
//
// Editing is **never-clobber**: `set_value` parses the existing `config.toml`
// with `toml_edit`, changes exactly the one requested leaf (creating only the
// implicit parent tables it needs), and re-serializes — every other table,
// key, comment and string is preserved byte-for-byte. The set of editable
// keys is a fixed whitelist with per-key type/range validation, so a bad
// value is rejected before any write rather than corrupting the daemon's view.
// ---------------------------------------------------------------------------

/// Error from a [`set_value`] / [`get_value`] call.
#[derive(Debug, thiserror::Error)]
pub enum ConfigWriteError {
    #[error("unknown config key: {0}")]
    UnknownKey(String),
    #[error("invalid value for {key}: {message}")]
    InvalidValue { key: String, message: String },
    #[error("config.toml parse error: {0}")]
    Parse(#[from] toml_edit::TomlError),
    #[error("config key {key} sits under a non-table node; refusing to overwrite it")]
    ShapeConflict { key: String },
}

/// The value type accepted for an editable key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValueKind {
    Bool,
    /// A float clamped to the inclusive `0..=100` range.
    Percent,
    /// A strictly-positive float.
    PosFloat,
    /// One of `off` / `ask` / `auto`.
    Mode,
    /// A UI language code: `en` / `ko` / `ja` / `zh`.
    Lang,
}

/// The whitelist of user-editable keys (dotted) and their value types.
const SETTABLE: &[(&str, ValueKind)] = &[
    ("triggers.five_hour.enabled", ValueKind::Bool),
    ("triggers.five_hour.threshold_percent", ValueKind::Percent),
    ("triggers.five_hour.mode", ValueKind::Mode),
    ("triggers.five_hour.burn_rate.enabled", ValueKind::Bool),
    ("triggers.five_hour.burn_rate.runway_minutes", ValueKind::PosFloat),
    ("autostart.enabled", ValueKind::Bool),
    ("statusline.show", ValueKind::Bool),
    ("language", ValueKind::Lang),
];

/// The editable config keys, in display order (for `config list`).
pub fn settable_keys() -> impl Iterator<Item = &'static str> {
    SETTABLE.iter().map(|(k, _)| *k)
}

/// The public value-kind of an editable key, for UIs that edit config (e.g. the
/// TUI Settings tab): bool toggles, mode cycles, numbers step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyKind {
    Bool,
    /// Float in `0..=100`.
    Percent,
    /// Strictly-positive float.
    PosFloat,
    /// `off` / `ask` / `auto`.
    Mode,
    /// `en` / `ko` / `ja` / `zh`.
    Lang,
}

/// The kind of an editable key, or `None` if `key` is not editable.
pub fn key_kind(key: &str) -> Option<KeyKind> {
    SETTABLE.iter().find(|(k, _)| *k == key).map(|(_, v)| match v {
        ValueKind::Bool => KeyKind::Bool,
        ValueKind::Percent => KeyKind::Percent,
        ValueKind::PosFloat => KeyKind::PosFloat,
        ValueKind::Mode => KeyKind::Mode,
        ValueKind::Lang => KeyKind::Lang,
    })
}

impl ValueKind {
    /// Validate `raw` for this kind and convert it to a TOML item.
    fn to_item(self, key: &str, raw: &str) -> Result<Item, ConfigWriteError> {
        let invalid = |message: &str| ConfigWriteError::InvalidValue {
            key: key.to_string(),
            message: message.to_string(),
        };
        Ok(match self {
            ValueKind::Bool => {
                let b: bool = raw
                    .parse()
                    .map_err(|_| invalid("expected `true` or `false`"))?;
                value(b)
            }
            ValueKind::Mode => match raw {
                "off" | "ask" | "auto" => value(raw),
                _ => return Err(invalid("expected one of `off`, `ask`, `auto`")),
            },
            ValueKind::Lang => match raw {
                "en" | "ko" | "ja" | "zh" => value(raw),
                _ => return Err(invalid("expected one of `en`, `ko`, `ja`, `zh`")),
            },
            ValueKind::Percent => {
                let n: f64 = raw.parse().map_err(|_| invalid("expected a number"))?;
                if !(0.0..=100.0).contains(&n) {
                    return Err(invalid("must be between 0 and 100"));
                }
                value(n)
            }
            ValueKind::PosFloat => {
                let n: f64 = raw.parse().map_err(|_| invalid("expected a number"))?;
                if n.is_nan() || n <= 0.0 {
                    return Err(invalid("must be greater than 0"));
                }
                value(n)
            }
        })
    }
}

/// Set `key` to `raw` in `existing` config text (or a fresh document when
/// `existing` is `None`), returning the new serialized `config.toml`.
///
/// Rejects unknown keys and out-of-range/ill-typed values before touching the
/// document. Parse errors on a present-but-corrupt file are propagated so the
/// caller aborts rather than clobbering it with a blank document.
pub fn set_value(
    existing: Option<&str>,
    key: &str,
    raw: &str,
) -> Result<String, ConfigWriteError> {
    let kind = SETTABLE
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| *v)
        .ok_or_else(|| ConfigWriteError::UnknownKey(key.to_string()))?;
    let item = kind.to_item(key, raw)?;

    let mut doc: DocumentMut = match existing {
        Some(s) => s.parse::<DocumentMut>()?,
        None => DocumentMut::new(),
    };

    let segments: Vec<&str> = key.split('.').collect();
    let (last, parents) = segments.split_last().expect("whitelist keys are non-empty");
    let mut table = doc.as_table_mut();
    for seg in parents {
        let entry = table.entry(seg).or_insert_with(|| {
            let mut t = Table::new();
            t.set_implicit(true);
            Item::Table(t)
        });
        table = entry
            .as_table_mut()
            .ok_or_else(|| ConfigWriteError::ShapeConflict {
                key: key.to_string(),
            })?;
    }
    table.insert(last, item);

    Ok(doc.to_string())
}

/// Read the **effective** value of `key` from a resolved [`Config`] (so an
/// unset key reports its built-in default), formatted as the daemon sees it.
pub fn get_value(cfg: &Config, key: &str) -> Result<String, ConfigWriteError> {
    let f = &cfg.triggers.five_hour;
    Ok(match key {
        "triggers.five_hour.enabled" => f.enabled.to_string(),
        "triggers.five_hour.threshold_percent" => fmt_f64(f.threshold_percent),
        "triggers.five_hour.mode" => mode_str(f.mode).to_string(),
        "triggers.five_hour.burn_rate.enabled" => f.burn_rate.enabled.to_string(),
        "triggers.five_hour.burn_rate.runway_minutes" => fmt_f64(f.burn_rate.runway_minutes),
        "autostart.enabled" => cfg.autostart.enabled.to_string(),
        "statusline.show" => cfg.statusline.show.to_string(),
        "language" => lang_str(cfg.language).to_string(),
        _ => return Err(ConfigWriteError::UnknownKey(key.to_string())),
    })
}

fn mode_str(mode: ModeCfg) -> &'static str {
    match mode {
        ModeCfg::Off => "off",
        ModeCfg::Ask => "ask",
        ModeCfg::Auto => "auto",
    }
}

/// Short code for a [`Language`] (matches its serde representation).
pub fn lang_str(lang: Language) -> &'static str {
    match lang {
        Language::En => "en",
        Language::Ko => "ko",
        Language::Ja => "ja",
        Language::Zh => "zh",
    }
}

/// Format a float the way a user typed it: drop a redundant `.0` tail.
fn fmt_f64(n: f64) -> String {
    if n.fract() == 0.0 && n.is_finite() {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_is_all_defaults() {
        let c = parse("").unwrap();
        let f = c.triggers.five_hour;
        assert!(f.enabled);
        assert_eq!(f.threshold_percent, 80.0);
        assert_eq!(f.mode, ModeCfg::Ask);
        assert!(!f.burn_rate.enabled);
        assert_eq!(f.burn_rate.runway_minutes, 30.0);
        assert!(c.project_overrides.is_empty());
    }

    #[test]
    fn autostart_defaults_to_disabled() {
        assert!(!parse("").unwrap().autostart.enabled);
        assert!(!Config::default().autostart.enabled);
    }

    #[test]
    fn autostart_can_be_enabled_in_config() {
        let c = parse("[autostart]\nenabled = true\n").unwrap();
        assert!(c.autostart.enabled);
        // unrelated sections still default
        assert_eq!(c.triggers.five_hour.threshold_percent, 80.0);
    }

    #[test]
    fn parses_full_global_config() {
        let c = parse(
            "[triggers.five_hour]\n\
             enabled = true\n\
             threshold_percent = 70\n\
             mode = \"auto\"\n\
             [triggers.five_hour.burn_rate]\n\
             enabled = true\n\
             runway_minutes = 15\n",
        )
        .unwrap();
        let f = c.triggers.five_hour;
        assert_eq!(f.threshold_percent, 70.0);
        assert_eq!(f.mode, ModeCfg::Auto);
        assert!(f.burn_rate.enabled);
        assert_eq!(f.burn_rate.runway_minutes, 15.0);
    }

    #[test]
    fn mode_parses_each_lowercase_variant() {
        for (text, want) in [("off", ModeCfg::Off), ("ask", ModeCfg::Ask), ("auto", ModeCfg::Auto)] {
            let c = parse(&format!("[triggers.five_hour]\nmode = \"{text}\"\n")).unwrap();
            assert_eq!(c.triggers.five_hour.mode, want);
        }
    }

    #[test]
    fn unknown_mode_is_parse_error() {
        assert!(parse("[triggers.five_hour]\nmode = \"weird\"\n").is_err());
    }

    #[test]
    fn partial_section_keeps_other_defaults() {
        // only threshold given; mode/enabled/burn stay default
        let c = parse("[triggers.five_hour]\nthreshold_percent = 55\n").unwrap();
        let f = c.triggers.five_hour;
        assert_eq!(f.threshold_percent, 55.0);
        assert_eq!(f.mode, ModeCfg::Ask);
        assert!(f.enabled);
    }

    #[test]
    fn resolve_without_override_uses_global() {
        let c = parse("[triggers.five_hour]\nthreshold_percent = 80\nmode = \"ask\"\n").unwrap();
        let r = resolve(&c, "fp-none");
        assert!(r.enabled);
        assert_eq!(r.threshold, 80.0);
        assert_eq!(r.mode, TriggerMode::Ask);
        assert!(!r.burn.enabled);
    }

    #[test]
    fn resolve_applies_matching_override_and_inherits_rest() {
        let c = parse(
            "[triggers.five_hour]\n\
             threshold_percent = 80\n\
             mode = \"ask\"\n\
             [project_overrides.\"fpX\".triggers.five_hour]\n\
             threshold_percent = 90\n\
             mode = \"auto\"\n",
        )
        .unwrap();
        let rx = resolve(&c, "fpX");
        assert_eq!(rx.threshold, 90.0);
        assert_eq!(rx.mode, TriggerMode::Auto);
        // a different project still gets the global values
        let ry = resolve(&c, "fpY");
        assert_eq!(ry.threshold, 80.0);
        assert_eq!(ry.mode, TriggerMode::Ask);
    }

    #[test]
    fn resolve_override_with_only_threshold_keeps_global_mode() {
        let c = parse(
            "[triggers.five_hour]\nmode = \"auto\"\n\
             [project_overrides.\"fpX\".triggers.five_hour]\nthreshold_percent = 50\n",
        )
        .unwrap();
        let r = resolve(&c, "fpX");
        assert_eq!(r.threshold, 50.0);
        assert_eq!(r.mode, TriggerMode::Auto); // inherited
    }

    #[test]
    fn resolve_clamps_threshold_into_0_100() {
        let hi = parse("[triggers.five_hour]\nthreshold_percent = 150\n").unwrap();
        assert_eq!(resolve(&hi, "x").threshold, 100.0);
        let lo = parse("[triggers.five_hour]\nthreshold_percent = -5\n").unwrap();
        assert_eq!(resolve(&lo, "x").threshold, 0.0);
    }

    #[test]
    fn load_from_missing_file_is_default() {
        let dir = tempfile::tempdir().unwrap();
        let c = load_from(&dir.path().join("config.toml"));
        assert_eq!(c, Config::default());
        assert_eq!(c.triggers.five_hour.threshold_percent, 80.0);
    }

    #[test]
    fn load_from_malformed_file_is_default_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.toml");
        std::fs::write(&p, "this = = not valid toml").unwrap();
        assert_eq!(load_from(&p), Config::default());
    }

    #[test]
    fn load_from_valid_file_parses() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.toml");
        std::fs::write(&p, "[triggers.five_hour]\nthreshold_percent = 42\n").unwrap();
        assert_eq!(load_from(&p).triggers.five_hour.threshold_percent, 42.0);
    }

    #[test]
    fn statusline_defaults_to_show_true() {
        assert!(parse("").unwrap().statusline.show);
        assert!(Config::default().statusline.show);
    }

    #[test]
    fn statusline_show_false_parses() {
        let c = parse("[statusline]\nshow = false\n").unwrap();
        assert!(!c.statusline.show);
        // unrelated sections still default
        assert_eq!(c.triggers.five_hour.threshold_percent, 80.0);
    }

    // --- write API -------------------------------------------------------

    #[test]
    fn set_value_on_empty_creates_minimal_toml_that_reparses() {
        let text = set_value(None, "triggers.five_hour.threshold_percent", "70").unwrap();
        // Round-trips through the typed parser to the requested value.
        assert_eq!(parse(&text).unwrap().triggers.five_hour.threshold_percent, 70.0);
        // Only an implicit parent header is emitted, not an empty `[triggers]`.
        assert!(text.contains("[triggers.five_hour]"));
        assert!(!text.contains("\n[triggers]\n"));
    }

    #[test]
    fn set_value_preserves_unrelated_content_and_comments() {
        let existing = "\
# keep me
[triggers.five_hour]
threshold_percent = 80
mode = \"ask\"  # inline note

[autostart]
enabled = true
";
        let text = set_value(Some(existing), "triggers.five_hour.mode", "auto").unwrap();
        assert!(text.contains("# keep me"));
        assert!(text.contains("[autostart]"));
        // foreign key untouched
        let c = parse(&text).unwrap();
        assert_eq!(c.triggers.five_hour.mode, ModeCfg::Auto);
        assert_eq!(c.triggers.five_hour.threshold_percent, 80.0);
        assert!(c.autostart.enabled);
    }

    #[test]
    fn set_value_overwrites_existing_leaf() {
        let existing = "[statusline]\nshow = true\n";
        let text = set_value(Some(existing), "statusline.show", "false").unwrap();
        assert!(!parse(&text).unwrap().statusline.show);
    }

    #[test]
    fn set_value_rejects_unknown_key() {
        let err = set_value(None, "triggers.five_hour.nope", "1").unwrap_err();
        assert!(matches!(err, ConfigWriteError::UnknownKey(_)));
    }

    #[test]
    fn set_value_rejects_out_of_range_percent() {
        let err = set_value(None, "triggers.five_hour.threshold_percent", "150").unwrap_err();
        assert!(matches!(err, ConfigWriteError::InvalidValue { .. }));
    }

    #[test]
    fn set_value_rejects_bad_bool_and_mode_and_nonpositive() {
        assert!(matches!(
            set_value(None, "autostart.enabled", "yes").unwrap_err(),
            ConfigWriteError::InvalidValue { .. }
        ));
        assert!(matches!(
            set_value(None, "triggers.five_hour.mode", "loud").unwrap_err(),
            ConfigWriteError::InvalidValue { .. }
        ));
        assert!(matches!(
            set_value(None, "triggers.five_hour.burn_rate.runway_minutes", "0").unwrap_err(),
            ConfigWriteError::InvalidValue { .. }
        ));
    }

    #[test]
    fn set_value_propagates_parse_error_without_clobbering() {
        let err = set_value(Some("this = = not toml"), "statusline.show", "false").unwrap_err();
        assert!(matches!(err, ConfigWriteError::Parse(_)));
    }

    #[test]
    fn set_value_errors_on_non_table_parent() {
        // `triggers` exists but as a scalar — never overwrite it.
        let err = set_value(
            Some("triggers = 5\n"),
            "triggers.five_hour.mode",
            "auto",
        )
        .unwrap_err();
        assert!(matches!(err, ConfigWriteError::ShapeConflict { .. }));
    }

    #[test]
    fn set_value_round_trips_nested_burn_rate() {
        let text = set_value(None, "triggers.five_hour.burn_rate.runway_minutes", "15").unwrap();
        let text = set_value(Some(&text), "triggers.five_hour.burn_rate.enabled", "true").unwrap();
        let c = parse(&text).unwrap();
        assert!(c.triggers.five_hour.burn_rate.enabled);
        assert_eq!(c.triggers.five_hour.burn_rate.runway_minutes, 15.0);
    }

    #[test]
    fn get_value_reports_effective_defaults_and_set_values() {
        let cfg = Config::default();
        assert_eq!(get_value(&cfg, "triggers.five_hour.threshold_percent").unwrap(), "80");
        assert_eq!(get_value(&cfg, "triggers.five_hour.mode").unwrap(), "ask");
        assert_eq!(get_value(&cfg, "autostart.enabled").unwrap(), "false");
        assert_eq!(get_value(&cfg, "statusline.show").unwrap(), "true");

        let cfg = parse("[triggers.five_hour]\nthreshold_percent = 42.5\nmode = \"auto\"\n").unwrap();
        assert_eq!(get_value(&cfg, "triggers.five_hour.threshold_percent").unwrap(), "42.5");
        assert_eq!(get_value(&cfg, "triggers.five_hour.mode").unwrap(), "auto");
    }

    #[test]
    fn get_value_rejects_unknown_key() {
        assert!(matches!(
            get_value(&Config::default(), "bogus.key").unwrap_err(),
            ConfigWriteError::UnknownKey(_)
        ));
    }

    #[test]
    fn key_kind_maps_each_settable_key() {
        assert_eq!(key_kind("autostart.enabled"), Some(KeyKind::Bool));
        assert_eq!(key_kind("triggers.five_hour.mode"), Some(KeyKind::Mode));
        assert_eq!(key_kind("triggers.five_hour.threshold_percent"), Some(KeyKind::Percent));
        assert_eq!(
            key_kind("triggers.five_hour.burn_rate.runway_minutes"),
            Some(KeyKind::PosFloat)
        );
        assert_eq!(key_kind("nope"), None);
        // every advertised key has a kind
        for k in settable_keys() {
            assert!(key_kind(k).is_some(), "no kind for {k}");
        }
    }

    #[test]
    fn settable_keys_match_get_value_domain() {
        // every advertised key is readable
        let cfg = Config::default();
        for key in settable_keys() {
            assert!(get_value(&cfg, key).is_ok(), "key {key} not readable");
        }
        assert_eq!(settable_keys().count(), 8);
    }

    #[test]
    fn language_defaults_to_en_and_parses_each_code() {
        assert_eq!(Config::default().language, Language::En);
        assert_eq!(get_value(&Config::default(), "language").unwrap(), "en");
        for (text, want) in [
            ("en", Language::En),
            ("ko", Language::Ko),
            ("ja", Language::Ja),
            ("zh", Language::Zh),
        ] {
            let c = parse(&format!("language = \"{text}\"\n")).unwrap();
            assert_eq!(c.language, want);
        }
    }

    #[test]
    fn set_value_language_round_trips_and_rejects_bad_code() {
        let text = set_value(None, "language", "ko").unwrap();
        assert_eq!(parse(&text).unwrap().language, Language::Ko);
        assert!(matches!(
            set_value(None, "language", "fr").unwrap_err(),
            ConfigWriteError::InvalidValue { .. }
        ));
    }

    #[test]
    fn key_kind_maps_language() {
        assert_eq!(key_kind("language"), Some(KeyKind::Lang));
    }

    #[test]
    fn set_then_load_from_disk_is_visible_to_daemon() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.toml");
        let text = set_value(None, "triggers.five_hour.threshold_percent", "65").unwrap();
        std::fs::write(&p, text).unwrap();
        // The daemon's loader sees the written value.
        assert_eq!(load_from(&p).triggers.five_hour.threshold_percent, 65.0);
    }
}
