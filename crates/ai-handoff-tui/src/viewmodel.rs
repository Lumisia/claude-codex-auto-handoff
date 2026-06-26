//! Pure view-models: shape engine/core data into rows the render layer draws.
//! Kept free of ratatui/crossterm so it is unit-testable without a terminal.

use ai_handoff_core::config::{self, Config, KeyKind};
use ai_handoff_core::dashboard::{CheckStatus, DashboardSnapshot};
use ai_handoff_usage::{
    aggregate::{self, Group},
    model::UsageEvent,
    Dimension,
};

/// Aggregated usage for the Usage tab.
#[derive(Debug, Clone)]
pub struct UsageView {
    pub total: Group,
    pub by_source: Vec<Group>,
    /// Chronological (ascending day) for the per-day bars.
    pub by_day: Vec<Group>,
    pub by_model: Vec<Group>,
    pub by_project: Vec<Group>,
}

impl UsageView {
    pub fn from_events(events: &[UsageEvent]) -> Self {
        let mut by_day = aggregate::group_by(events, Dimension::Day);
        by_day.sort_by(|a, b| a.key.cmp(&b.key));
        UsageView {
            total: aggregate::totals(events),
            by_source: aggregate::group_by(events, Dimension::Source),
            by_day,
            by_model: aggregate::group_by(events, Dimension::Model),
            by_project: aggregate::group_by(events, Dimension::Project),
        }
    }

    /// The breakdown for a given dimension (used by the toggle in the Usage tab).
    pub fn breakdown(&self, dim: Dimension) -> &[Group] {
        match dim {
            Dimension::Day => &self.by_day,
            Dimension::Model => &self.by_model,
            Dimension::Project => &self.by_project,
            Dimension::Source => &self.by_source,
        }
    }
}

/// One health row for the Overview tab.
#[derive(Debug, Clone, PartialEq)]
pub struct HealthRow {
    pub label: String,
    pub status: CheckStatus,
    pub detail: String,
}

/// Flatten a dashboard snapshot into compact health rows.
pub fn health_rows(snapshot: &DashboardSnapshot) -> Vec<HealthRow> {
    snapshot
        .checks
        .iter()
        .map(|c| HealthRow {
            label: c.label.clone(),
            status: c.status.clone(),
            detail: c.message.clone(),
        })
        .collect()
}

/// One editable setting row for the Settings tab.
#[derive(Debug, Clone, PartialEq)]
pub struct SettingRow {
    pub key: &'static str,
    pub value: String,
    pub kind: KeyKind,
}

/// Build the Settings rows from a resolved config (effective values).
pub fn settings_rows(cfg: &Config) -> Vec<SettingRow> {
    config::settable_keys()
        .filter_map(|key| {
            let kind = config::key_kind(key)?;
            let value = config::get_value(cfg, key).ok()?;
            Some(SettingRow { key, value, kind })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_handoff_usage::model::{Source, Tokens, UsageEvent};

    fn ev(source: Source, model: &str, day: &str, t: Tokens) -> UsageEvent {
        UsageEvent {
            source,
            project: "C:/p".into(),
            session: "s".into(),
            model: model.into(),
            day: day.into(),
            tokens: t,
        }
    }

    #[test]
    fn usage_view_orders_days_ascending() {
        let events = vec![
            ev(Source::Codex, "gpt-5.5", "2026-06-18", Tokens { input: 5, ..Default::default() }),
            ev(Source::Codex, "gpt-5.5", "2026-06-16", Tokens { input: 5, ..Default::default() }),
            ev(Source::Codex, "gpt-5.5", "2026-06-17", Tokens { input: 5, ..Default::default() }),
        ];
        let v = UsageView::from_events(&events);
        let days: Vec<&str> = v.by_day.iter().map(|g| g.key.as_str()).collect();
        assert_eq!(days, ["2026-06-16", "2026-06-17", "2026-06-18"]);
    }

    #[test]
    fn breakdown_selects_the_right_dimension() {
        let events = vec![ev(Source::Claude, "claude-opus-4-8", "2026-06-17", Tokens { input: 1, ..Default::default() })];
        let v = UsageView::from_events(&events);
        assert_eq!(v.breakdown(Dimension::Model).len(), 1);
        assert_eq!(v.breakdown(Dimension::Source)[0].key, "claude");
    }

    #[test]
    fn settings_rows_cover_all_keys_with_kinds() {
        let rows = settings_rows(&Config::default());
        assert_eq!(rows.len(), 7);
        let threshold = rows
            .iter()
            .find(|r| r.key == "triggers.five_hour.threshold_percent")
            .unwrap();
        assert_eq!(threshold.value, "80");
        assert_eq!(threshold.kind, KeyKind::Percent);
        let mode = rows.iter().find(|r| r.key == "triggers.five_hour.mode").unwrap();
        assert_eq!(mode.value, "ask");
        assert_eq!(mode.kind, KeyKind::Mode);
    }
}
