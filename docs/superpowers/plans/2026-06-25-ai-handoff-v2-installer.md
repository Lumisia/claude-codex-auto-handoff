# AI Handoff v2 — Installer / Config-Patcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ai-handoff install` / `ai-handoff uninstall` (Windows, both agents) that wire Claude + Codex lifecycle hooks to the v2 native binary and open Codex's sandbox IPC dir — without ever clobbering the user's existing config, and removing only our own entries on uninstall.

**Architecture:** Pure, testable patch logic lives in `ai-handoff-core::install` (detection, plan, format-preserving edits via `toml_edit`/serde_json, surgical removal driven by a recorded `install-state.json`, dry-run diff, backups). IO/approval/Scheduled-Task live in `ai-handoff-cli` commands. All tests run on temp copies; the user's real files are never touched.

**Tech Stack:** Rust 2021, `toml_edit` (format-preserving TOML), `serde`/`serde_json`, `tempfile` (dev). Reuses Sub-project 1 crates (`ai-handoff-core::paths`).

## Global Constraints

Apply to every task implicitly.

- **Never clobber.** Never parse-and-reserialize the whole `config.toml`. Edit it with `toml_edit` (preserves order, comments, literal strings like `'\\?\C:\...'` and quoted keys like `[projects.'c:\...']`). JSON files are key-merged, preserving all existing keys.
- **Uninstall is surgical, not a restore.** Uninstall removes ONLY the entries we added (recorded in `install-state.json`); it must NEVER overwrite a config with a backup. A config that gained unrelated user changes after install must keep them.
- **Backups are a safety net only.** Before first modifying a file, copy it to `<file>.ai-handoff-backup-YYYYMMDD-HHMMSS`. Backups are for manual recovery, never the uninstall path.
- **Idempotent install.** Re-running `install` replaces our managed entries in place; it never duplicates them.
- **Codex from official docs.** Codex formats are grounded in the live docs and re-verified at implementation time, not memory:
  - hooks: `https://developers.openai.com/codex/hooks` — user hooks in `~/.codex/hooks.json`.
  - sandbox writable roots: `https://developers.openai.com/codex/config-reference` — top-level `[sandbox_workspace_write]` with `writable_roots = [..]`.
  - env for spawned hooks: same reference — top-level `[shell_environment_policy]` with `set = { VAR = "value" }`, `inherit ∈ {all,core,none}`.
- **writable_roots gets the IPC dir only**, never the store.
- **v1 duplicate hooks: detect + guide only.** Never auto-edit the v1 plugin's enablement.
- **Windows only** this sub-project. macOS/Linux deferred.
- **Tests use temp copies + a committed fixture** modeled on the real complex `config.toml`. Never read/write the user's real `~/.codex` or `~/.claude`.
- **Commit policy:** per-task LOCAL commit on branch `v2-rust-tauri`, staging only that task's files with explicit paths (never `git add -A`). No push until the whole replatform is complete. Commit body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Environment:** cargo is not on fresh-shell PATH — prepend `export PATH="$HOME/.cargo/bin:$PATH"` in every Bash cargo command. `cargo fmt --all` + `cargo clippy -p <crate> --all-targets -- -D warnings` clean before each commit.
- **Codex review checkpoints:** after Task 9 (core install module complete) and after Task 11 (CLI commands complete).

---

## File Structure

```
crates/ai-handoff-core/
├─ Cargo.toml                      # + toml_edit dep
├─ src/
│  ├─ lib.rs                       # + pub mod install;
│  └─ install/
│     ├─ mod.rs                    # InstallTargets, plan_install/apply_install/apply_uninstall, InstallPlan
│     ├─ detect.rs                 # AgentPresence, target file paths under a configurable root
│     ├─ state.rs                  # InstallState (serde) + load/save
│     ├─ backup.rs                 # timestamped backup copy
│     ├─ codex_hooks.rs            # ~/.codex/hooks.json build/merge/remove
│     ├─ codex_config.rs           # config.toml toml_edit add/remove (writable_roots + env)
│     ├─ claude.rs                 # ~/.claude/settings.json hooks merge/remove
│     ├─ duplicate.rs              # v1 plugin hook detection -> warnings
│     └─ diff.rs                   # dry-run textual diff of a plan
└─ tests/fixtures/
   └─ codex-config-complex.toml    # structural fixture (Task 1)

crates/ai-handoff-cli/
└─ src/commands/
   ├─ install.rs                   # plan/apply, --dry-run/--yes/--agents, schtasks, /hooks reminder
   └─ uninstall.rs                 # surgical removal, --keep-store/--purge-store, schtasks delete
```

`InstallTargets { codex_hooks: PathBuf, codex_config: PathBuf, claude_settings: PathBuf, ipc_dir: PathBuf, home: PathBuf, exe: PathBuf }` is threaded through every function so tests point it at a temp dir.

---

## Task 1: install module scaffold + agent detection + fixture

