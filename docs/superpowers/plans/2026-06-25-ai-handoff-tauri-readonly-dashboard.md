# AI Handoff Tauri Read-Only Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri 2 desktop dashboard that reads local AI Handoff state and add an `aho` command path that opens it from Windows `cmd`.

**Architecture:** `ai-handoff-core` owns read-only dashboard data gathering so CLI and Tauri share one status model. `apps/desktop` is a Tauri 2 + React/Vite/TypeScript shell that calls explicit read-only Tauri commands. `ai-handoff-cli` installs a per-user `aho.cmd` launcher and exposes `dashboard` as a fallback entry point.

**Tech Stack:** Rust workspace, Tauri 2, React, Vite, TypeScript, serde/serde_json/toml_edit, clap, Windows per-user PATH/shim.

## Global Constraints

- GUI must be read-only: opening dashboard must not modify Codex config, Claude settings, capsules, logs, or install state.
- Hook target remains `ai-handoff.exe`; GUI must never be used as Claude/Codex hook target.
- Missing and malformed local files become visible status rows, not startup crashes.
- No arbitrary shell execution from GUI; Tauri commands are typed read-only commands only.
- `aho` must open dashboard from Windows `cmd` after install without administrator rights.
- No git commits or pushes from agents in this session; user owns commits and pushes.

---

## File Structure

- Create `crates/ai-handoff-core/src/dashboard.rs`: typed dashboard snapshot, doctor checks, capsule summaries, log reads, and read-only detection helpers.
- Modify `crates/ai-handoff-core/src/lib.rs`: export `dashboard`.
- Create `apps/desktop/package.json`: frontend scripts and Tauri dependencies.
- Create `apps/desktop/index.html`: Vite entry.
- Create `apps/desktop/tsconfig.json`: TypeScript config.
- Create `apps/desktop/vite.config.ts`: Vite React config.
- Create `apps/desktop/src/main.tsx`: React bootstrap.
- Create `apps/desktop/src/App.tsx`: app shell, tab state, snapshot loading.
- Create `apps/desktop/src/api.ts`: typed Tauri invokes.
- Create `apps/desktop/src/types.ts`: frontend mirror types.
- Create `apps/desktop/src/styles.css`: compact dashboard styling.
- Create `apps/desktop/src/views/Overview.tsx`: first screen status cards.
- Create `apps/desktop/src/views/Doctor.tsx`: checklist view.
- Create `apps/desktop/src/views/Capsules.tsx`: read-only capsule list and JSON panel.
- Create `apps/desktop/src/views/Settings.tsx`: paths and install state.
- Create `apps/desktop/src/views/Logs.tsx`: read-only log viewer.
- Create `apps/desktop/src-tauri/Cargo.toml`: Tauri app crate.
- Create `apps/desktop/src-tauri/build.rs`: Tauri build script.
- Create `apps/desktop/src-tauri/tauri.conf.json`: app config.
- Create `apps/desktop/src-tauri/src/main.rs`: read-only command bridge.
- Modify root `Cargo.toml`: add `apps/desktop/src-tauri` workspace member.
- Modify root `package.json`: add desktop scripts while preserving existing package metadata.
- Create `crates/ai-handoff-cli/src/commands/dashboard.rs`: launch dashboard command.
- Create `crates/ai-handoff-cli/src/commands/launcher.rs`: per-user `aho.cmd` install helpers and HKCU user PATH registration.
- Modify `crates/ai-handoff-cli/src/commands/mod.rs`: export new modules.
- Modify `crates/ai-handoff-cli/src/lib.rs`: add `dashboard` command.
- Modify `crates/ai-handoff-cli/src/commands/install.rs`: install launcher after autostart succeeds and before config writes.
- Modify `crates/ai-handoff-cli/src/commands/uninstall.rs`: remove launcher using state when possible.
- Modify `crates/ai-handoff-core/src/install/state.rs`: record launcher path and PATH entry ownership in install state.
- Add focused tests under existing Rust test modules and CLI integration tests.

---

### Task 1: Core Read-Only Dashboard Model

**Files:**
- Create: `crates/ai-handoff-core/src/dashboard.rs`
- Modify: `crates/ai-handoff-core/src/lib.rs`

**Interfaces:**
- Consumes: `ai_handoff_core::paths`, `ai_handoff_core::capsule::Capsule`, `ai_handoff_core::install::state::InstallState`, `ai_handoff_core::install::duplicate::detect`
- Produces:
  - `pub fn dashboard_snapshot() -> DashboardSnapshot`
  - `pub fn dashboard_snapshot_for(home: &Path, user_home: &Path) -> DashboardSnapshot`
  - `pub fn list_capsules() -> CapsuleList`
  - `pub fn list_capsules_for(home: &Path) -> CapsuleList`
  - `pub fn read_capsule(path: &Path, max_bytes: u64) -> ReadTextResult`
  - `pub fn read_logs(max_bytes: u64) -> Vec<LogFile>`
  - `pub fn read_logs_for(home: &Path, max_bytes: u64) -> Vec<LogFile>`

- [ ] **Step 1: Add failing dashboard tests**

