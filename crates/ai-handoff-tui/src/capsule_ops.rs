//! Disk mutations for the Capsule tab: toggle the consumption state, edit the
//! summary goal, and delete. Each reads the capsule JSON, applies one minimal
//! change, and writes it back (pretty + atomic via tmp+rename) — matching the
//! daemon's on-disk format so the two never disagree.

use std::path::Path;

use ai_handoff_core::capsule::{Capsule, ConsumptionState};

#[derive(Debug)]
pub enum CapsuleOpError {
    Io(std::io::Error),
    Parse(serde_json::Error),
}

impl std::fmt::Display for CapsuleOpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CapsuleOpError::Io(e) => write!(f, "io error: {e}"),
            CapsuleOpError::Parse(e) => write!(f, "not a valid capsule: {e}"),
        }
    }
}

fn load(path: &Path) -> Result<Capsule, CapsuleOpError> {
    let bytes = std::fs::read(path).map_err(CapsuleOpError::Io)?;
    serde_json::from_slice(&bytes).map_err(CapsuleOpError::Parse)
}

fn store(path: &Path, capsule: &Capsule) -> Result<(), CapsuleOpError> {
    let bytes = serde_json::to_vec_pretty(capsule).map_err(CapsuleOpError::Parse)?;
    write_atomic(path, &bytes).map_err(CapsuleOpError::Io)
}

/// Write bytes to `path` atomically: a sibling `.tmp` then rename over target.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    if std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(path);
        std::fs::rename(&tmp, path)?;
    }
    Ok(())
}

/// Flip Pending <-> Consumed. Returns the new state ("pending" / "consumed").
pub fn toggle_state(path: &Path) -> Result<String, CapsuleOpError> {
    let mut capsule = load(path)?;
    let new = match capsule.consumption.state {
        ConsumptionState::Pending => {
            capsule.consumption.state = ConsumptionState::Consumed;
            capsule.consumption.consumed_by = Some("ai-handoff-tui".to_string());
            capsule.consumption.consumed_at =
                Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
            "consumed"
        }
        ConsumptionState::Consumed => {
            capsule.consumption.state = ConsumptionState::Pending;
            capsule.consumption.consumed_by = None;
            capsule.consumption.consumed_at = None;
            "pending"
        }
    };
    store(path, &capsule)?;
    Ok(new.to_string())
}

/// A capsule field the user can edit from the detail pane. These are the parts
/// that steer the next agent: the goal, the explicit handoff prompt, and the
/// done / remaining / risks lists. (Ids, timestamps, redaction and the file
/// list are left read-only — editing them would misrepresent what happened.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapField {
    Goal,
    NextPrompt,
    Remaining,
    Done,
    Risks,
}

impl CapField {
    pub fn label(self) -> &'static str {
        match self {
            CapField::Goal => "Goal",
            CapField::NextPrompt => "Next prompt",
            CapField::Remaining => "Remaining",
            CapField::Done => "Done",
            CapField::Risks => "Risks",
        }
    }

    /// List fields are edited as ` | `-separated items on one line.
    pub fn is_list(self) -> bool {
        matches!(self, CapField::Remaining | CapField::Done | CapField::Risks)
    }
}

const LIST_SEP: &str = " | ";

/// The current editable text for `field` (list fields joined by ` | `).
pub fn field_text(capsule: &Capsule, field: CapField) -> String {
    match field {
        CapField::Goal => capsule.summary.goal.clone(),
        CapField::NextPrompt => capsule.next_prompt.clone().unwrap_or_default(),
        CapField::Remaining => capsule.summary.remaining.join(LIST_SEP),
        CapField::Done => capsule.summary.done.join(LIST_SEP),
        CapField::Risks => capsule.summary.risks.join(LIST_SEP),
    }
}

/// Apply edited `text` to `field` and write the capsule back. List fields are
/// split on `|`; an empty next-prompt clears it to `null`.
pub fn set_field(path: &Path, field: CapField, text: &str) -> Result<(), CapsuleOpError> {
    let mut capsule = load(path)?;
    match field {
        CapField::Goal => capsule.summary.goal = text.to_string(),
        CapField::NextPrompt => {
            capsule.next_prompt = if text.trim().is_empty() {
                None
            } else {
                Some(text.to_string())
            };
        }
        CapField::Remaining => capsule.summary.remaining = split_list(text),
        CapField::Done => capsule.summary.done = split_list(text),
        CapField::Risks => capsule.summary.risks = split_list(text),
    }
    store(path, &capsule)
}

fn split_list(text: &str) -> Vec<String> {
    text.split('|')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// Delete the capsule file.
pub fn delete(path: &Path) -> Result<(), CapsuleOpError> {
    std::fs::remove_file(path).map_err(CapsuleOpError::Io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_handoff_core::capsule::{
        AgentKind, Capsule, Consumption, ConsumptionState, RedactionMeta, Session, Summary,
    };

    fn sample() -> Capsule {
        Capsule {
            schema_version: 2,
            capsule_id: "cap_1".into(),
            project_id: "projX".into(),
            created_at: "2026-06-25T12:00:00Z".into(),
            source_agent: AgentKind::Codex,
            target_agent: AgentKind::ClaudeCode,
            session: Session::default(),
            summary: Summary {
                goal: "ship it".into(),
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

    fn write_sample(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("cap_1.json");
        std::fs::write(&path, serde_json::to_vec_pretty(&sample()).unwrap()).unwrap();
        path
    }

    #[test]
    fn toggle_state_round_trips_pending_and_consumed() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample(dir.path());

        assert_eq!(toggle_state(&path).unwrap(), "consumed");
        let c: Capsule = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(c.consumption.state, ConsumptionState::Consumed);
        assert!(c.consumption.consumed_at.is_some());

        assert_eq!(toggle_state(&path).unwrap(), "pending");
        let c: Capsule = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(c.consumption.state, ConsumptionState::Pending);
        assert!(c.consumption.consumed_at.is_none());
    }

    #[test]
    fn set_field_goal_updates_only_the_goal() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample(dir.path());
        set_field(&path, CapField::Goal, "new goal").unwrap();
        let c: Capsule = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(c.summary.goal, "new goal");
        assert_eq!(c.capsule_id, "cap_1"); // untouched
    }

    #[test]
    fn set_field_list_splits_on_pipe_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample(dir.path());
        set_field(&path, CapField::Remaining, "wire rotation | add rate limit |  ").unwrap();
        let c: Capsule = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(c.summary.remaining, vec!["wire rotation", "add rate limit"]);
        // and field_text re-joins them for editing
        assert_eq!(
            field_text(&c, CapField::Remaining),
            "wire rotation | add rate limit"
        );
    }

    #[test]
    fn set_field_next_prompt_empty_clears_to_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample(dir.path());
        set_field(&path, CapField::NextPrompt, "do the thing").unwrap();
        let c: Capsule = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(c.next_prompt.as_deref(), Some("do the thing"));
        set_field(&path, CapField::NextPrompt, "   ").unwrap();
        let c: Capsule = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(c.next_prompt.is_none());
    }

    #[test]
    fn delete_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample(dir.path());
        delete(&path).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn parse_error_on_non_capsule_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, "{\"nope\":1}").unwrap();
        assert!(matches!(toggle_state(&path), Err(CapsuleOpError::Parse(_))));
    }
}