**Files:**
- Modify: `crates/ai-handoff-core/Cargo.toml` (add `toml_edit = "0.22"`)
- Modify: `crates/ai-handoff-core/src/lib.rs` (`pub mod install;`)
- Create: `crates/ai-handoff-core/src/install/mod.rs`, `crates/ai-handoff-core/src/install/detect.rs`
- Create: `crates/ai-handoff-core/tests/fixtures/codex-config-complex.toml`

**Interfaces:**
- Produces:
  - `pub struct InstallTargets { pub home: PathBuf, pub ipc_dir: PathBuf, pub exe: PathBuf, pub codex_hooks: PathBuf, pub codex_config: PathBuf, pub claude_settings: PathBuf }`
  - `pub fn targets_for(user_home: &Path, ai_home: &Path, ipc_dir: &Path, exe: &Path) -> InstallTargets` — composes the standard paths: `codex_hooks = user_home/.codex/hooks.json`, `codex_config = user_home/.codex/config.toml`, `claude_settings = user_home/.claude/settings.json`.
  - `pub struct AgentPresence { pub codex: bool, pub claude: bool }`
  - `pub fn detect_agents(t: &InstallTargets) -> AgentPresence` — `codex = t.codex_config.parent() exists` (the `~/.codex` dir), `claude = t.claude_settings.parent() exists` (the `~/.claude` dir).

- [ ] **Step 1: Create the fixture** `crates/ai-handoff-core/tests/fixtures/codex-config-complex.toml`

```toml
model = "gpt-5.5"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[windows]
sandbox = "unelevated"

[projects.'C:\Git\vue-test']
trust_level = "trusted"

[projects.'c:\users\pc\desktop\ai-handoff']
trust_level = "trusted"

[marketplaces.claude-codex-auto-handoff]
source_type = "git"
source = "https://github.com/Lumisia/claude-codex-auto-handoff.git"

[hooks.state."ai-handoff@claude-codex-auto-handoff:hooks/hooks-codex.json:session_start:0:0"]
trusted_hash = "sha256:da153a39b78c41074e98983106f871ff8380939cb9c77cf67425096bd1a48481"

[mcp_servers.node_repl]
command = 'C:\Users\PC\AppData\Local\OpenAI\Codex\runtimes\node_repl.exe'

[mcp_servers.node_repl.env]
CODEX_HOME = 'C:\Users\PC\.codex'
```

This deliberately covers: a top-level `sandbox_mode`, a `[windows]` table, quoted backslash project keys, a literal-string path, a `[hooks.state]` v1 entry (for Task 8), `[mcp_servers]` with a literal command path and an `env` sub-table — and crucially has NO `[sandbox_workspace_write]` and NO `[shell_environment_policy]`.

- [ ] **Step 2: Add `toml_edit` and write the failing test** in `detect.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detects_present_agents_and_composes_paths() {
        let dir = tempfile::tempdir().unwrap();
        let uh = dir.path();
        fs::create_dir_all(uh.join(".codex")).unwrap();
        // .claude intentionally absent
        let t = targets_for(uh, &uh.join("ai-home"), &uh.join("ai-home/ipc"), std::path::Path::new("C:/x/ai-handoff.exe"));
        assert_eq!(t.codex_hooks, uh.join(".codex/hooks.json"));
        assert_eq!(t.codex_config, uh.join(".codex/config.toml"));
        assert_eq!(t.claude_settings, uh.join(".claude/settings.json"));
        let p = detect_agents(&t);
        assert!(p.codex);
        assert!(!p.claude);
    }
}
```

Add to `crates/ai-handoff-core/Cargo.toml` under `[dependencies]`: `toml_edit = "0.22"`.

- [ ] **Step 3: Run → FAIL** `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p ai-handoff-core detect` → unresolved `targets_for`/`detect_agents`.

- [ ] **Step 4: Implement `detect.rs` + `mod.rs` skeleton**

`detect.rs`:
```rust
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct InstallTargets {
    pub home: PathBuf,
    pub ipc_dir: PathBuf,
    pub exe: PathBuf,
    pub codex_hooks: PathBuf,
    pub codex_config: PathBuf,
    pub claude_settings: PathBuf,
}

pub fn targets_for(user_home: &Path, ai_home: &Path, ipc_dir: &Path, exe: &Path) -> InstallTargets {
    InstallTargets {
        home: ai_home.to_path_buf(),
        ipc_dir: ipc_dir.to_path_buf(),
        exe: exe.to_path_buf(),
        codex_hooks: user_home.join(".codex").join("hooks.json"),
        codex_config: user_home.join(".codex").join("config.toml"),
        claude_settings: user_home.join(".claude").join("settings.json"),
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AgentPresence { pub codex: bool, pub claude: bool }

pub fn detect_agents(t: &InstallTargets) -> AgentPresence {
    AgentPresence {
        codex: t.codex_config.parent().map(Path::is_dir).unwrap_or(false),
        claude: t.claude_settings.parent().map(Path::is_dir).unwrap_or(false),
    }
}
```
`mod.rs` (skeleton, expanded in Task 9):
```rust
pub mod backup;
pub mod claude;
pub mod codex_config;
pub mod codex_hooks;
pub mod detect;
pub mod diff;
pub mod duplicate;
pub mod state;

pub use detect::{detect_agents, targets_for, AgentPresence, InstallTargets};
```
(Add `pub mod install;` to `lib.rs`. The submodules `backup/claude/...` are created in later tasks; create empty stub files now so `mod.rs` compiles: each containing `// implemented in a later task`. Reorder: only declare a submodule once its file exists — so for Task 1, declare only `detect` in `mod.rs` and add the rest as their tasks land.)