Add tests at the bottom of `crates/ai-handoff-core/src/dashboard.rs` while creating the file. The first failing tests should assert missing/malformed behavior and capsule listing:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::capsule::{
        AgentKind, Capsule, Consumption, ConsumptionState, RedactionMeta, Session, Summary,
    };

    fn write(path: &std::path::Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn capsule(id: &str, project_id: &str, created_at: &str) -> Capsule {
        Capsule {
            schema_version: 2,
            capsule_id: id.into(),
            project_id: project_id.into(),
            created_at: created_at.into(),
            source_agent: AgentKind::ClaudeCode,
            target_agent: AgentKind::Codex,
            session: Session::default(),
            summary: Summary {
                goal: "ship dashboard".into(),
                done: vec!["core model".into()],
                remaining: vec!["ui".into()],
                risks: vec![],
            },
            files: vec![],
            next_prompt: Some("continue".into()),
            redaction: RedactionMeta {
                applied: false,
                ruleset: "none".into(),
            },
            consumption: Consumption {
                state: ConsumptionState::Pending,
                consumed_by: None,
                consumed_at: None,
            },
        }
    }

    #[test]
    fn missing_files_are_reported_not_fatal() {
        let temp = tempfile::tempdir().unwrap();
        let snapshot = dashboard_snapshot_for(temp.path(), temp.path());

        assert_eq!(snapshot.paths.ai_home, temp.path().to_string_lossy());
        assert_eq!(snapshot.install_state.status, CheckStatus::Missing);
        assert_eq!(snapshot.codex_hooks.status, CheckStatus::Missing);
        assert_eq!(snapshot.codex_config.status, CheckStatus::Missing);
        assert_eq!(snapshot.claude_settings.status, CheckStatus::Missing);
        assert_eq!(snapshot.ipc.status, CheckStatus::Missing);
        assert_eq!(snapshot.store.status, CheckStatus::Missing);
    }

    #[test]
    fn malformed_configs_are_parse_errors_without_panic() {
        let temp = tempfile::tempdir().unwrap();
        write(&temp.path().join(".codex/hooks.json"), "{bad json");
        write(&temp.path().join(".codex/config.toml"), "bad = = toml");
        write(&temp.path().join(".claude/settings.json"), "{bad json");

        let snapshot = dashboard_snapshot_for(temp.path().join(".ai-handoff").as_path(), temp.path());

        assert_eq!(snapshot.codex_hooks.status, CheckStatus::Error);
        assert!(snapshot.codex_hooks.message.contains("parse"));
        assert_eq!(snapshot.codex_config.status, CheckStatus::Error);
        assert!(snapshot.codex_config.message.contains("parse"));
        assert_eq!(snapshot.claude_settings.status, CheckStatus::Error);
        assert!(snapshot.claude_settings.message.contains("parse"));
    }

    #[test]
    fn capsule_list_reports_pending_and_skipped_files() {
        let temp = tempfile::tempdir().unwrap();
        let good = capsule("cap_20260625_010101_abcd", "proj-a", "2026-06-25T01:01:01Z");
        let good_path = temp
            .path()
            .join("store/capsules/proj-a/cap_20260625_010101_abcd.json");
        write(&good_path, &serde_json::to_string_pretty(&good).unwrap());
        write(&temp.path().join("store/capsules/proj-a/bad.json"), "{bad json");

        let list = list_capsules_for(temp.path());

        assert_eq!(list.items.len(), 1);
        assert_eq!(list.skipped, 1);
        assert_eq!(list.pending_count, 1);
        assert_eq!(list.items[0].capsule_id, "cap_20260625_010101_abcd");
        assert_eq!(list.items[0].summary_preview, "ship dashboard");
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p ai-handoff-core dashboard::tests`

Expected: compile failure because `dashboard` module and public types/functions are not fully implemented yet.

- [ ] **Step 3: Implement dashboard model**

Create `crates/ai-handoff-core/src/dashboard.rs` with these concrete public types and functions:

```rust
use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    capsule::{Capsule, ConsumptionState},
    install::{duplicate, state},
    paths,
};

const EVENTS: [&str; 4] = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"];
const DEFAULT_TEXT_LIMIT: u64 = 512 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Ok,
    Warning,
    Error,
    Missing,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CheckRow {
    pub id: String,
    pub label: String,
    pub status: CheckStatus,
    pub message: String,
    pub path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct DashboardPaths {
    pub ai_home: String,
    pub ipc: String,
    pub store: String,
    pub logs: String,
    pub install_state: String,
    pub codex_hooks: String,
    pub codex_config: String,
    pub claude_settings: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct InstallSummary {
    pub status: CheckStatus,
    pub version: u32,
    pub installed_at: String,
    pub autostart: String,
    pub launcher: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CapsuleSummary {
    pub capsule_id: String,
    pub project_id: String,
    pub created_at: String,
    pub source_agent: String,
    pub target_agent: String,
    pub state: String,
    pub summary_preview: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CapsuleList {
    pub items: Vec<CapsuleSummary>,
    pub pending_count: usize,
    pub skipped: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ReadTextResult {
    pub path: String,
    pub text: String,
    pub truncated: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct LogFile {
    pub name: String,
    pub result: ReadTextResult,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct DashboardSnapshot {
    pub paths: DashboardPaths,
    pub install_state: InstallSummary,
    pub daemon: CheckRow,
    pub autostart: CheckRow,
    pub codex_hooks: CheckRow,
    pub codex_config: CheckRow,
    pub claude_settings: CheckRow,
    pub ipc: CheckRow,
    pub store: CheckRow,
    pub duplicates: Vec<CheckRow>,
    pub capsules: CapsuleList,
    pub checks: Vec<CheckRow>,
}

pub fn dashboard_snapshot() -> DashboardSnapshot {
    let home = paths::home();
    let user_home = directories::BaseDirs::new()
        .map(|d| d.home_dir().to_path_buf())
        .unwrap_or_else(|| home.clone());
    dashboard_snapshot_for(&home, &user_home)
}

pub fn dashboard_snapshot_for(home: &Path, user_home: &Path) -> DashboardSnapshot {
    let p = dashboard_paths(home, user_home);
    let install_state = read_install_summary(home);
    let codex_hooks_text = fs::read_to_string(&p.codex_hooks).ok();
    let codex_config_text = fs::read_to_string(&p.codex_config).ok();
    let claude_settings_text = fs::read_to_string(&p.claude_settings).ok();

    let codex_hooks = check_codex_hooks(Path::new(&p.codex_hooks), codex_hooks_text.as_deref());
    let codex_config = check_codex_config(Path::new(&p.codex_config), codex_config_text.as_deref(), &p.ipc);
    let claude_settings = check_claude_settings(Path::new(&p.claude_settings), claude_settings_text.as_deref());
    let ipc = check_dir("ipc", "IPC", Path::new(&p.ipc));
    let store = check_dir("store", "Store", Path::new(&p.store));
    let autostart = check_autostart(&install_state);
    let daemon = CheckRow {
        id: "daemon".into(),
        label: "Daemon".into(),
        status: CheckStatus::Unknown,
        message: "Runtime status API not implemented in this MVP".into(),
        path: None,
    };
    let duplicates = duplicate::detect(codex_config_text.as_deref(), claude_settings_text.as_deref())
        .into_iter()
        .enumerate()
        .map(|(idx, finding)| CheckRow {
            id: format!("duplicate-{idx}"),
            label: format!("Duplicate {}", finding.agent),
            status: CheckStatus::Warning,
            message: finding.detail,
            path: None,
        })
        .collect::<Vec<_>>();
    let capsules = list_capsules_for(home);

    let mut checks = vec![
        daemon.clone(),
        autostart.clone(),
        codex_hooks.clone(),
        codex_config.clone(),
        claude_settings.clone(),
        ipc.clone(),
        store.clone(),
    ];
    checks.extend(duplicates.clone());

    DashboardSnapshot {
        paths: p,
        install_state,
        daemon,
        autostart,
        codex_hooks,
        codex_config,
        claude_settings,
        ipc,
        store,
        duplicates,
        capsules,
        checks,
    }
}
```

Continue the same file with private helpers:

```rust
fn dashboard_paths(home: &Path, user_home: &Path) -> DashboardPaths {
    DashboardPaths {
        ai_home: home.to_string_lossy().into_owned(),
        ipc: home.join("ipc").to_string_lossy().into_owned(),
        store: home.join("store").to_string_lossy().into_owned(),
        logs: home.join("logs").to_string_lossy().into_owned(),
        install_state: state::state_path(home).to_string_lossy().into_owned(),
        codex_hooks: user_home.join(".codex/hooks.json").to_string_lossy().into_owned(),
        codex_config: user_home.join(".codex/config.toml").to_string_lossy().into_owned(),
        claude_settings: user_home.join(".claude/settings.json").to_string_lossy().into_owned(),
    }
}

fn read_install_summary(home: &Path) -> InstallSummary {
    let path = state::state_path(home);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return InstallSummary {
                status: CheckStatus::Missing,
                version: 1,
                installed_at: String::new(),
                autostart: "missing".into(),
                launcher: None,
            }
        }
    };
    match serde_json::from_slice::<state::InstallState>(&bytes) {
        Ok(st) => InstallSummary {
            status: CheckStatus::Ok,
            version: st.version,
            installed_at: st.installed_at,
            autostart: st
                .autostart
                .map(|a| format!("{:?}: {}", a.kind, a.name))
                .or(st.scheduled_task.map(|name| format!("ScheduledTask: {name}")))
                .unwrap_or_else(|| "missing".into()),
            launcher: st.launcher.as_ref().and_then(|l| l.path.clone()),
        },
        Err(error) => InstallSummary {
            status: CheckStatus::Error,
            version: 1,
            installed_at: String::new(),
            autostart: format!("parse error: {error}"),
            launcher: None,
        },
    }
}

fn check_dir(id: &str, label: &str, path: &Path) -> CheckRow {
    match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => CheckRow {
            id: id.into(),
            label: label.into(),
            status: CheckStatus::Ok,
            message: "present".into(),
            path: Some(path.to_string_lossy().into_owned()),
        },
        Ok(_) => CheckRow {
            id: id.into(),
            label: label.into(),
            status: CheckStatus::Error,
            message: "path exists but is not a directory".into(),
            path: Some(path.to_string_lossy().into_owned()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CheckRow {
            id: id.into(),
            label: label.into(),
            status: CheckStatus::Missing,
            message: "missing".into(),
            path: Some(path.to_string_lossy().into_owned()),
        },
        Err(error) => CheckRow {
            id: id.into(),
            label: label.into(),
            status: CheckStatus::Error,
            message: error.to_string(),
            path: Some(path.to_string_lossy().into_owned()),
        },
    }
}
```

Implement config helpers using serde_json/toml_edit, preserving read-only behavior:

```rust
fn check_codex_hooks(path: &Path, existing: Option<&str>) -> CheckRow {
    let Some(text) = existing else {
        return missing_row("codex-hooks", "Codex hooks", path);
    };
    let parsed = serde_json::from_str::<Value>(text);
    let value = match parsed {
        Ok(value) => value,
        Err(error) => return error_row("codex-hooks", "Codex hooks", path, format!("parse error: {error}")),
    };
    let hooks = value.get("hooks").and_then(Value::as_object);
    let installed = hooks
        .map(|obj| EVENTS.iter().all(|event| event_has_ai_handoff(obj.get(*event))))
        .unwrap_or(false);
    if installed {
        ok_row("codex-hooks", "Codex hooks", path, "v2 hooks installed")
    } else {
        CheckRow {
            id: "codex-hooks".into(),
            label: "Codex hooks".into(),
            status: CheckStatus::Warning,
            message: "v2 hooks missing or incomplete".into(),
            path: Some(path.to_string_lossy().into_owned()),
        }
    }
}

fn check_claude_settings(path: &Path, existing: Option<&str>) -> CheckRow {
    let Some(text) = existing else {
        return missing_row("claude-settings", "Claude settings", path);
    };
    let parsed = serde_json::from_str::<Value>(text);
    let value = match parsed {
        Ok(value) => value,
        Err(error) => return error_row("claude-settings", "Claude settings", path, format!("parse error: {error}")),
    };
    let hooks = value.get("hooks").and_then(Value::as_object);
    let installed = hooks
        .map(|obj| EVENTS.iter().all(|event| event_has_ai_handoff(obj.get(*event))))
        .unwrap_or(false);
    if installed {
        ok_row("claude-settings", "Claude settings", path, "v2 hooks installed")
    } else {
        CheckRow {
            id: "claude-settings".into(),
            label: "Claude settings".into(),
            status: CheckStatus::Warning,
            message: "v2 hooks missing or incomplete".into(),
            path: Some(path.to_string_lossy().into_owned()),
        }
    }
}

fn check_codex_config(path: &Path, existing: Option<&str>, ipc: &str) -> CheckRow {
    let Some(text) = existing else {
        return missing_row("codex-config", "Codex config", path);
    };
    let doc = match text.parse::<toml_edit::DocumentMut>() {
        Ok(doc) => doc,
        Err(error) => return error_row("codex-config", "Codex config", path, format!("parse error: {error}")),
    };
    let has_root = doc
        .get("sandbox_workspace_write")
        .and_then(|t| t.as_table())
        .and_then(|t| t.get("writable_roots"))
        .and_then(|a| a.as_array())
        .map(|arr| arr.iter().any(|v| v.as_str() == Some(ipc)))
        .unwrap_or(false);
    let has_home = doc
        .get("shell_environment_policy")
        .and_then(|t| t.as_table())
        .and_then(|t| t.get("set"))
        .and_then(|s| s.as_table())
        .and_then(|set| set.get("AI_HANDOFF_HOME"))
        .and_then(|v| v.as_str())
        .is_some();
    if has_root && has_home {
        ok_row("codex-config", "Codex config", path, "writable_roots and AI_HANDOFF_HOME present")
    } else {
        CheckRow {
            id: "codex-config".into(),
            label: "Codex config".into(),
            status: CheckStatus::Warning,
            message: format!("writable_roots={has_root}, AI_HANDOFF_HOME={has_home}"),
            path: Some(path.to_string_lossy().into_owned()),
        }
    }
}
```

Implement capsule/log helpers:

```rust
pub fn list_capsules() -> CapsuleList {
    list_capsules_for(&paths::home())
}

pub fn list_capsules_for(home: &Path) -> CapsuleList {
    let root = home.join("store/capsules");
    let mut items = Vec::new();
    let mut skipped = 0usize;
    if let Ok(projects) = fs::read_dir(root) {
        for project in projects.flatten() {
            if !project.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            if let Ok(files) = fs::read_dir(project.path()) {
                for file in files.flatten() {
                    if file.path().extension().and_then(|s| s.to_str()) != Some("json") {
                        continue;
                    }
                    match fs::read(file.path())
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<Capsule>(&bytes).ok())
                    {
                        Some(capsule) => items.push(summary_from_capsule(capsule, file.path())),
                        None => skipped += 1,
                    }
                }
            }
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let pending_count = items.iter().filter(|i| i.state == "pending").count();
    CapsuleList { items, pending_count, skipped }
}

pub fn read_capsule(path: &Path, max_bytes: u64) -> ReadTextResult {
    read_text(path, max_bytes)
}

pub fn read_logs(max_bytes: u64) -> Vec<LogFile> {
    read_logs_for(&paths::home(), max_bytes)
}

pub fn read_logs_for(home: &Path, max_bytes: u64) -> Vec<LogFile> {
    let logs = home.join("logs");
    ["daemon.log", "hook.log", "install.log"]
        .into_iter()
        .map(|name| LogFile {
            name: name.into(),
            result: read_text(&logs.join(name), max_bytes),
        })
        .collect()
}
```

Add remaining helper functions:

```rust
fn event_has_ai_handoff(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .map(|outer| outer.iter().any(|entry| {
            entry
                .get("hooks")
                .and_then(Value::as_array)
                .map(|inner| inner.iter().any(|hook| hook.get("_aiHandoff").and_then(Value::as_bool) == Some(true)))
                .unwrap_or(false)
        }))
        .unwrap_or(false)
}

fn summary_from_capsule(capsule: Capsule, path: PathBuf) -> CapsuleSummary {
    CapsuleSummary {
        capsule_id: capsule.capsule_id,
        project_id: capsule.project_id,
        created_at: capsule.created_at,
        source_agent: format!("{:?}", capsule.source_agent),
        target_agent: format!("{:?}", capsule.target_agent),
        state: match capsule.consumption.state {
            ConsumptionState::Pending => "pending".into(),
            ConsumptionState::Consumed => "consumed".into(),
        },
        summary_preview: capsule.summary.goal,
        path: path.to_string_lossy().into_owned(),
    }
}

fn read_text(path: &Path, max_bytes: u64) -> ReadTextResult {
    match fs::read(path) {
        Ok(bytes) => {
            let truncated = bytes.len() as u64 > max_bytes;
            let slice_len = bytes.len().min(max_bytes as usize);
            ReadTextResult {
                path: path.to_string_lossy().into_owned(),
                text: String::from_utf8_lossy(&bytes[..slice_len]).into_owned(),
                truncated,
                error: None,
            }
        }
        Err(error) => ReadTextResult {
            path: path.to_string_lossy().into_owned(),
            text: String::new(),
            truncated: false,
            error: Some(error.to_string()),
        },
    }
}

fn check_autostart(install: &InstallSummary) -> CheckRow {
    let status = if install.autostart == "missing" {
        CheckStatus::Warning
    } else {
        CheckStatus::Ok
    };
    CheckRow {
        id: "autostart".into(),
        label: "Autostart".into(),
        status,
        message: install.autostart.clone(),
        path: install.launcher.clone(),
    }
}

fn ok_row(id: &str, label: &str, path: &Path, message: &str) -> CheckRow {
    CheckRow {
        id: id.into(),
        label: label.into(),
        status: CheckStatus::Ok,
        message: message.into(),
        path: Some(path.to_string_lossy().into_owned()),
    }
}

fn missing_row(id: &str, label: &str, path: &Path) -> CheckRow {
    CheckRow {
        id: id.into(),
        label: label.into(),
        status: CheckStatus::Missing,
        message: "missing".into(),
        path: Some(path.to_string_lossy().into_owned()),
    }
}

fn error_row(id: &str, label: &str, path: &Path, message: String) -> CheckRow {
    CheckRow {
        id: id.into(),
        label: label.into(),
        status: CheckStatus::Error,
        message,
        path: Some(path.to_string_lossy().into_owned()),
    }
}
```

- [ ] **Step 4: Export module**

Modify `crates/ai-handoff-core/src/lib.rs`:

```rust
pub mod capsule;
pub mod dashboard;
pub mod fingerprint;
pub mod hook_event;
pub mod install;
pub mod paths;
pub mod redaction;
pub mod sensor;
pub mod trigger;
```

- [ ] **Step 5: Run focused tests**

Run: `cargo test -p ai-handoff-core dashboard::tests`

Expected: PASS.

---

### Task 2: Install State and `aho` Launcher

**Files:**
- Modify: `crates/ai-handoff-core/src/install/state.rs`
- Create: `crates/ai-handoff-cli/src/commands/launcher.rs`
- Create: `crates/ai-handoff-cli/src/commands/dashboard.rs`
- Modify: `crates/ai-handoff-cli/src/commands/mod.rs`
- Modify: `crates/ai-handoff-cli/src/lib.rs`
- Modify: `crates/ai-handoff-cli/src/commands/install.rs`
- Modify: `crates/ai-handoff-cli/src/commands/uninstall.rs`
- Test: `crates/ai-handoff-cli/tests/install_dry_run.rs`
- Test: `crates/ai-handoff-cli/tests/uninstall.rs`

**Interfaces:**
- Consumes: `InstallState`, existing install/uninstall orchestration.
- Produces:
  - `LauncherState { path: Option<String>, path_dir_added: Option<String> }`
  - `launcher::install_aho_launcher(ai_home: &Path, gui_exe: Option<&Path>) -> anyhow::Result<LauncherState>`
  - `launcher::remove_aho_launcher(st: &InstallState) -> anyhow::Result<()>`
  - CLI command `ai-handoff dashboard`

- [ ] **Step 1: Add failing state test**

Append to `crates/ai-handoff-core/src/install/state.rs` tests:

```rust
#[test]
fn roundtrips_launcher_state() {
    let dir = tempfile::tempdir().unwrap();
    let st = InstallState {
        installed_at: "with-launcher".into(),
        launcher: Some(LauncherState {
            path: Some("C:\\Users\\PC\\.ai-handoff\\bin\\aho.cmd".into()),
            path_dir_added: Some("C:\\Users\\PC\\.ai-handoff\\bin".into()),
        }),
        ..Default::default()
    };
    save(dir.path(), &st).unwrap();
    assert_eq!(load(dir.path()), st);
}
```

Expected initial failure: `LauncherState` and `InstallState.launcher` do not exist.

- [ ] **Step 2: Implement install-state launcher field**

Add to `crates/ai-handoff-core/src/install/state.rs`:

```rust
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq, Eq)]
pub struct LauncherState {
    pub path: Option<String>,
    pub path_dir_added: Option<String>,
}
```

Add field to `InstallState`:

```rust
#[serde(default)]
pub launcher: Option<LauncherState>,
```

Add `launcher: None` in `Default for InstallState`.

- [ ] **Step 3: Add launcher helper tests**

Create `crates/ai-handoff-cli/src/commands/launcher.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_aho_cmd_that_starts_gui_when_gui_path_is_known() {
        let dir = tempfile::tempdir().unwrap();
        let gui = dir.path().join("AI Handoff.exe");

        let state = install_aho_launcher(dir.path(), Some(&gui)).unwrap();
        let path = std::path::PathBuf::from(state.path.unwrap());
        let text = std::fs::read_to_string(path).unwrap();

        assert!(text.contains("@echo off"));
        assert!(text.contains("start \"\""));
        assert!(text.contains("AI Handoff.exe"));
    }

    #[test]
    fn remove_launcher_deletes_recorded_cmd() {
        let dir = tempfile::tempdir().unwrap();
        let state = install_aho_launcher(dir.path(), None).unwrap();
        let path = std::path::PathBuf::from(state.path.clone().unwrap());
        assert!(path.exists());

        let install_state = ai_handoff_core::install::state::InstallState {
            launcher: Some(state),
            ..Default::default()
        };
        remove_aho_launcher(&install_state).unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn path_append_preserves_existing_entries_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        let existing = format!("C:\\Windows\\System32;{}", bin.to_string_lossy());

        let (next, added) = append_user_path_entry(&existing, &bin);

        assert_eq!(next, existing);
        assert_eq!(added, None);
    }
}
```

- [ ] **Step 4: Implement launcher helper**

Create `crates/ai-handoff-cli/src/commands/launcher.rs`:

```rust
use std::path::{Path, PathBuf};

use ai_handoff_core::install::state::{InstallState, LauncherState};

pub fn install_aho_launcher(ai_home: &Path, gui_exe: Option<&Path>) -> anyhow::Result<LauncherState> {
    let bin = ai_home.join("bin");
    std::fs::create_dir_all(&bin)?;
    let cmd = bin.join("aho.cmd");
    let target = gui_exe
        .map(Path::to_path_buf)
        .unwrap_or_else(default_dev_dashboard_target);
    let text = format!(
        "@echo off\r\nstart \"\" \"{}\" %*\r\n",
        target.to_string_lossy()
    );
    std::fs::write(&cmd, text)?;
    let path_dir_added = ensure_user_path_contains(&bin)?;
    Ok(LauncherState {
        path: Some(cmd.to_string_lossy().into_owned()),
        path_dir_added,
    })
}

pub fn remove_aho_launcher(st: &InstallState) -> anyhow::Result<()> {
    if let Some(path) = st.launcher.as_ref().and_then(|l| l.path.as_ref()) {
        let p = PathBuf::from(path);
        if p.exists() {
            std::fs::remove_file(p)?;
        }
    }
    if let Some(dir) = st.launcher.as_ref().and_then(|l| l.path_dir_added.as_ref()) {
        remove_user_path_entry(Path::new(dir))?;
    }
    Ok(())
}

fn default_dev_dashboard_target() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("AI Handoff.exe")))
        .unwrap_or_else(|| PathBuf::from("AI Handoff.exe"))
}

#[cfg(windows)]
fn ensure_user_path_contains(bin: &Path) -> anyhow::Result<Option<String>> {
    let current = read_user_path()?;
    let (next, added) = append_user_path_entry(&current, bin);
    if added.is_some() {
        write_user_path(&next)?;
    }
    Ok(added)
}

#[cfg(not(windows))]
fn ensure_user_path_contains(_bin: &Path) -> anyhow::Result<Option<String>> {
    Ok(None)
}

#[cfg(windows)]
fn remove_user_path_entry(bin: &Path) -> anyhow::Result<()> {
    let current = read_user_path()?;
    let bin_text = bin.to_string_lossy().to_string();
    let next = current
        .split(';')
        .filter(|entry| !entry.eq_ignore_ascii_case(&bin_text))
        .collect::<Vec<_>>()
        .join(";");
    if next != current {
        write_user_path(&next)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn remove_user_path_entry(_bin: &Path) -> anyhow::Result<()> {
    Ok(())
}

fn append_user_path_entry(existing: &str, bin: &Path) -> (String, Option<String>) {
    let bin_text = bin.to_string_lossy().to_string();
    if existing.split(';').any(|entry| entry.eq_ignore_ascii_case(&bin_text)) {
        return (existing.to_string(), None);
    }
    let next = if existing.trim().is_empty() {
        bin_text.clone()
    } else {
        format!("{existing};{bin_text}")
    };
    (next, Some(bin_text))
}

#[cfg(windows)]
fn read_user_path() -> anyhow::Result<String> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Environment", "/v", "Path"])
        .output()?;
    if !output.status.success() {
        return Ok(String::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("Path")
                .and_then(|rest| rest.split_once("REG_"))
                .and_then(|(_, rest)| rest.split_once(' '))
                .map(|(_, value)| value.trim().to_string())
        })
        .unwrap_or_default())
}

#[cfg(windows)]
fn write_user_path(value: &str) -> anyhow::Result<()> {
    let status = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Environment",
            "/v",
            "Path",
            "/t",
            "REG_EXPAND_SZ",
            "/d",
            value,
            "/f",
        ])
        .status()?;
    anyhow::ensure!(status.success(), "failed to update HKCU user Path");
    Ok(())
}
```

- [ ] **Step 5: Add `dashboard` CLI command**

Create `crates/ai-handoff-cli/src/commands/dashboard.rs`:

```rust
pub fn run() -> anyhow::Result<i32> {
    let gui = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("AI Handoff.exe")));
    if let Some(gui) = gui {
        if gui.exists() {
            std::process::Command::new(gui).spawn()?;
            return Ok(0);
        }
    }
    eprintln!("AI Handoff dashboard executable not found next to ai-handoff.exe");
    Ok(1)
}
```

Modify `crates/ai-handoff-cli/src/commands/mod.rs`:

```rust
pub mod autostart;
pub mod checkpoint;
pub mod daemon;
pub mod dashboard;
pub mod doctor;
pub mod hook;
pub mod install;
pub mod launcher;
pub mod uninstall;
```

Modify `crates/ai-handoff-cli/src/lib.rs`:

```rust
    Dashboard,
