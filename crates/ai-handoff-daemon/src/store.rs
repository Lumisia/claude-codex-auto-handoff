use ai_handoff_core::{
    capsule::{AgentKind, Capsule, Consumption, ConsumptionState},
    paths,
};
use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub fn save_capsule(c: &Capsule) -> std::io::Result<PathBuf> {
    let path = paths::capsule_path(&c.project_id, &c.capsule_id);
    write_capsule_atomic(&path, c)?;
    Ok(path)
}

pub fn find_pending(project_id: &str) -> Option<Capsule> {
    let dir = paths::project_dir(project_id);
    let entries = std::fs::read_dir(dir).ok()?;

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                return None;
            }

            let bytes = std::fs::read(&path).ok()?;
            let capsule: Capsule = serde_json::from_slice(&bytes).ok()?;
            if capsule.consumption.state != ConsumptionState::Pending {
                return None;
            }

            let created = parse_created_at(&capsule.created_at);
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some((created, modified, capsule))
        })
        .max_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)))
        .map(|(_, _, capsule)| capsule)
}

pub fn mark_consumed(
    project_id: &str,
    capsule_id: &str,
    by: AgentKind,
    now: DateTime<Utc>,
) -> std::io::Result<()> {
    let path = paths::capsule_path(project_id, capsule_id);
    let bytes = std::fs::read(&path)?;
    let mut capsule: Capsule = serde_json::from_slice(&bytes)?;
    capsule.consumption = Consumption {
        state: ConsumptionState::Consumed,
        consumed_by: Some(format_agent(by)),
        consumed_at: Some(now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
    };
    write_capsule_atomic(&path, &capsule)
}

fn write_capsule_atomic(path: &Path, capsule: &Capsule) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(capsule)?;
    std::fs::write(&tmp, bytes)?;
    if std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(path);
        std::fs::rename(&tmp, path)?;
    }
    Ok(())
}

fn parse_created_at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
}

fn format_agent(agent: AgentKind) -> String {
    match agent {
        AgentKind::ClaudeCode => "claude-code".to_string(),
        AgentKind::Codex => "codex".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::env_lock;
    use ai_handoff_core::capsule::{
        AgentKind, Capsule, Consumption, ConsumptionState, RedactionMeta, Session, Summary,
    };
    use chrono::TimeZone;

    fn capsule(id: &str, created_at: &str) -> Capsule {
        Capsule {
            schema_version: 2,
            capsule_id: id.into(),
            project_id: "projX".into(),
            created_at: created_at.into(),
            source_agent: AgentKind::Codex,
            target_agent: AgentKind::ClaudeCode,
            session: Session::default(),
            summary: Summary {
                goal: id.into(),
                done: vec![],
                remaining: vec![],
                risks: vec![],
            },
            files: vec![],
            next_prompt: None,
            redaction: RedactionMeta {
                applied: true,
                ruleset: "default-v2".into(),
            },
            consumption: Consumption {
                state: ConsumptionState::Pending,
                consumed_by: None,
                consumed_at: None,
            },
        }
    }

    #[test]
    fn save_find_pending_and_mark_consumed() {
        let _guard = env_lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());

        save_capsule(&capsule("old", "2026-06-25T12:00:00Z")).unwrap();
        save_capsule(&capsule("new", "2026-06-25T13:00:00Z")).unwrap();

        let pending = find_pending("projX").unwrap();
        assert_eq!(pending.capsule_id, "new");

        mark_consumed(
            "projX",
            "new",
            AgentKind::ClaudeCode,
            chrono::Utc.with_ymd_and_hms(2026, 6, 25, 14, 0, 0).unwrap(),
        )
        .unwrap();

        let pending = find_pending("projX").unwrap();
        assert_eq!(pending.capsule_id, "old");

        std::env::remove_var("AI_HANDOFF_HOME");
    }
}