- [ ] **Step 5: Run → PASS.** `cargo test -p ai-handoff-core detect` + `cargo clippy -p ai-handoff-core --all-targets -- -D warnings` + `cargo fmt --all`.

- [ ] **Step 6: Commit (local)**
```bash
git add crates/ai-handoff-core/Cargo.toml crates/ai-handoff-core/src/lib.rs crates/ai-handoff-core/src/install crates/ai-handoff-core/tests/fixtures Cargo.lock
git commit -m "feat(core): install module scaffold + agent detection + config fixture
<body + Co-Authored-By line>"
```

---

## Task 2: `install::state` — install-state.json (removal source of truth)

**Files:**
- Create: `crates/ai-handoff-core/src/install/state.rs`; declare `pub mod state;` in `mod.rs`.

**Interfaces:**
- Produces (all `#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]`):
  - `pub struct InstallState { pub version: u32, pub installed_at: String, pub codex: CodexState, pub claude: ClaudeState, pub scheduled_task: Option<String> }`
  - `pub struct CodexState { pub hooks_file: Option<FileMod>, pub config_file: Option<FileMod>, pub managed_hook_events: Vec<String>, pub writable_root_added: Option<String>, pub created_sandbox_table: bool, pub env_key_added: Option<String>, pub created_env_table: bool }`
  - `pub struct ClaudeState { pub settings_file: Option<FileMod>, pub managed_hook_events: Vec<String> }`
  - `pub struct FileMod { pub path: String, pub backup: Option<String> }`
  - `pub fn state_path(ai_home: &Path) -> PathBuf` → `ai_home/install-state.json`
  - `pub fn load(ai_home: &Path) -> InstallState` (missing/corrupt → `InstallState::default()` with version 1)
  - `pub fn save(ai_home: &Path, st: &InstallState) -> std::io::Result<()>` (atomic write: tmp + rename; creates `ai_home` if missing)

- [ ] **Step 1: Failing test**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrips_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut st = InstallState { version: 1, installed_at: "2026-06-25T00:00:00Z".into(), ..Default::default() };
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
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `state.rs`** with the structs above and atomic `save` (write `state_path` + ".tmp", then `std::fs::rename`). `load` returns `Default::default()` on any read/parse error; ensure `version` defaults to 1 in `Default` impl (implement `Default` manually so version starts at 1).
- [ ] **Step 4: Run → PASS** + clippy + fmt.
- [ ] **Step 5: Commit (local)** staging `crates/ai-handoff-core/src/install/state.rs` and `mod.rs`.

---

## Task 3: `install::backup` — timestamped safety-net backups

**Files:** Create `crates/ai-handoff-core/src/install/backup.rs`; declare in `mod.rs`.

**Interfaces:**
- `pub fn backup_path(file: &Path, now: chrono::DateTime<chrono::Utc>) -> PathBuf` → `<file>.ai-handoff-backup-YYYYMMDD-HHMMSS` (same dir).
- `pub fn backup_file(file: &Path, now: chrono::DateTime<chrono::Utc>) -> std::io::Result<Option<PathBuf>>` — if `file` exists, copy to `backup_path` and return `Some(path)`; if it doesn't exist, return `Ok(None)` (a file we create fresh has nothing to back up).

- [ ] **Step 1: Failing test**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    #[test]
    fn backs_up_existing_file_only() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("config.toml");
        std::fs::write(&f, "model = \"x\"\n").unwrap();
        let now = chrono::Utc.with_ymd_and_hms(2026, 6, 25, 1, 2, 3).unwrap();
        let b = backup_file(&f, now).unwrap().unwrap();
        assert!(b.file_name().unwrap().to_string_lossy().contains("ai-handoff-backup-20260625-010203"));
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "model = \"x\"\n");
        // absent file -> None
        assert!(backup_file(&dir.path().join("nope.json"), now).unwrap().is_none());
    }
}
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `backup_path` (format the timestamp with `now.format("%Y%m%d-%H%M%S")`) and `backup_file` (`std::fs::copy`).
- [ ] **Step 4: Run → PASS** + clippy + fmt.
- [ ] **Step 5: Commit (local).**

---

## Task 4: `install::codex_hooks` — ~/.codex/hooks.json build / merge / remove

**Files:** Create `crates/ai-handoff-core/src/install/codex_hooks.rs`; declare in `mod.rs`.