```

inside `Commands`, and:

```rust
        Commands::Dashboard => commands::dashboard::run(),
```

inside `run_cli`.

- [ ] **Step 6: Wire launcher into install/uninstall**

In `crates/ai-handoff-cli/src/commands/install.rs`, after autostart registration succeeds and before state save, set:

```rust
let launcher = crate::commands::launcher::install_aho_launcher(&paths::home(), None)?;
st.launcher = Some(launcher);
```

In `crates/ai-handoff-cli/src/commands/uninstall.rs`, before deleting install state, call:

```rust
crate::commands::launcher::remove_aho_launcher(&st)?;
```

- [ ] **Step 7: Run focused tests**

Run:

```powershell
cargo test -p ai-handoff-core install::state::tests::roundtrips_launcher_state
cargo test -p ai-handoff-cli launcher
```

Expected: PASS.

---

### Task 3: Tauri Backend Scaffold

**Files:**
- Modify: `Cargo.toml`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `ai_handoff_core::dashboard`
- Produces Tauri commands:
  - `get_dashboard_snapshot() -> Result<DashboardSnapshot, String>`
  - `list_capsules() -> Result<CapsuleList, String>`
  - `read_capsule(path: String) -> Result<ReadTextResult, String>`
  - `read_logs() -> Result<Vec<LogFile>, String>`

- [ ] **Step 1: Add workspace member**

Modify root `Cargo.toml` members:

```toml
members = [
    "crates/ai-handoff-core",
    "crates/ai-handoff-ipc",
    "crates/ai-handoff-daemon",
    "crates/ai-handoff-cli",
    "apps/desktop/src-tauri",
]
```

- [ ] **Step 2: Add Tauri crate manifest**

Create `apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "ai-handoff-desktop"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
name = "ai_handoff_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[[bin]]
name = "ai-handoff-desktop"
path = "src/main.rs"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde.workspace = true
serde_json.workspace = true
ai-handoff-core = { path = "../../../crates/ai-handoff-core" }
tauri = { version = "2", features = [] }
```

- [ ] **Step 3: Add Tauri config**

Create `apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 4: Add Tauri config**

