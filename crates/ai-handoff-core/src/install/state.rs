use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct FileMod {
    pub path: String,
    pub backup: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct CodexState {
    pub hooks_file: Option<FileMod>,
    pub config_file: Option<FileMod>,
    pub managed_hook_events: Vec<String>,
    pub writable_root_added: Option<String>,
    pub created_sandbox_table: bool,
    pub env_key_added: Option<String>,
    pub created_env_table: bool,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct ClaudeState {
    pub settings_file: Option<FileMod>,
    pub managed_hook_events: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct InstallState {
    pub version: u32,
    pub installed_at: String,
    pub codex: CodexState,
    pub claude: ClaudeState,
    pub scheduled_task: Option<String>,
}

impl Default for InstallState {
    fn default() -> Self {
        Self {
            version: 1,
            installed_at: String::new(),
            codex: CodexState::default(),
            claude: ClaudeState::default(),
            scheduled_task: None,
        }
    }
}

pub fn state_path(ai_home: &Path) -> PathBuf {
    ai_home.join("install-state.json")
}

pub fn load(ai_home: &Path) -> InstallState {
    let p = state_path(ai_home);
    let bytes = match std::fs::read(&p) {
        Ok(b) => b,
        Err(_) => return InstallState::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn save(ai_home: &Path, st: &InstallState) -> std::io::Result<()> {
    std::fs::create_dir_all(ai_home)?;
    let p = state_path(ai_home);
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(st)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&tmp, &json)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut st = InstallState {
            version: 1,
            installed_at: "2026-06-25T00:00:00Z".into(),
            ..Default::default()
        };
        st.codex.managed_hook_events = vec!["SessionStart".into(), "Stop".into()];
        st.codex.writable_root_added = Some("C:/Users/PC/.ai-handoff/ipc".into());
        st.codex.created_sandbox_table = true;
        save(dir.path(), &st).unwrap();
        let back = load(dir.path());
        assert_eq!(back, st);
    }

    #[test]
    fn missing_state_is_default_v1() {
        let dir = tempfile::tempdir().unwrap();
        let st = load(dir.path());
        assert!(st.codex.managed_hook_events.is_empty());
    }
}