**Reference:** `https://developers.openai.com/codex/hooks` — re-verify the exact optional field names (`commandWindows`, `timeout`, `matcher`) before emitting; if the live doc differs from the shapes below, follow the doc and note it.

**Interfaces:**
- `pub const EVENTS: [&str; 4] = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"];`
- `pub fn managed_command(exe: &str, event_arg: &str) -> String` → `"\"<exe>\" hook <event_arg> --agent codex"` (event_arg = kebab, e.g. `session-start`).
- `pub fn apply(existing: Option<&str>, exe: &str) -> (String, Vec<String>)` — parse `existing` JSON (or start `{"hooks":{}}`), and for each of the 4 events INSERT our managed hook entry, REPLACING any prior entry of ours (identified by a `"_aiHandoff": true` marker on the inner hook object) while leaving non-ours entries in that event's array. Returns `(pretty_json, managed_event_names)`.
- `pub fn remove(existing: &str) -> String` — drop every inner hook object carrying `"_aiHandoff": true`; prune now-empty event arrays; return pretty JSON.

Hook object shape we write (per event):
```json
{ "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\...\\ai-handoff.exe\" hook stop --agent codex", "_aiHandoff": true, "timeout": 10 } ] }
```

- [ ] **Step 1: Failing tests**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn apply_inserts_four_managed_hooks_idempotently() {
        let exe = "C:\\p\\ai-handoff.exe";
        let (first, events) = apply(None, exe);
        assert_eq!(events.len(), 4);
        let v: Value = serde_json::from_str(&first).unwrap();
        assert!(v["hooks"]["Stop"][0]["hooks"][0]["_aiHandoff"].as_bool().unwrap());
        // idempotent: re-apply over our own output keeps exactly one managed entry per event
        let (second, _) = apply(Some(&first), exe);
        let v2: Value = serde_json::from_str(&second).unwrap();
        assert_eq!(v2["hooks"]["Stop"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn apply_preserves_foreign_hooks_and_remove_strips_only_ours() {
        let foreign = r#"{"hooks":{"Stop":[{"matcher":"*","hooks":[{"type":"command","command":"other"}]}]}}"#;
        let (merged, _) = apply(Some(foreign), "C:\\p\\ai-handoff.exe");
        let v: Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(v["hooks"]["Stop"].as_array().unwrap().len(), 2); // foreign + ours
        let cleaned = remove(&merged);
        let c: Value = serde_json::from_str(&cleaned).unwrap();
        let stop = c["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 1);
        assert_eq!(stop[0]["hooks"][0]["command"], "other");
    }
}
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** using `serde_json::Value`. Map event→kebab arg: SessionStart→session-start, UserPromptSubmit→user-prompt, PostToolUse→post-tool-use, Stop→stop (match the CLI's `HookEventKind::parse` accepted arg spellings from Sub-project 1). For `apply`: ensure `obj["hooks"]` is an object; for each event get-or-create the array, retain entries whose inner `hooks[].\_aiHandoff != true`, then push our entry. Pretty-print with `serde_json::to_string_pretty`.
- [ ] **Step 4: Run → PASS** + clippy + fmt.
- [ ] **Step 5: Commit (local).**

---

## Task 5: `install::codex_config` — config.toml writable_roots + env (toml_edit, never clobber)

**Files:** Create `crates/ai-handoff-core/src/install/codex_config.rs`; declare in `mod.rs`.

**Reference:** `https://developers.openai.com/codex/config-reference` — `[sandbox_workspace_write].writable_roots` (array) and `[shell_environment_policy].set` (table of VAR=value). Re-verify exact keys before emitting.

**Interfaces:**
- `pub struct ConfigEdit { pub text: String, pub writable_root_added: Option<String>, pub created_sandbox_table: bool, pub env_key_added: Option<String>, pub created_env_table: bool }`
- `pub fn apply(existing: Option<&str>, ipc_dir: &str, ai_home: &str) -> ConfigEdit` — parse with `toml_edit::DocumentMut` (empty doc if `None`); ensure `[sandbox_workspace_write]` exists (record if we created it), ensure its `writable_roots` is an array, and push `ipc_dir` only if not already present (record whether we added it); ensure `[shell_environment_policy].set` exists (record table creations) and set `AI_HANDOFF_HOME = ai_home` only if absent (record). Return the serialized doc text + what we did.
- `pub fn remove(existing: &str, st: &crate::install::state::CodexState) -> String` — using the recorded state: remove our `writable_root_added` value from the array (if present); if the array is now empty AND `created_sandbox_table`, remove the `[sandbox_workspace_write]` table. Remove `env_key_added` from `set`; if `set` empty AND `created_env_table`, remove `[shell_environment_policy]`. Return serialized text. Everything else is untouched.

- [ ] **Step 1: Failing tests** (the central never-clobber proof — uses the fixture)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::state::CodexState;

    fn fixture() -> String {
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/codex-config-complex.toml")).unwrap()
    }

    #[test]
    fn adds_two_tables_and_preserves_everything_else() {
        let src = fixture();
        let e = apply(Some(&src), "C:\\Users\\PC\\.ai-handoff\\ipc", "C:\\Users\\PC\\.ai-handoff");
        let doc: toml_edit::DocumentMut = e.text.parse().unwrap();
        // our additions:
        assert!(e.created_sandbox_table);
        assert_eq!(e.writable_root_added.as_deref(), Some("C:\\Users\\PC\\.ai-handoff\\ipc"));
        assert!(doc["sandbox_workspace_write"]["writable_roots"].as_array().unwrap()
            .iter().any(|v| v.as_str() == Some("C:\\Users\\PC\\.ai-handoff\\ipc")));
        assert_eq!(doc["shell_environment_policy"]["set"]["AI_HANDOFF_HOME"].as_str(), Some("C:\\Users\\PC\\.ai-handoff"));
        // preserved (spot-check structurally distinctive bits):
        assert_eq!(doc["sandbox_mode"].as_str(), Some("workspace-write"));
        assert_eq!(doc["windows"]["sandbox"].as_str(), Some("unelevated"));
        assert!(e.text.contains(r#"[projects.'c:\users\pc\desktop\ai-handoff']"#));
        assert!(e.text.contains(r#"command = 'C:\Users\PC\AppData\Local\OpenAI\Codex\runtimes\node_repl.exe'"#));
        assert!(e.text.contains("ai-handoff@claude-codex-auto-handoff:hooks/hooks-codex.json:session_start"));
    }

    #[test]
    fn apply_is_idempotent() {
        let e1 = apply(Some(&fixture()), "C:/ipc", "C:/home");
        let e2 = apply(Some(&e1.text), "C:/ipc", "C:/home");
        let doc: toml_edit::DocumentMut = e2.text.parse().unwrap();
        assert_eq!(doc["sandbox_workspace_write"]["writable_roots"].as_array().unwrap().len(), 1);
        assert!(!e2.created_sandbox_table); // already existed the second time
        assert!(e2.writable_root_added.is_none());
    }

    #[test]
    fn remove_strips_only_ours_and_keeps_user_added_roots() {
        // After install, the user adds another writable root themselves.
        let e = apply(Some(&fixture()), "C:/ipc", "C:/home");
        let mut doc: toml_edit::DocumentMut = e.text.parse().unwrap();
        doc["sandbox_workspace_write"]["writable_roots"].as_array_mut().unwrap()
            .push("C:/user/added/root");
        let after_user = doc.to_string();
        let st = CodexState {
            writable_root_added: Some("C:/ipc".into()),
            created_sandbox_table: true,
            env_key_added: Some("AI_HANDOFF_HOME".into()),
            created_env_table: true,
            ..Default::default()
        };
        let cleaned = remove(&after_user, &st);
        let cdoc: toml_edit::DocumentMut = cleaned.parse().unwrap();
        // our root gone, user's root kept, table NOT removed (non-empty)
        let roots = cdoc["sandbox_workspace_write"]["writable_roots"].as_array().unwrap();
        assert!(roots.iter().all(|v| v.as_str() != Some("C:/ipc")));
        assert!(roots.iter().any(|v| v.as_str() == Some("C:/user/added/root")));
        // env table created solely by us and now empty -> removed
        assert!(cdoc.get("shell_environment_policy").is_none());
        // unrelated content still present
        assert_eq!(cdoc["sandbox_mode"].as_str(), Some("workspace-write"));
    }
}
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with `toml_edit`. Helpers:
  - create-if-absent table: `let created = !doc.contains_key("sandbox_workspace_write"); if created { doc["sandbox_workspace_write"] = toml_edit::table(); }`
  - ensure array: `let wr = doc["sandbox_workspace_write"].as_table_mut().unwrap().entry("writable_roots").or_insert(toml_edit::value(toml_edit::Array::new()));` then `wr.as_array_mut()`.
  - membership check before push; push with `arr.push(ipc_dir)`.
  - env: `[shell_environment_policy].set` as a standard sub-table is semantically equivalent to the inline `set = {..}` and parses identically in Codex — acceptable. Create if absent, set key if absent.
  - `remove`: operate on the parsed doc; after edits, if the array `is_empty()` and `created_sandbox_table` → `doc.remove("sandbox_workspace_write")`; likewise for env.
- [ ] **Step 4: Run → PASS** + clippy + fmt.
- [ ] **Step 5: Commit (local).**

---

## Task 6: `install::claude` — ~/.claude/settings.json hooks merge / remove

**Files:** Create `crates/ai-handoff-core/src/install/claude.rs`; declare in `mod.rs`.

**Interfaces:**
- `pub fn apply(existing: Option<&str>, exe: &str) -> (String, Vec<String>)` — parse settings JSON (or `{}`), ensure `hooks` object; for each of the 4 events (Claude spellings: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`) insert our managed hook using Claude's exec form (`command` + `args`) with a `"_aiHandoff": true` marker, replacing any prior managed entry, preserving foreign entries and all other top-level keys (`model`, `statusLine`, `enabledPlugins`, …). Returns `(pretty_json, events)`.
- `pub fn remove(existing: &str) -> String` — strip our managed entries, prune empty event arrays and an empty `hooks` object; preserve all other keys.

Claude hook object shape (exec form):
```json
{ "hooks": [ { "type": "command", "command": "C:\\...\\ai-handoff.exe", "args": ["hook","stop","--agent","claude-code"], "_aiHandoff": true, "timeout": 10 } ] }
```
(PostToolUse additionally carries `"matcher": "Write|Edit|Bash"`.)

- [ ] **Step 1: Failing tests** — assert: applying over `{"model":"opus","enabledPlugins":{"x":true}}` keeps `model`/`enabledPlugins` and adds 4 hook events; idempotent re-apply keeps one managed entry/event; `remove` strips only ours and keeps `model`/`enabledPlugins` and any foreign hook.
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    #[test]
    fn merge_preserves_other_keys_and_is_idempotent() {
        let base = r#"{"model":"opus","enabledPlugins":{"x":true}}"#;
        let (a, events) = apply(Some(base), "C:\\p\\ai-handoff.exe");
        assert_eq!(events.len(), 4);
        let v: Value = serde_json::from_str(&a).unwrap();
        assert_eq!(v["model"], "opus");
        assert_eq!(v["enabledPlugins"]["x"], true);
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["args"][1], "stop");
        let (b, _) = apply(Some(&a), "C:\\p\\ai-handoff.exe");
        let v2: Value = serde_json::from_str(&b).unwrap();
        assert_eq!(v2["hooks"]["Stop"].as_array().unwrap().len(), 1);
        let cleaned = remove(&b);
        let c: Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(c["model"], "opus");
        assert!(c.get("hooks").map(|h| h.as_object().unwrap().is_empty()).unwrap_or(true));
    }
}
```
- [ ] **Step 2: Run → FAIL. Step 3: Implement** (mirror Task 4's structure, exec form + PostToolUse matcher). **Step 4: Run → PASS** + clippy + fmt. **Step 5: Commit (local).**

---

## Task 7: `install::duplicate` — v1 plugin hook detection

**Files:** Create `crates/ai-handoff-core/src/install/duplicate.rs`; declare in `mod.rs`.

**Interfaces:**
- `pub struct DuplicateFinding { pub agent: &'static str, pub detail: String }`
- `pub fn detect(codex_config_text: Option<&str>, claude_settings_text: Option<&str>) -> Vec<DuplicateFinding>` — Codex: if `config.toml` contains a `[hooks.state."ai-handoff@...hooks-codex.json...]` key (parse with toml_edit, scan `hooks.state` table keys for `ai-handoff@`), push a finding. Claude: if settings `enabledPlugins."ai-handoff@..."` is `true`, push a finding. Each finding's `detail` includes the concrete guidance (Codex: reject in `/hooks`; Claude: set the plugin false / uninstall v1).

- [ ] **Step 1: Failing test** using the fixture (which has the `[hooks.state."ai-handoff@..."]` entry) → expect a Codex finding; and a Claude settings json with `enabledPlugins."ai-handoff@cm":true` → expect a Claude finding; a clean pair → empty.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS** + clippy + fmt. **Step 5: Commit (local).**

---

## Task 8: `install::diff` — dry-run textual diff

**Files:** Create `crates/ai-handoff-core/src/install/diff.rs`; declare in `mod.rs`.

**Interfaces:**
- `pub struct FilePlan { pub path: String, pub before: Option<String>, pub after: String }`
- `pub fn render(plans: &[FilePlan], task_note: &str) -> String` — produce a human-readable summary: for each file, `CREATE` (no before) or `MODIFY`, plus a minimal added/removed line diff (compute line sets; show lines present in `after` but not `before` prefixed `+`, and vice versa `-`). This is a summary, not a full unified diff — enough for the user to see what changes.

- [ ] **Step 1: Failing test** — `render` of a CREATE plan contains `CREATE <path>` and `+` lines; a MODIFY plan with one added line shows that `+` line and no spurious removals.
- [ ] **Step 2: Run → FAIL. Step 3: Implement** (split into lines, set difference preserving order). **Step 4: Run → PASS** + clippy + fmt. **Step 5: Commit (local).**

---

## Task 9: `install::mod` — plan_install / apply_install / apply_uninstall

**Files:** Modify `crates/ai-handoff-core/src/install/mod.rs`.

**Interfaces:**
- Consumes everything above.
- Produces:
  - `pub struct InstallPlan { pub file_plans: Vec<diff::FilePlan>, pub duplicates: Vec<duplicate::DuplicateFinding>, pub agents: AgentPresence }`
  - `pub fn plan_install(t: &InstallTargets, agents: &AgentPresence, now: DateTime<Utc>) -> InstallPlan` — read existing files (if present), compute codex_hooks/codex_config/claude apply outputs into `FilePlan`s (only for present agents), and duplicate findings. No writes.
  - `pub fn apply_install(t: &InstallTargets, agents: &AgentPresence, now: DateTime<Utc>) -> std::io::Result<InstallState>` — for each target: backup (safety net), write the `after` text, and record into `InstallState` (managed events, writable_root_added, created_* flags, env_key_added, backup paths); `state::save`. Creates parent dirs as needed.
  - `pub fn apply_uninstall(t: &InstallTargets, st: &InstallState) -> std::io::Result<()>` — for each recorded file, read current content, run the matching `remove(...)` (codex_hooks::remove / codex_config::remove(.., &st.codex) / claude::remove), write back. Files we created that become empty (`{}` / empty hooks) may be left as-is or removed — leave them (harmless). Does NOT restore backups.

- [ ] **Step 1: Failing integration test** (core, temp dirs) — the round-trip + survival-of-user-changes proof:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn install_then_user_edit_then_uninstall_preserves_user_edit() {
        let dir = tempfile::tempdir().unwrap();
        let uh = dir.path();
        std::fs::create_dir_all(uh.join(".codex")).unwrap();
        std::fs::create_dir_all(uh.join(".claude")).unwrap();
        // seed a complex codex config from the fixture + a claude settings
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/codex-config-complex.toml"), uh.join(".codex/config.toml")).unwrap();
        std::fs::write(uh.join(".claude/settings.json"), r#"{"model":"opus"}"#).unwrap();
        let ai_home = uh.join("ai-home");
        let t = targets_for(uh, &ai_home, &ai_home.join("ipc"), std::path::Path::new("C:/p/ai-handoff.exe"));
        let agents = detect_agents(&t);
        let st = apply_install(&t, &agents, Utc::now()).unwrap();
        assert!(st.codex.created_sandbox_table);

        // user adds an unrelated writable root AFTER install
        let cfg = std::fs::read_to_string(uh.join(".codex/config.toml")).unwrap();
        let mut doc: toml_edit::DocumentMut = cfg.parse().unwrap();
        doc["sandbox_workspace_write"]["writable_roots"].as_array_mut().unwrap().push("C:/user/root");
        std::fs::write(uh.join(".codex/config.toml"), doc.to_string()).unwrap();

        apply_uninstall(&t, &st).unwrap();
        let final_cfg = std::fs::read_to_string(uh.join(".codex/config.toml")).unwrap();
        let fdoc: toml_edit::DocumentMut = final_cfg.parse().unwrap();
        // our ipc root gone, user's root survives, unrelated tables intact
        let roots = fdoc["sandbox_workspace_write"]["writable_roots"].as_array().unwrap();
        assert!(roots.iter().any(|v| v.as_str() == Some("C:/user/root")));
        assert!(roots.iter().all(|v| !v.as_str().unwrap().contains(".ai-home")));
        assert_eq!(fdoc["windows"]["sandbox"].as_str(), Some("unelevated"));
        // claude model preserved, our hooks gone
        let cs: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(uh.join(".claude/settings.json")).unwrap()).unwrap();
        assert_eq!(cs["model"], "opus");
    }
}
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `plan_install`/`apply_install`/`apply_uninstall` wiring the per-target modules + state + backup.
- [ ] **Step 4: Run → PASS** (plus the whole `cargo test -p ai-handoff-core` green) + clippy + fmt.
- [ ] **Step 5: Commit (local).**
- [ ] **Step 6: Codex review checkpoint** — review the whole `install` core module: never-clobber (toml_edit preservation), surgical-removal correctness driven by state, idempotency, backup-is-not-restore, doc-grounded Codex formats. Fix Critical/Important findings; verify uncertain ones.

---

## Task 10: `cli install` command

**Files:** Create `crates/ai-handoff-cli/src/commands/install.rs`; wire into the clap `Cli` (modify `crates/ai-handoff-cli/src/main.rs` / `lib.rs` and `commands/mod.rs`).

**Interfaces:**
- Consumes `ai_handoff_core::install::*`, `ai_handoff_core::paths`.
- Produces `pub fn run(dry_run: bool, yes: bool, agents: Option<Vec<String>>) -> i32`:
  1. Resolve `InstallTargets`: `user_home` = `directories::BaseDirs::home_dir()`; `ai_home` = `paths::home()`; `ipc_dir` = `paths::ipc_dir()`; `exe` = `std::env::current_exe()`.
  2. `detect_agents`, intersect with `--agents` filter if given.
  3. `plan_install` → print the `diff::render` summary and any duplicate findings (guidance).
  4. If `--dry-run`: stop (exit 0).
  5. Else require confirmation unless `--yes` (read y/N from stdin).
  6. `apply_install` → on success register the Scheduled Task (Task 10b helper), print a `/hooks` trust reminder for Codex. Exit 0. On error, print it, exit 1.
- `pub fn scheduled_task_argv(exe: &str) -> Vec<String>` — pure function returning the `schtasks /Create /SC ONLOGON /TN "AI Handoff" /TR "\"<exe>\" daemon run" /RL LIMITED /F` argv (unit-testable); the command itself is executed via `std::process::Command` only in the non-test path.

- [ ] **Step 1: Failing tests** `crates/ai-handoff-cli/tests/install_dry_run.rs`:
  - Build `InstallTargets` under a temp `$HOME` with a `.codex` + `.claude`; run the install *core* `plan_install` (the CLI's testable seam) — assert it writes NOTHING to disk and the rendered plan mentions both files. (Drive the real `run()` via an env override for home if practical; otherwise test `scheduled_task_argv` + the planning path.)
  - `scheduled_task_argv("C:\\p\\ai-handoff.exe")` contains `ONLOGON`, `AI Handoff`, and the quoted exe + `daemon run`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement** `install.rs` + clap subcommand `install { --dry-run, --yes, --agents <csv> }`. Keep `run` thin; do the testable work through core. **Step 4: Run → PASS** + clippy + fmt. **Step 5: Commit (local).**

---

## Task 11: `cli uninstall` command

**Files:** Create `crates/ai-handoff-cli/src/commands/uninstall.rs`; wire into clap.

**Interfaces:**
- `pub fn run(keep_store: bool, purge_store: bool) -> i32`:
  1. Resolve targets as in Task 10. `state::load(ai_home)`.
  2. `apply_uninstall` (surgical removal). Delete the Scheduled Task (`schtasks /Delete /TN "AI Handoff" /F`).
  3. If `--purge-store`: after an explicit confirmation, delete `paths::store_dir()` / config; `--keep-store` (default): leave store/logs.
  4. Print what was removed. Exit 0; non-zero on hard error.
- `pub fn delete_task_argv() -> Vec<String>` — `["/Delete","/TN","AI Handoff","/F"]` (unit-testable).

- [ ] **Step 1: Failing tests** `crates/ai-handoff-cli/tests/uninstall.rs`:
  - End-to-end on temp `$HOME`: seed configs, `apply_install`, then drive `apply_uninstall` (via core), assert our entries gone and a pre-seeded unrelated key preserved (mirror Task 9 but exercised through the CLI seam).
  - `delete_task_argv()` equals the expected vec.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS** + clippy + fmt. **Step 5: Commit (local).**
- [ ] **Step 6: Codex review checkpoint** — review both CLI commands: exit-code discipline, the dry-run-writes-nothing guarantee, schtasks argv correctness, `--purge-store` confirmation gating, never touching real user files in tests.

---

## Task 12: Manual acceptance + docs

**Files:** Modify `docs/v2/mvp-acceptance.md` (add an installer section); update README pointer if needed.

- [ ] **Step 1:** Build release: `export PATH="$HOME/.cargo/bin:$PATH"; cargo build --release`.
- [ ] **Step 2: `--dry-run` on the real machine (read-only):** `target/release/ai-handoff.exe install --dry-run` — confirm it prints a plan touching `~/.codex/hooks.json`, `~/.codex/config.toml`, `~/.claude/settings.json`, lists the v1 duplicate warning, and writes nothing (verify `git -C ~ status`-style: the files' mtimes/content unchanged).
- [ ] **Step 3: Document** the real install/uninstall acceptance steps (install → trust via Codex `/hooks` → run a Codex session → capsule write, no EPERM → uninstall → confirm other config intact) in `docs/v2/mvp-acceptance.md`. Leave the live mutating run for the user to approve.
- [ ] **Step 4: Commit (local)** the docs.

---

## Self-Review (against the spec)

- **Spec coverage:** §2 never-clobber/surgical → Tasks 5/6/9 (+ §13.3 survival test in Task 9); §3 doc-grounded Codex formats → Tasks 4/5 (with URL re-verify notes); §4 architecture (core logic / cli IO) → Tasks 1-9 vs 10-11; §5 commands/flags → Tasks 10/11; §6 patch targets + managed entries → Tasks 4/5/6; §7 v1 duplicate detect+guide → Task 7; §8 backups + install-state → Tasks 2/3/9; §9 Scheduled Task → Tasks 10/11 (`scheduled_task_argv`/`delete_task_argv`); §10 testing on temp copies + real fixture → Task 1 fixture + every task's tests; §11 Codex review checkpoints → Tasks 9/11; §13 success criteria 1-5 → Tasks 4/5/6/9/7, criterion 6 (manual no-EPERM) → Task 12. ✔
- **Placeholder scan:** the only intentional "verify at impl time" items are the Codex hook optional-field names (`commandWindows`/`timeout`/`matcher`), which the spec mandates be checked against the live doc — these are explicit doc-verification steps, not vague TODOs. ✔
- **Type consistency:** `InstallTargets`/`AgentPresence` (T1) consumed by T9/T10/T11; `InstallState`/`CodexState`/`ClaudeState`/`FileMod` (T2) consumed by T5(`remove`)/T9; `ConfigEdit` (T5), `diff::FilePlan` (T8) consumed by T9; `EVENTS`/`apply`/`remove` signatures consistent across T4/T6/T9. `scheduled_task_argv`/`delete_task_argv` defined in T10/T11. ✔