Create `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AI Handoff",
  "mainBinaryName": "AI Handoff",
  "version": "2.0.0-mvp",
  "identifier": "com.lumisia.aihandoff",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5174",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "AI Handoff",
        "width": 1180,
        "height": 760,
        "minWidth": 940,
        "minHeight": 640
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": false,
    "targets": "all"
  }
}
```

- [ ] **Step 5: Add backend command bridge**

Create `apps/desktop/src-tauri/src/main.rs`:

```rust
use std::path::PathBuf;

use ai_handoff_core::dashboard::{
    self, CapsuleList, DashboardSnapshot, LogFile, ReadTextResult,
};

const TEXT_LIMIT: u64 = 512 * 1024;

#[tauri::command]
fn get_dashboard_snapshot() -> Result<DashboardSnapshot, String> {
    Ok(dashboard::dashboard_snapshot())
}

#[tauri::command]
fn list_capsules() -> Result<CapsuleList, String> {
    Ok(dashboard::list_capsules())
}

#[tauri::command]
fn read_capsule(path: String) -> Result<ReadTextResult, String> {
    Ok(dashboard::read_capsule(&PathBuf::from(path), TEXT_LIMIT))
}

#[tauri::command]
fn read_logs() -> Result<Vec<LogFile>, String> {
    Ok(dashboard::read_logs(TEXT_LIMIT))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_dashboard_snapshot,
            list_capsules,
            read_capsule,
            read_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Handoff desktop app");
}
```

- [ ] **Step 6: Run backend compile check**

Run: `cargo check -p ai-handoff-desktop`

Expected: PASS after Tauri dependencies resolve.

---

### Task 4: React Dashboard Frontend

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/api.ts`
- Create: `apps/desktop/src/types.ts`
- Create: `apps/desktop/src/styles.css`
- Create: `apps/desktop/src/views/Overview.tsx`
- Create: `apps/desktop/src/views/Doctor.tsx`
- Create: `apps/desktop/src/views/Capsules.tsx`
- Create: `apps/desktop/src/views/Settings.tsx`
- Create: `apps/desktop/src/views/Logs.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes Tauri commands from Task 3.
- Produces Vite build and first-screen dashboard.

- [ ] **Step 1: Add package manifests**

Create `apps/desktop/package.json`:

```json
{
  "name": "ai-handoff-desktop",
  "private": true,
  "version": "2.0.0-mvp",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5174",
    "build": "tsc && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 4174",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "typescript": "^5.6.3",
    "vite": "^5.4.11"
  }
}
```

Modify root `package.json` scripts:

```json
{
  "scripts": {
    "test": "node --test",
    "validate:package": "node scripts/validate-package.mjs",
    "desktop:dev": "npm --prefix apps/desktop run tauri dev",
    "desktop:build": "npm --prefix apps/desktop run build",
    "desktop:tauri:build": "npm --prefix apps/desktop run tauri build"
  }
}
```

- [ ] **Step 2: Add Vite config**

Create `apps/desktop/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Handoff</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": []
}
```

Create `apps/desktop/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
});
```

- [ ] **Step 3: Add frontend types and API**

Create `apps/desktop/src/types.ts`:

```ts
export type CheckStatus = "ok" | "warning" | "error" | "missing" | "unknown";

export interface CheckRow {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  path?: string | null;
}

export interface DashboardPaths {
  ai_home: string;
  ipc: string;
  store: string;
  logs: string;
  install_state: string;
  codex_hooks: string;
  codex_config: string;
  claude_settings: string;
}

export interface InstallSummary {
  status: CheckStatus;
  version: number;
  installed_at: string;
  autostart: string;
  launcher?: string | null;
}

export interface CapsuleSummary {
  capsule_id: string;
  project_id: string;
  created_at: string;
  source_agent: string;
  target_agent: string;
  state: string;
  summary_preview: string;
  path: string;
}

export interface CapsuleList {
  items: CapsuleSummary[];
  pending_count: number;
  skipped: number;
}

export interface ReadTextResult {
  path: string;
  text: string;
  truncated: boolean;
  error?: string | null;
}

export interface LogFile {
  name: string;
  result: ReadTextResult;
}

export interface DashboardSnapshot {
  paths: DashboardPaths;
  install_state: InstallSummary;
  daemon: CheckRow;
  autostart: CheckRow;
  codex_hooks: CheckRow;
  codex_config: CheckRow;
  claude_settings: CheckRow;
  ipc: CheckRow;
  store: CheckRow;
  duplicates: CheckRow[];
  capsules: CapsuleList;
  checks: CheckRow[];
}
```

Create `apps/desktop/src/api.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { CapsuleList, DashboardSnapshot, LogFile, ReadTextResult } from "./types";

export function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  return invoke("get_dashboard_snapshot");
}

export function listCapsules(): Promise<CapsuleList> {
  return invoke("list_capsules");
}

export function readCapsule(path: string): Promise<ReadTextResult> {
  return invoke("read_capsule", { path });
}

export function readLogs(): Promise<LogFile[]> {
  return invoke("read_logs");
}
```

- [ ] **Step 4: Add app shell**

Create `apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `apps/desktop/src/App.tsx`:

```tsx
import { Activity, ClipboardCheck, FolderKanban, Settings, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { getDashboardSnapshot } from "./api";
import type { DashboardSnapshot } from "./types";
import Overview from "./views/Overview";
import Doctor from "./views/Doctor";
import Capsules from "./views/Capsules";
import SettingsView from "./views/Settings";
import Logs from "./views/Logs";

type Tab = "overview" | "doctor" | "capsules" | "settings" | "logs";

const tabs: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "doctor", label: "Doctor", icon: ClipboardCheck },
  { id: "capsules", label: "Capsules", icon: FolderKanban },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "logs", label: "Logs", icon: ScrollText },
];

export default function App() {
  const [active, setActive] = useState<Tab>("overview");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setError(null);
      setSnapshot(await getDashboardSnapshot());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">AH</div>
          <div>
            <h1>AI Handoff</h1>
            <p>Local dashboard</p>
          </div>
        </div>
        <nav>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={active === tab.id ? "nav active" : "nav"}
                onClick={() => setActive(tab.id)}
                title={tab.label}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Read-only MVP</p>
            <h2>{tabs.find((t) => t.id === active)?.label}</h2>
          </div>
          <button className="refresh" onClick={refresh}>Refresh</button>
        </header>
        {error && <section className="error">Failed to load dashboard: {error}</section>}
        {!snapshot && !error && <section className="empty">Loading local state...</section>}
        {snapshot && active === "overview" && <Overview snapshot={snapshot} />}
        {snapshot && active === "doctor" && <Doctor snapshot={snapshot} />}
        {snapshot && active === "capsules" && <Capsules initial={snapshot.capsules} />}
        {snapshot && active === "settings" && <SettingsView snapshot={snapshot} />}
        {snapshot && active === "logs" && <Logs />}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Add views**

Create `Overview.tsx`, `Doctor.tsx`, `Capsules.tsx`, `Settings.tsx`, `Logs.tsx` using the types above. Keep all views read-only. The exact component behavior:

```tsx
// apps/desktop/src/views/Overview.tsx
import type { CheckRow, DashboardSnapshot } from "../types";

function StatusCard({ row }: { row: CheckRow }) {
  return (
    <article className={`card ${row.status}`}>
      <div className="card-head">
        <span>{row.label}</span>
        <strong>{row.status}</strong>
      </div>
      <p>{row.message}</p>
      {row.path && <code>{row.path}</code>}
    </article>
  );
}

export default function Overview({ snapshot }: { snapshot: DashboardSnapshot }) {
  const topRows = [
    snapshot.daemon,
    snapshot.autostart,
    snapshot.codex_hooks,
    snapshot.codex_config,
    snapshot.claude_settings,
    snapshot.ipc,
    snapshot.store,
  ];
  return (
    <div className="view">
      <section className="metrics">
        <div><span>Pending</span><strong>{snapshot.capsules.pending_count}</strong></div>
        <div><span>Total capsules</span><strong>{snapshot.capsules.items.length}</strong></div>
        <div><span>Skipped files</span><strong>{snapshot.capsules.skipped}</strong></div>
        <div><span>Autostart</span><strong>{snapshot.install_state.autostart}</strong></div>
      </section>
      <section className="grid">{topRows.map((row) => <StatusCard key={row.id} row={row} />)}</section>
    </div>
  );
}
```

```tsx
// apps/desktop/src/views/Doctor.tsx
import type { DashboardSnapshot } from "../types";

export default function Doctor({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="view list">
      {snapshot.checks.map((check) => (
        <article className={`row ${check.status}`} key={check.id}>
          <strong>{check.label}</strong>
          <span>{check.status}</span>
          <p>{check.message}</p>
          {check.path && <code>{check.path}</code>}
        </article>
      ))}
    </div>
  );
}
```

```tsx
// apps/desktop/src/views/Capsules.tsx
import { useState } from "react";
import { readCapsule } from "../api";
import type { CapsuleList, CapsuleSummary, ReadTextResult } from "../types";

export default function Capsules({ initial }: { initial: CapsuleList }) {
  const [selected, setSelected] = useState<CapsuleSummary | null>(initial.items[0] ?? null);
  const [raw, setRaw] = useState<ReadTextResult | null>(null);

  async function select(item: CapsuleSummary) {
    setSelected(item);
    setRaw(await readCapsule(item.path));
  }

  return (
    <div className="split view">
      <section className="list">
        {initial.items.length === 0 && <div className="empty">No capsules found.</div>}
        {initial.items.map((item) => (
          <button className="capsule" key={item.path} onClick={() => void select(item)}>
            <strong>{item.summary_preview}</strong>
            <span>{item.source_agent} -> {item.target_agent}</span>
            <small>{item.created_at} · {item.state}</small>
          </button>
        ))}
      </section>
      <section className="panel">
        {!selected && <div className="empty">Select a capsule.</div>}
        {selected && (
          <>
            <h3>{selected.capsule_id}</h3>
            <p>{selected.project_id}</p>
            <code>{selected.path}</code>
            <pre>{raw?.text ?? "Select item to load raw JSON."}</pre>
          </>
        )}
      </section>
    </div>
  );
}
```

```tsx
// apps/desktop/src/views/Settings.tsx
import type { DashboardSnapshot } from "../types";

export default function SettingsView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="view list">
      {Object.entries(snapshot.paths).map(([key, value]) => (
        <article className="row" key={key}>
          <strong>{key}</strong>
          <code>{value}</code>
        </article>
      ))}
      <article className="row">
        <strong>Install state</strong>
        <p>version {snapshot.install_state.version}</p>
        <p>{snapshot.install_state.installed_at || "not installed"}</p>
      </article>
    </div>
  );
}
```

```tsx
// apps/desktop/src/views/Logs.tsx
import { useEffect, useState } from "react";
import { readLogs } from "../api";
import type { LogFile } from "../types";

export default function Logs() {
  const [logs, setLogs] = useState<LogFile[]>([]);
  useEffect(() => {
    void readLogs().then(setLogs);
  }, []);
  return (
    <div className="view list">
      {logs.map((log) => (
        <article className="row" key={log.name}>
          <strong>{log.name}</strong>
          {log.result.error && <p>{log.result.error}</p>}
          {!log.result.error && <pre>{log.result.text || "Empty log."}</pre>}
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Add styling**

Create `apps/desktop/src/styles.css` with compact dashboard styling. Use fixed sidebar, responsive grid, and no nested cards:

```css
:root {
  color: #182026;
  background: #f7f8f5;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 940px; min-height: 640px; }
button { font: inherit; }
code, pre { font-family: "JetBrains Mono", Consolas, monospace; }

.app { display: grid; grid-template-columns: 248px 1fr; min-height: 100vh; }
.sidebar { background: #13201d; color: #f3f6f2; padding: 20px 16px; }
.brand { display: flex; gap: 12px; align-items: center; margin-bottom: 28px; }
.mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 8px; background: #79b18c; color: #0d1513; font-weight: 800; }
.brand h1 { font-size: 18px; margin: 0; letter-spacing: 0; }
.brand p { margin: 2px 0 0; color: #b7c6be; font-size: 13px; }
nav { display: grid; gap: 6px; }
.nav { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; border-radius: 6px; padding: 10px; background: transparent; color: #dce6df; cursor: pointer; }
.nav.active, .nav:hover { background: #243631; color: white; }
main { padding: 24px; overflow: auto; }
.topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.topbar h2 { margin: 0; font-size: 28px; letter-spacing: 0; }
.eyebrow { margin: 0 0 4px; color: #5b6b62; font-size: 12px; text-transform: uppercase; }
.refresh { border: 1px solid #b8c3bc; background: white; border-radius: 6px; padding: 9px 14px; cursor: pointer; }
.view { display: grid; gap: 16px; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.metrics div { background: white; border: 1px solid #d9ded8; border-radius: 8px; padding: 14px; }
.metrics span { display: block; color: #65746b; font-size: 12px; }
.metrics strong { display: block; margin-top: 8px; font-size: 22px; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.card, .row, .panel { background: white; border: 1px solid #d9ded8; border-radius: 8px; padding: 14px; }
.card-head { display: flex; justify-content: space-between; gap: 12px; }
.card p, .row p { color: #53625a; }
.card code, .row code { display: block; color: #34443c; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.ok { border-left: 4px solid #3f8f5c; }
.warning, .missing, .unknown { border-left: 4px solid #c2902f; }
.error { border-left: 4px solid #c44f4f; }
.list { align-content: start; }
.row { display: grid; gap: 6px; }
.row span { width: fit-content; border-radius: 999px; padding: 2px 8px; background: #eef2ef; font-size: 12px; }
.split { grid-template-columns: 360px minmax(0, 1fr); align-items: start; }
.capsule { width: 100%; text-align: left; border: 1px solid #d9ded8; background: white; border-radius: 8px; padding: 12px; display: grid; gap: 6px; cursor: pointer; }
.capsule span, .capsule small { color: #5c6b63; }
pre { max-height: 420px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: #f1f4f1; border-radius: 6px; padding: 12px; }
.empty { background: white; border: 1px dashed #c8d0ca; border-radius: 8px; padding: 18px; color: #65746b; }
```

- [ ] **Step 7: Run frontend build**

Run: `npm install` from `apps/desktop`, then `npm run build` from `apps/desktop`.

Expected: TypeScript and Vite build PASS.

---

### Task 5: End-to-End Verification and Live Launcher Check

**Files:**
- No new implementation files unless tests reveal a defect.
- Modify `docs/v2/mvp-acceptance.md` if verification changes acceptance status.

**Interfaces:**
- Consumes tasks 1-4.
- Produces verified local Tauri MVP and `aho` launcher behavior.

- [ ] **Step 1: Run Rust workspace tests**

Run: `cargo test --workspace`

Expected: PASS.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy --workspace --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 3: Build release CLI**

Run: `cargo build --release`

Expected: PASS.

- [ ] **Step 4: Build desktop frontend**

Run: `npm --prefix apps/desktop run build`

Expected: PASS.

- [ ] **Step 5: Build/check Tauri app**

Run: `npm --prefix apps/desktop run tauri build`

Expected: PASS or a specific missing-system-prerequisite error. If the error is missing WebView2/MSVC/Tauri dependency, record exact error and do not claim desktop packaging complete.

- [ ] **Step 6: Safe dry-run install check**

Run: `target\\release\\ai-handoff.exe install --dry-run`

Expected: output includes `Dry run only; no files were changed` and no v1 duplicate warning.

- [ ] **Step 7: Live launcher install check**

Only after all build checks pass, run live install:

```powershell
target\release\ai-handoff.exe install --yes
```

Expected:

- install exits 0
- `C:\Users\PC\.ai-handoff\bin\aho.cmd` exists
- `C:\Users\PC\.ai-handoff\install-state.json` records `launcher.path`
- HKCU user `Path` contains `C:\Users\PC\.ai-handoff\bin` when installer added it
- existing Codex and Claude v2 config remains installed

- [ ] **Step 8: Confirm `aho` from `cmd`**

Run:

```powershell
cmd /c aho
```

Expected: `cmd` resolves `aho` through the per-user PATH entry and starts the dashboard process. If the current terminal inherited an older PATH, verify the registry value with `reg query HKCU\Environment /v Path` and run `cmd /c "%USERPROFILE%\.ai-handoff\bin\aho.cmd"`.

- [ ] **Step 9: Update acceptance doc**

Update `docs/v2/mvp-acceptance.md` with:

- Tauri dashboard build status.
- `aho` launcher status.
- Any remaining packaging caveat.

- [ ] **Step 10: Final review package**

Report:

- changed files
- commands run and results
- whether `aho` works from `cmd`
- whether any config files were modified beyond installer-owned launcher/install-state fields
- remaining work: packaging/updater/tray/repair buttons only

---

## Self-Review

- Spec coverage: Task 1 covers read-only local state, malformed files, capsules, logs. Task 2 covers `aho`. Task 3 covers Tauri backend. Task 4 covers Overview/Doctor/Capsules/Settings/Logs. Task 5 covers verification and acceptance doc.
- Marker scan: no open-ended implementation steps remain.
- Type consistency: Rust and TypeScript use matching snake_case fields because serde default field names are snake_case; frontend interfaces mirror the Rust structs exactly.
