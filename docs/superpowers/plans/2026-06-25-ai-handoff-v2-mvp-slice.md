# AI Handoff v2 — MVP Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Rust native hook shim + out-of-sandbox daemon that lets Codex (and Claude) save and inject handoff capsules on Windows with **no EPERM**, end-to-end.

**Architecture:** A single Rust CLI binary is the hook target. It does no store I/O — it serializes the hook event to a file under the IPC dir and polls for a response. A separate daemon process, running outside the Codex sandbox, watches the IPC dir, performs all store writes, and writes the response. Because the daemon is the *only* writer, the elaborate lease/claim/lock state machine from v1 is replaced by simple atomic writes.

**Tech Stack:** Rust (edition 2021, stable), Cargo workspace, serde/serde_json, sha2, uuid, chrono, clap, thiserror, anyhow, tracing. No async runtime required for the MVP (blocking file IPC with a poll loop).

## Global Constraints

These apply to **every** task implicitly.

- **Rust edition 2021**, stable toolchain. `cargo fmt` clean, `cargo clippy --all-targets -- -D warnings` clean.
- **No interim commits or pushes.** All work stays uncommitted in the working tree on branch `v2-rust-tauri`. A single commit + push happens only when the entire replatform (all sub-projects) is complete, bumping to **v2.0.1**. Plan steps therefore end at a **checkpoint** (tests green), never `git commit`.
- **Full replacement:** Node v1 is being retired. Its source remains in the tree *only* as a porting reference and test oracle during development; do not wire v2 to call it.
- **Windows home = `%USERPROFILE%\.ai-handoff`** (NOT `%LOCALAPPDATA%`). This deliberately differs from v1 to avoid the MSIX/Store AppData redirection split.
- **MVP boundaries:** file IPC only (no named pipe/UDS); JSON store (no SQLite); JSONL-only sensor for `usedPercent` (no appserver/shadow/statusline); daemon started manually via `daemon run`.
- **Hook never breaks agent UX:** on daemon-unavailable, timeout, or parse failure, the hook prints `{}` to stdout and exits 0. Manual (non-hook) commands may exit non-zero.
- **Fingerprint byte-parity:** `ai-handoff-core` fingerprint output must equal v1 `core/lib/fingerprint.mjs` for identical inputs — `sha256(basis.value)` truncated to 24 lowercase hex chars. v1 `tests/fingerprint.test.mjs` is the oracle.
- **Codex review checkpoint** after each crate is completed (core, ipc, daemon, cli). Fix correctness/security/regression findings; verify uncertain findings before acting; Codex does not gate by itself.
- **Workspace dependencies** (pin in root `Cargo.toml [workspace.dependencies]`): `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`, `toml = "0.8"`, `thiserror = "2"`, `anyhow = "1"`, `directories = "5"`, `uuid = { version = "1", features = ["v4", "serde"] }`, `sha2 = "0.10"`, `chrono = { version = "0.4", features = ["serde"] }`, `tracing = "0.1"`, `clap = { version = "4", features = ["derive"] }`, `tempfile = "3"` (dev).

---

## File Structure

```
ai-handoff/
├─ Cargo.toml                         # [workspace] members + [workspace.dependencies]
├─ crates/
│  ├─ ai-handoff-core/
│  │  ├─ Cargo.toml
│  │  └─ src/
│  │     ├─ lib.rs                     # re-exports
│  │     ├─ paths.rs                   # AI_HANDOFF_HOME resolution + dir layout
│  │     ├─ fingerprint.rs             # project fingerprint port (HIGH RISK)
│  │     ├─ capsule.rs                 # v2-subset capsule structs + ids + integrity
│  │     ├─ redaction.rs               # secret redaction before store write
│  │     ├─ trigger.rs                 # evaluate_trigger + burn-rate projection
│  │     ├─ hook_event.rs              # NormalizedHookEvent + Codex/Claude parsers
│  │     └─ sensor.rs                  # used_percent from JSONL
│  ├─ ai-handoff-ipc/
│  │  ├─ Cargo.toml
│  │  └─ src/
│  │     ├─ lib.rs
│  │     ├─ protocol.rs                # Request/Response wire types
│  │     ├─ client.rs                  # write request, poll response (hook side)
│  │     └─ server.rs                  # watch requests, dispatch, write response
│  ├─ ai-handoff-daemon/
│  │  ├─ Cargo.toml
│  │  └─ src/
│  │     ├─ main.rs                    # `daemon run`
│  │     ├─ store.rs                   # capsule write/read, pending lookup (atomic)
│  │     ├─ dedupe.rs                  # event dedupe keys
│  │     └─ router.rs                  # NormalizedHookEvent -> hook_stdout
│  └─ ai-handoff-cli/
│     ├─ Cargo.toml
│     └─ src/
│        ├─ main.rs                    # clap entry
│        └─ commands/
│           ├─ hook.rs                 # the hook target
│           ├─ daemon.rs               # `daemon run` shim -> ai-handoff-daemon
│           ├─ doctor.rs              # reduced doctor
│           └─ checkpoint.rs           # manual capsule checkpoint
└─ tests/                              # workspace-level integration tests
   └─ e2e_hook_daemon.rs
```

Dependency direction: `cli` → {`core`, `ipc`, `daemon`}; `daemon` → {`core`, `ipc`}; `ipc` → (`core` only for protocol payload types); `core` → none (leaf).

---

## Task 1: Toolchain bootstrap + workspace skeleton

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `crates/ai-handoff-core/Cargo.toml`, `crates/ai-handoff-core/src/lib.rs`
- Create: `crates/ai-handoff-ipc/Cargo.toml`, `crates/ai-handoff-ipc/src/lib.rs`
- Create: `crates/ai-handoff-daemon/Cargo.toml`, `crates/ai-handoff-daemon/src/main.rs`
- Create: `crates/ai-handoff-cli/Cargo.toml`, `crates/ai-handoff-cli/src/main.rs`

**Interfaces:**
- Produces: a compiling 4-crate workspace; `cargo build` and `cargo test` succeed.

- [ ] **Step 1: Install Rust toolchain + Windows linker**

Run (PowerShell):
```
winget install --id Rustlang.Rustup -e --source winget
```
Then confirm the MSVC C++ build tools are present (Tauri/Windows linker needs `link.exe`). If `rustup default stable` later fails to link, install "Desktop development with C++" via:
```
winget install --id Microsoft.VisualStudio.2022.BuildTools -e
```
Verify:
```
rustc --version
cargo --version
```
Expected: both print versions (e.g. `rustc 1.8x.x`). If `rustc` is not found, open a new shell so PATH refreshes.

- [ ] **Step 2: Write the workspace root `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = [
    "crates/ai-handoff-core",
    "crates/ai-handoff-ipc",
    "crates/ai-handoff-daemon",
    "crates/ai-handoff-cli",
]

[workspace.package]
version = "2.0.0-mvp"
edition = "2021"
license = "MIT"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
thiserror = "2"
anyhow = "1"
directories = "5"
uuid = { version = "1", features = ["v4", "serde"] }
sha2 = "0.10"
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
clap = { version = "4", features = ["derive"] }
tempfile = "3"
```

- [ ] **Step 3: Create the four crate manifests + stub roots**

`crates/ai-handoff-core/Cargo.toml`:
```toml
[package]
name = "ai-handoff-core"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
sha2.workspace = true
uuid.workspace = true
chrono.workspace = true
thiserror.workspace = true

[dev-dependencies]
tempfile.workspace = true
```

`crates/ai-handoff-core/src/lib.rs`:
```rust
pub mod paths;
```
(Add a one-line `pub mod` per module as later tasks create them. For this task `paths` does not exist yet, so leave `lib.rs` empty: `// modules added per task`.)

Create the analogous `Cargo.toml` for `ai-handoff-ipc` (deps: serde, serde_json, uuid, thiserror, ai-handoff-core via `path = "../ai-handoff-core"`), `ai-handoff-daemon` (deps: the two above + anyhow, tracing; `[[bin]] name = "ai-handoff-daemon"`), and `ai-handoff-cli` (deps: all three + clap, anyhow; `[[bin]] name = "ai-handoff"`).

`crates/ai-handoff-daemon/src/main.rs` and `crates/ai-handoff-cli/src/main.rs`:
```rust
fn main() {}
```
`crates/ai-handoff-ipc/src/lib.rs`: `// modules added per task`
`crates/ai-handoff-core/src/lib.rs`: `// modules added per task`

- [ ] **Step 4: Build and verify the empty workspace compiles**

Run: `cargo build --workspace`
Expected: `Finished` with no errors (warnings about empty crates are fine).
Run: `cargo test --workspace`
Expected: `0 passed; 0 failed` across crates.

- [ ] **Step 5: Checkpoint (no commit)**

Confirm `cargo build --workspace` and `cargo fmt --all` are clean. Do **not** commit (Global Constraints). Record progress only.

---

## Task 2: `core::paths` — home + store layout

**Files:**
- Create: `crates/ai-handoff-core/src/paths.rs`
- Modify: `crates/ai-handoff-core/src/lib.rs` (add `pub mod paths;`)

**Interfaces:**
- Produces:
  - `pub fn home() -> std::path::PathBuf` — `$AI_HANDOFF_HOME` if set, else OS default.
  - `pub fn store_dir() -> PathBuf` (`home/store`), `pub fn ipc_dir() -> PathBuf` (`home/ipc`), `pub fn logs_dir() -> PathBuf` (`home/logs`).
  - `pub fn requests_dir() -> PathBuf`, `pub fn responses_dir() -> PathBuf`, `pub fn dead_letter_dir() -> PathBuf` (under `ipc/`).
  - `pub fn capsule_path(project_id: &str, capsule_id: &str) -> PathBuf` (`store/capsules/<project_id>/<capsule_id>.json`).
  - `pub fn project_dir(project_id: &str) -> PathBuf` (`store/capsules/<project_id>`).

- [ ] **Step 1: Write failing tests**

In `crates/ai-handoff-core/src/paths.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // Tests mutate the process env; run serially in one test fn to avoid races.
    #[test]
    fn home_prefers_env_then_os_default() {
        std::env::set_var("AI_HANDOFF_HOME", "/tmp/ah-test-home");
        assert_eq!(home(), PathBuf::from("/tmp/ah-test-home"));
        std::env::remove_var("AI_HANDOFF_HOME");

        let h = home();
        // OS default must end with the ai-handoff home dir name.
        if cfg!(windows) {
            assert!(h.ends_with(".ai-handoff"), "windows home = %USERPROFILE%\\.ai-handoff, got {h:?}");
        } else if cfg!(target_os = "macos") {
            assert!(h.ends_with("Application Support/ai-handoff"), "got {h:?}");
        } else {
            assert!(h.ends_with("ai-handoff"), "got {h:?}");
        }
    }

    #[test]
    fn layout_paths_compose_from_home() {
        std::env::set_var("AI_HANDOFF_HOME", "/tmp/ah-layout");
        assert_eq!(store_dir(), PathBuf::from("/tmp/ah-layout/store"));
        assert_eq!(requests_dir(), PathBuf::from("/tmp/ah-layout/ipc/requests"));
        assert_eq!(
            capsule_path("projX", "capY"),
            PathBuf::from("/tmp/ah-layout/store/capsules/projX/capY.json")
        );
        std::env::remove_var("AI_HANDOFF_HOME");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p ai-handoff-core paths`
Expected: FAIL — `home` / `store_dir` not found.

- [ ] **Step 3: Implement `paths.rs`**

```rust
use std::path::PathBuf;

/// AI Handoff home. `$AI_HANDOFF_HOME` wins; otherwise an OS-specific default.
/// Windows deliberately uses `%USERPROFILE%\.ai-handoff` (NOT %LOCALAPPDATA%)
/// to avoid the MSIX/Store AppData redirection split that gives Claude and
/// Codex different physical paths.
pub fn home() -> PathBuf {
    if let Ok(h) = std::env::var("AI_HANDOFF_HOME") {
        if !h.is_empty() {
            return PathBuf::from(h);
        }
    }
    let dirs = directories::BaseDirs::new();
    #[cfg(windows)]
    {
        let home = dirs.as_ref().map(|d| d.home_dir().to_path_buf()).unwrap_or_default();
        return home.join(".ai-handoff");
    }
    #[cfg(target_os = "macos")]
    {
        let home = dirs.as_ref().map(|d| d.home_dir().to_path_buf()).unwrap_or_default();
        return home.join("Library/Application Support/ai-handoff");
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // XDG_STATE_HOME or ~/.local/state, then /ai-handoff
        if let Ok(x) = std::env::var("XDG_STATE_HOME") {
            if !x.is_empty() {
                return PathBuf::from(x).join("ai-handoff");
            }
        }
        let home = dirs.as_ref().map(|d| d.home_dir().to_path_buf()).unwrap_or_default();
        return home.join(".local/state/ai-handoff");
    }
}

pub fn store_dir() -> PathBuf { home().join("store") }
pub fn ipc_dir() -> PathBuf { home().join("ipc") }
pub fn logs_dir() -> PathBuf { home().join("logs") }
pub fn requests_dir() -> PathBuf { ipc_dir().join("requests") }
pub fn responses_dir() -> PathBuf { ipc_dir().join("responses") }
pub fn dead_letter_dir() -> PathBuf { ipc_dir().join("dead-letter") }
pub fn project_dir(project_id: &str) -> PathBuf { store_dir().join("capsules").join(project_id) }
pub fn capsule_path(project_id: &str, capsule_id: &str) -> PathBuf {
    project_dir(project_id).join(format!("{capsule_id}.json"))
}
```
Add `pub mod paths;` to `lib.rs`. Add `directories.workspace = true` to the core crate `Cargo.toml`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p ai-handoff-core paths`
Expected: PASS (2 tests). On non-Windows CI the windows branch is not compiled; that is fine.

- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 3: `core::fingerprint` — project fingerprint port (HIGH RISK)

**Files:**
- Create: `crates/ai-handoff-core/src/fingerprint.rs`
- Modify: `crates/ai-handoff-core/src/lib.rs` (`pub mod fingerprint;`)
- Reference (do not modify): `core/lib/fingerprint.mjs`

**Interfaces:**
- Produces:
  - `pub enum BasisType { Remote, Gitroot, Path }`
  - `pub struct Basis { pub kind: BasisType, pub value: String }` — `value` is prefixed `remote:` / `gitroot:` / `path:`.
  - `pub struct FingerprintInfo { pub fingerprint: String, pub basis: Basis }`
  - `pub fn fingerprint_info(cwd: &Path, git_runner: &dyn GitRunner) -> FingerprintInfo`
  - `pub fn fingerprint(cwd: &Path) -> String` (uses the real git runner).
  - `pub trait GitRunner { fn run(&self, cwd: &Path, args: &[&str]) -> GitResult; }` with `pub enum GitResult { Ok(String), Failed { blocked: bool } }` — `blocked` mirrors v1: true on EPERM/ENOENT/EACCES (binary could not run), false when git ran but exited non-zero.

**Porting invariants (must match v1 byte-for-byte):**
1. Basis priority: `remote.origin.url` → gitroot → path.
2. `value` strings: `remote:<sanitized-url-or-resolved-path>`, `gitroot:<realpath(root)>`, `path:<realpath(cwd)>`.
3. `fingerprint = lowercase_hex(sha256(value))[..24]`.
4. Sanitize remote URL: strip `userinfo@` for `scheme://` URLs (class `[^/?#]*@`), then strip `?...`/`#...` for scheme URLs. Leave scp-style (`git@host:path`) and Windows drive paths untouched.
5. Relative local remote (not scheme, not scp, not absolute, not Windows drive): resolve **lexically** against repo root (`git rev-parse --show-toplevel`, or fs root when blocked, or cwd).
6. FS fallback (`findGitDirFs`, `parseRemoteOriginUrl`, `decodeGitConfigValue`, commondir resolution) runs **only when `blocked == true`**, so the working-git path stays identical and a non-repo cwd is never attached to an ancestor repo git declined.

- [ ] **Step 1: Write failing tests (ported from v1 `tests/fingerprint.test.mjs`)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // A GitRunner that always reports the binary as blocked (sandbox EPERM).
    struct Blocked;
    impl GitRunner for Blocked {
        fn run(&self, _: &Path, _: &[&str]) -> GitResult { GitResult::Failed { blocked: true } }
    }
    // A GitRunner that ran but found no repo (exit status, NOT blocked).
    struct RanNoRepo;
    impl GitRunner for RanNoRepo {
        fn run(&self, _: &Path, _: &[&str]) -> GitResult { GitResult::Failed { blocked: false } }
    }
    // A canned runner returning a fixed remote url for `config --get remote.origin.url`.
    struct FixedRemote(&'static str);
    impl GitRunner for FixedRemote {
        fn run(&self, _: &Path, args: &[&str]) -> GitResult {
            if args == ["config", "--get", "remote.origin.url"] {
                GitResult::Ok(self.0.to_string())
            } else if args == ["rev-parse", "--show-toplevel"] {
                GitResult::Ok("/repo/root".to_string())
            } else {
                GitResult::Failed { blocked: false }
            }
        }
    }

    #[test]
    fn deterministic_24_hex_for_path_basis() {
        let dir = tempfile::tempdir().unwrap();
        let a = fingerprint_info(dir.path(), &RanNoRepo);
        let b = fingerprint_info(dir.path(), &RanNoRepo);
        assert_eq!(a.fingerprint, b.fingerprint);
        assert_eq!(a.basis.kind, BasisType::Path);
        assert_eq!(a.fingerprint.len(), 24);
        assert!(a.fingerprint.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn strips_userinfo_credentials() {
        let info = fingerprint_info(Path::new("/x"),
            &FixedRemote("https://user:USERINFO_SECRET@example.invalid/org/repo.git"));
        assert_eq!(info.basis.kind, BasisType::Remote);
        assert!(!info.basis.value.contains("USERINFO_SECRET"));
    }

    #[test]
    fn strips_query_and_fragment_credentials() {
        let info = fingerprint_info(Path::new("/x"),
            &FixedRemote("https://example.invalid/org/repo.git?access_token=QUERY_SECRET#FRAG_SECRET"));
        assert!(!info.basis.value.contains("QUERY_SECRET"));
        assert!(!info.basis.value.contains("FRAG_SECRET"));
    }

    #[test]
    fn leaves_scp_ssh_untouched() {
        let info = fingerprint_info(Path::new("/x"),
            &FixedRemote("git@example.invalid:org/repo.git"));
        assert_eq!(info.basis.value, "remote:git@example.invalid:org/repo.git");
    }

    #[test]
    fn ran_no_repo_keeps_path_basis() {
        let dir = tempfile::tempdir().unwrap();
        let info = fingerprint_info(dir.path(), &RanNoRepo);
        assert_eq!(info.basis.kind, BasisType::Path);
    }

    // Parity guard: this exact value is computed by v1 and must never change.
    // Generate the expected hash once with `node` against v1 and paste it here.
    #[test]
    fn parity_scp_remote_hash_matches_v1() {
        let info = fingerprint_info(Path::new("/x"),
            &FixedRemote("git@github.com:Lumisia/claude-codex-auto-handoff.git"));
        // EXPECTED below is produced by:
        //   node -e "import('./core/lib/hash.mjs').then(m=>console.log(m.sha256Hex('remote:git@github.com:Lumisia/claude-codex-auto-handoff.git').slice(0,24)))"
        let expected = "<PASTE_V1_HASH_24HEX>";
        assert_eq!(info.fingerprint, expected);
    }
}
```

- [ ] **Step 2: Generate the v1 parity hash and paste it**

Run (from repo root, against v1):
```
node -e "import('./core/lib/hash.mjs').then(m=>console.log(m.sha256Hex('remote:git@github.com:Lumisia/claude-codex-auto-handoff.git').slice(0,24)))"
```
Copy the 24-hex output into `<PASTE_V1_HASH_24HEX>` in the test above. This pins the Rust port to v1's exact digest.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p ai-handoff-core fingerprint`
Expected: FAIL — symbols not defined.

- [ ] **Step 4: Implement `fingerprint.rs`**

Port `core/lib/fingerprint.mjs` preserving the invariants above. Provide the subtle helpers verbatim in behavior:

```rust
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum BasisType { Remote, Gitroot, Path }
#[derive(Debug)]
pub struct Basis { pub kind: BasisType, pub value: String }
#[derive(Debug)]
pub struct FingerprintInfo { pub fingerprint: String, pub basis: Basis }

pub enum GitResult { Ok(String), Failed { blocked: bool } }
pub trait GitRunner { fn run(&self, cwd: &Path, args: &[&str]) -> GitResult; }

fn sha24(value: &str) -> String {
    let mut h = Sha256::new();
    h.update(value.as_bytes());
    let digest = h.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    hex[..24].to_string()
}

fn is_scheme_url(u: &str) -> bool {
    // ^[a-zA-Z][a-zA-Z0-9+.-]*://
    let b = u.as_bytes();
    let mut i = 0;
    if i >= b.len() || !b[i].is_ascii_alphabetic() { return false; }
    i += 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'+' | b'.' | b'-')) { i += 1; }
    u[i..].starts_with("://")
}
fn is_windows_drive(u: &str) -> bool {
    let b = u.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}
fn is_scp_like(u: &str) -> bool {
    if is_scheme_url(u) || is_windows_drive(u) { return false; }
    // ^[^/:]+:  (a colon before any slash)
    match u.find(':') {
        Some(c) => !u[..c].contains('/'),
        None => false,
    }
}

/// Strip credentials: userinfo for scheme URLs, then query/fragment for scheme URLs.
fn sanitize_remote_url(url: &str) -> String {
    let mut out = url.to_string();
    if is_scheme_url(&out) {
        // remove `userinfo@` where userinfo = [^/?#]* up to the LAST '@' before authority end.
        if let Some(scheme_end) = out.find("://") {
            let after = scheme_end + 3;
            let authority_end = out[after..]
                .find(|c| c == '/' || c == '?' || c == '#')
                .map(|p| after + p)
                .unwrap_or(out.len());
            if let Some(at_rel) = out[after..authority_end].rfind('@') {
                let at = after + at_rel;
                out.replace_range(after..=at, "");
            }
        }
        // strip query/fragment
        if let Some(q) = out.find(|c| c == '?' || c == '#') {
            out.truncate(q);
        }
    }
    out
}

// decode_git_config_value, parse_remote_origin_url, find_git_dir_fs,
// read_remote_origin_url_fs: port directly from fingerprint.mjs lines 65-115,
// preserving inline-comment stripping (# or ; when not in quotes), quote/escape
// handling (\n \t \b \" \\), `[remote "origin"]` section detection, and
// commondir resolution. (Mechanical string port — same control flow.)

pub fn fingerprint_info(cwd: &Path, git: &dyn GitRunner) -> FingerprintInfo {
    let mut blocked = false;
    let mut git_get = |args: &[&str]| -> Option<String> {
        match git.run(cwd, args) {
            GitResult::Ok(v) => Some(v.trim().to_string()).filter(|s| !s.is_empty()),
            GitResult::Failed { blocked: b } => { if b { blocked = true; } None }
        }
    };

    // 1) remote.origin.url (git, then fs fallback only when blocked)
    let mut url = git_get(&["config", "--get", "remote.origin.url"]);
    if url.is_none() && blocked {
        url = read_remote_origin_url_fs(&find_git_dir_fs(cwd));
    }
    if let Some(raw) = url {
        let cleaned = sanitize_remote_url(&raw);
        let value = if !is_scheme_url(&cleaned) && !is_scp_like(&cleaned)
            && !Path::new(&cleaned).is_absolute() && !is_windows_drive(&cleaned)
        {
            let root = git_get(&["rev-parse", "--show-toplevel"])
                .or_else(|| if blocked { find_git_dir_fs(cwd).map(|g| g.root.to_string_lossy().into_owned()) } else { None })
                .unwrap_or_else(|| cwd.to_string_lossy().into_owned());
            // lexical join
            PathBuf::from(root).join(&cleaned).to_string_lossy().into_owned()
        } else {
            cleaned
        };
        return finish(BasisType::Remote, format!("remote:{value}"));
    }

    // 2) gitroot
    let mut root = git_get(&["rev-parse", "--show-toplevel"]);
    if root.is_none() && blocked {
        root = find_git_dir_fs(cwd).map(|g| g.root.to_string_lossy().into_owned());
    }
    if let Some(r) = root {
        let resolved = std::fs::canonicalize(&r).map(|p| p.to_string_lossy().into_owned()).unwrap_or(r);
        return finish(BasisType::Gitroot, format!("gitroot:{resolved}"));
    }

    // 3) path
    let resolved = std::fs::canonicalize(cwd).map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| cwd.to_string_lossy().into_owned());
    finish(BasisType::Path, format!("path:{resolved}"))
}

fn finish(kind: BasisType, value: String) -> FingerprintInfo {
    FingerprintInfo { fingerprint: sha24(&value), basis: Basis { kind, value } }
}
```
(Implement `decode_git_config_value`, `parse_remote_origin_url`, `find_git_dir_fs` returning a `struct GitDirInfo { root: PathBuf, git_dir: PathBuf, common_dir: PathBuf }`, and `read_remote_origin_url_fs` as direct ports of the referenced v1 lines.) Provide a real `RealGit` implementing `GitRunner` via `std::process::Command::new("git")` mapping spawn errors to `blocked` when the OS error kind is `PermissionDenied`/`NotFound`, else `blocked=false` on non-zero exit. Add `pub fn fingerprint(cwd: &Path) -> String { fingerprint_info(cwd, &RealGit).fingerprint }`.

> **NOTE on canonicalize parity:** v1 uses `realpathSync` (gitroot/path) but resolves the *relative remote* lexically (never realpath). Mirror this exactly: `canonicalize` for gitroot/path values, lexical `join` for the relative-remote case. On Windows, `std::fs::canonicalize` yields a `\\?\` verbatim prefix — strip it (`dunce`-style or manual) so the value matches v1's plain path. Add a test that a canonicalized Windows path has no `\\?\` prefix.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p ai-handoff-core fingerprint`
Expected: PASS including `parity_scp_remote_hash_matches_v1`.

- [ ] **Step 6: Cross-check parity against a real repo**

Run, comparing v1 and v2 on this actual repo:
```
node -e "import('./core/lib/fingerprint.mjs').then(m=>console.log(m.projectFingerprint(process.cwd())))"
```
Then a tiny Rust bin / test printing `ai_handoff_core::fingerprint::fingerprint(cwd)` for the same cwd. The two 24-hex strings MUST be identical. If they differ, the port is wrong — do not proceed.

- [ ] **Step 7: Checkpoint (no commit) + Codex review of the core fingerprint port.**

Invoke Codex review focused on: sanitize edge cases (password containing `@`, query-without-path), blocked-vs-exit distinction, Windows `\\?\` stripping, lexical-vs-canonical remote resolution.

---

## Task 4: `core::capsule` — v2-subset capsule + ids + integrity

**Files:**
- Create: `crates/ai-handoff-core/src/capsule.rs`
- Modify: `lib.rs` (`pub mod capsule;`)

**Interfaces:**
- Produces:
  - `pub struct Capsule { schema_version: u32=2, capsule_id, project_id, created_at (RFC3339), source_agent, target_agent, session: Session, summary: Summary, files: Vec<FileChange>, next_prompt: Option<String>, redaction: RedactionMeta, consumption: Consumption }` (all `pub`, serde-derived, `#[serde(default)]` where optional).
  - `pub enum AgentKind { ClaudeCode, Codex }` serde `rename_all = "kebab-case"`.
  - `pub enum ConsumptionState { Pending, Consumed }`.
  - `pub fn new_capsule_id(now: DateTime<Utc>) -> String` → `cap_YYYYMMDD_HHMMSS_<4hex>`.
  - `pub fn payload_sha256(c: &Capsule) -> String` → `sha256:<hex>` over the canonical JSON of the capsule **excluding** the `integrity` field (matches v1 `capsulePayloadHash` semantics: hash content minus integrity).
  - `pub fn validate(c: &Capsule) -> Result<(), Vec<String>>` — schema_version==2, non-empty ids, source != target.

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample() -> Capsule {
        Capsule {
            schema_version: 2,
            capsule_id: "cap_20260625_123456_abcd".into(),
            project_id: "projX".into(),
            created_at: "2026-06-25T12:34:56Z".into(),
            source_agent: AgentKind::Codex,
            target_agent: AgentKind::ClaudeCode,
            session: Session::default(),
            summary: Summary { goal: "g".into(), done: vec![], remaining: vec![], risks: vec![] },
            files: vec![],
            next_prompt: Some("do x".into()),
            redaction: RedactionMeta { applied: true, ruleset: "default-v2".into() },
            consumption: Consumption { state: ConsumptionState::Pending, consumed_by: None, consumed_at: None },
        }
    }

    #[test]
    fn id_format() {
        let dt = chrono::Utc.with_ymd_and_hms(2026, 6, 25, 12, 34, 56).unwrap();
        let id = new_capsule_id(dt);
        assert!(id.starts_with("cap_20260625_123456_"));
        assert_eq!(id.len(), "cap_20260625_123456_".len() + 4);
    }

    #[test]
    fn roundtrip_json() {
        let c = sample();
        let s = serde_json::to_string_pretty(&c).unwrap();
        let back: Capsule = serde_json::from_str(&s).unwrap();
        assert_eq!(back.capsule_id, c.capsule_id);
        assert_eq!(back.source_agent, AgentKind::Codex);
    }

    #[test]
    fn validate_rejects_same_source_and_target() {
        let mut c = sample();
        c.target_agent = AgentKind::Codex;
        assert!(validate(&c).is_err());
    }

    #[test]
    fn payload_hash_ignores_integrity_field() {
        let c = sample();
        let h = payload_sha256(&c);
        assert!(h.starts_with("sha256:"));
        // hashing twice is stable
        assert_eq!(h, payload_sha256(&c));
    }
}
```

- [ ] **Step 2: Run to verify fail.** `cargo test -p ai-handoff-core capsule` → FAIL.

- [ ] **Step 3: Implement `capsule.rs`** with the structs above, `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]`, `#[serde(rename_all = "snake_case")]` on enums except `AgentKind` (`kebab-case`). `new_capsule_id` formats the timestamp and appends 4 hex from `uuid::Uuid::new_v4()` (first 2 bytes). `payload_sha256` serializes the capsule to a serde_json::Value, removes the `"integrity"` key if present (the MVP capsule has no integrity field, but keep the removal so the hash is forward-compatible), serializes that Value with sorted keys, and hashes. `validate` returns `Err(vec_of_reasons)`.

- [ ] **Step 4: Run to verify pass.** `cargo test -p ai-handoff-core capsule` → PASS (4 tests).

- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 5: `core::trigger` — threshold + burn-rate (port of `evaluateTrigger`)

**Files:**
- Create: `crates/ai-handoff-core/src/trigger.rs`
- Modify: `lib.rs`
- Reference: `core/hooks/trigger.mjs`

**Interfaces:**
- Produces:
  - `pub struct Sample { pub at_ms: i64, pub used_percent: f64 }`
  - `pub struct BurnRate { pub enabled: bool, pub runway_minutes: f64 }`
  - `pub enum TriggerMode { Off, Ask, Auto }`
  - `pub enum TriggerAction { None, Ask, Create }`
  - `pub struct TriggerOutcome { pub action: TriggerAction, pub reason: &'static str }`
  - `pub fn evaluate_trigger(used_percent: Option<f64>, threshold: f64, mode: TriggerMode, deduped: bool, samples: &[Sample], burn: &BurnRate) -> TriggerOutcome`

- [ ] **Step 1: Write failing tests (mirror v1 semantics)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn no_burn() -> BurnRate { BurnRate { enabled: false, runway_minutes: 30.0 } }

    #[test] fn off_mode_is_none() {
        let o = evaluate_trigger(Some(99.0), 80.0, TriggerMode::Off, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::None)); assert_eq!(o.reason, "off");
    }
    #[test] fn unknown_used_percent_is_none() {
        let o = evaluate_trigger(None, 80.0, TriggerMode::Ask, false, &[], &no_burn());
        assert_eq!(o.reason, "unknown");
    }
    #[test] fn at_threshold_fires_ask_in_ask_mode() {
        let o = evaluate_trigger(Some(80.0), 80.0, TriggerMode::Ask, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::Ask)); assert_eq!(o.reason, "threshold");
    }
    #[test] fn at_threshold_fires_create_in_auto_mode() {
        let o = evaluate_trigger(Some(85.0), 80.0, TriggerMode::Auto, false, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::Create));
    }
    #[test] fn deduped_suppresses_fire() {
        let o = evaluate_trigger(Some(90.0), 80.0, TriggerMode::Auto, true, &[], &no_burn());
        assert!(matches!(o.action, TriggerAction::None)); assert_eq!(o.reason, "deduped");
    }
    #[test] fn burn_rate_fires_when_eta_within_runway() {
        let burn = BurnRate { enabled: true, runway_minutes: 30.0 };
        // 10% over 5 min => 2%/min; remaining 40% => eta 20 min <= 30 => fire
        let samples = vec![Sample{at_ms:0, used_percent:50.0}, Sample{at_ms:300_000, used_percent:60.0}];
        let o = evaluate_trigger(Some(60.0), 80.0, TriggerMode::Ask, false, &samples, &burn);
        assert_eq!(o.reason, "burn-rate");
    }
    #[test] fn below_threshold_no_burn_is_below() {
        let o = evaluate_trigger(Some(40.0), 80.0, TriggerMode::Ask, false, &[], &no_burn());
        assert_eq!(o.reason, "below");
    }
}
```

- [ ] **Step 2: Run to verify fail.** `cargo test -p ai-handoff-core trigger` → FAIL.

- [ ] **Step 3: Implement `trigger.rs`** porting `evaluateTrigger` + `projectMinutesTo100`: sort samples by `at_ms`, slope = `dPct/dMin`, `eta = remaining/slope`, fire when `used >= threshold` ("threshold") or burn enabled and `eta <= runway` ("burn-rate"); fire maps to `Create` in Auto else `Ask`; `deduped` overrides any fire to `None`/"deduped"; insufficient samples → "insufficient-samples".

- [ ] **Step 4: Run to verify pass.** `cargo test -p ai-handoff-core trigger` → PASS (7 tests).

- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 6: `core::hook_event` — NormalizedHookEvent + Codex/Claude parsers

**Files:**
- Create: `crates/ai-handoff-core/src/hook_event.rs`
- Modify: `lib.rs`
- Reference: `core/hooks/*.mjs`, `tests/fixtures/` (Claude/Codex payload samples)

**Interfaces:**
- Produces:
  - `pub enum HookEventKind { SessionStart, UserPromptSubmit, PostToolUse, Stop }` with `pub fn parse(s: &str) -> Option<Self>` accepting both `"session-start"` (CLI arg) and `"SessionStart"` (payload `hook_event_name`).
  - `pub struct NormalizedHookEvent { pub agent: AgentKind, pub event: HookEventKind, pub session_id: Option<String>, pub turn_id: Option<String>, pub cwd: PathBuf, pub transcript_path: Option<PathBuf>, pub tool_name: Option<String>, pub tool_input: serde_json::Value, pub tool_response: serde_json::Value, pub raw: serde_json::Value }`
  - `pub fn normalize(agent: AgentKind, event: HookEventKind, raw: &serde_json::Value) -> NormalizedHookEvent` — maps agent-specific field names (e.g. Claude `cwd`/`session_id`/`transcript_path`/`tool_name`/`tool_input`/`tool_response`; Codex equivalents) into the common shape, defaulting missing fields to `cwd = current_dir()`, empty `Value::Null` for tool fields.

- [ ] **Step 1: Inspect fixtures, then write failing tests**

First read what shapes exist: `Glob tests/fixtures/**` and open a Claude and a Codex payload. Then:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test] fn parses_event_kind_from_both_spellings() {
        assert_eq!(HookEventKind::parse("session-start"), Some(HookEventKind::SessionStart));
        assert_eq!(HookEventKind::parse("SessionStart"), Some(HookEventKind::SessionStart));
        assert_eq!(HookEventKind::parse("PostToolUse"), Some(HookEventKind::PostToolUse));
        assert_eq!(HookEventKind::parse("nope"), None);
    }

    #[test] fn normalizes_claude_post_tool_use() {
        let raw = json!({
            "session_id": "s1", "cwd": "/work/repo", "transcript_path": "/t.jsonl",
            "tool_name": "Edit", "tool_input": {"file_path": "a.rs"}, "tool_response": {"ok": true}
        });
        let n = normalize(AgentKind::ClaudeCode, HookEventKind::PostToolUse, &raw);
        assert_eq!(n.session_id.as_deref(), Some("s1"));
        assert_eq!(n.cwd, std::path::PathBuf::from("/work/repo"));
        assert_eq!(n.tool_name.as_deref(), Some("Edit"));
        assert_eq!(n.tool_input["file_path"], "a.rs");
    }
}
```

- [ ] **Step 2: Run to verify fail.** `cargo test -p ai-handoff-core hook_event` → FAIL.

- [ ] **Step 3: Implement `hook_event.rs`** with the field mapping. For Codex, map the equivalent payload keys observed in the fixtures (and the report's event list). Missing `cwd` → `std::env::current_dir().unwrap_or_default()`.

- [ ] **Step 4: Run to verify pass.** PASS.

- [ ] **Step 5: Checkpoint (no commit) + Codex review of the core crate as a whole** (paths, fingerprint, capsule, trigger, hook_event, redaction, sensor — review redaction + sensor after Tasks 7-8 land too, or fold this review after Task 7).

---

## Task 7: `core::redaction` + `core::sensor`

**Files:**
- Create: `crates/ai-handoff-core/src/redaction.rs`, `crates/ai-handoff-core/src/sensor.rs`
- Modify: `lib.rs`
- Reference: `core/lib/redact.mjs`, `core/sensors/codex-jsonl.mjs`

**Interfaces:**
- Produces:
  - `pub fn redact(text: &str) -> (String, bool)` — returns redacted text and whether anything was replaced. Rules (port from `redact.mjs`): `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`-style `KEY=value`, `Bearer <token>`, GitHub tokens (`ghp_`/`gho_`/`ghs_`...), AWS access key (`AKIA[0-9A-Z]{16}`), private key blocks (`-----BEGIN ... PRIVATE KEY-----`...), and JSON fields whose key looks like `password`/`token`/`secret`. Replace matches with `«redacted»`.
  - `pub fn used_percent_from_jsonl(path: &Path) -> Option<f64>` — port the JSONL-derived usage read from `codex-jsonl.mjs`: read the file, find the latest line carrying a rate-limit/usage record, return `used_percent`. Returns `None` on any read/parse failure (never panics).

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn redacts_bearer_and_env_key() {
        let (out, hit) = redact("Authorization: Bearer abcDEF123 and OPENAI_API_KEY=sk-xyz");
        assert!(hit);
        assert!(!out.contains("abcDEF123"));
        assert!(!out.contains("sk-xyz"));
    }
    #[test] fn redact_noop_on_clean_text() {
        let (out, hit) = redact("just a normal sentence");
        assert!(!hit);
        assert_eq!(out, "just a normal sentence");
    }
    #[test] fn jsonl_missing_file_is_none() {
        assert!(used_percent_from_jsonl(std::path::Path::new("/no/such.jsonl")).is_none());
    }
    #[test] fn jsonl_reads_latest_used_percent() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("u.jsonl");
        std::fs::write(&p, "{\"type\":\"x\"}\n{\"used_percent\":42.5}\n").unwrap();
        assert_eq!(used_percent_from_jsonl(&p), Some(42.5));
    }
}
```
> The exact JSONL record shape MUST be confirmed against `core/sensors/codex-jsonl.mjs` and a real fixture before writing the parser; adjust the `jsonl_reads_latest_used_percent` fixture line to the real key path.

- [ ] **Step 2: Run to verify fail.** FAIL.
- [ ] **Step 3: Implement** both modules; redaction via a set of compiled regexes (add `regex = "1"` to the core crate). `used_percent_from_jsonl` scans lines last-to-first for the usage record.
- [ ] **Step 4: Run to verify pass.** PASS.
- [ ] **Step 5: Checkpoint + Codex review of the completed `ai-handoff-core` crate.**

---

## Task 8: `ipc::protocol` — wire types

**Files:**
- Create: `crates/ai-handoff-ipc/src/protocol.rs`, modify `crates/ai-handoff-ipc/src/lib.rs`.

**Interfaces:**
- Produces:
  - `pub struct Request { pub version: u32, pub request_id: String, pub kind: String /* "hook_event" */, pub agent: String, pub event: String, pub received_at: String, pub cwd: String, pub session_id: Option<String>, pub turn_id: Option<String>, pub raw_hook_input: serde_json::Value, pub client: ClientInfo }`
  - `pub struct ClientInfo { pub binary_version: String, pub pid: u32, pub platform: String }`
  - `pub enum Status { Ok, Degraded, Error }` (serde snake_case).
  - `pub struct Response { pub version: u32, pub request_id: String, pub status: Status, pub hook_stdout: serde_json::Value, pub warnings: Vec<String>, pub diagnostics: serde_json::Value }`
  - `pub const VERSION: u32 = 1;`
  - `pub fn degraded(request_id: &str, warning: &str) -> Response` — `status=Degraded`, `hook_stdout = {}`, `warnings=[warning]`.

- [ ] **Step 1: Write failing test** (serde round-trip of `Request` and `Response`, and `degraded()` shape). 
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the serde structs matching spec §7.1–7.3 exactly.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 9: `ipc::client` — write request, poll response (hook side)

**Files:**
- Create: `crates/ai-handoff-ipc/src/client.rs`, modify `lib.rs`.

**Interfaces:**
- Consumes: `protocol::{Request, Response, degraded}`, `ai_handoff_core::paths::{requests_dir, responses_dir}`.
- Produces:
  - `pub struct ClientConfig { pub connect_timeout: Duration, pub request_timeout: Duration, pub poll_interval: Duration }` with `Default` = 150ms / 1500ms / 25ms.
  - `pub fn send(req: &Request, cfg: &ClientConfig) -> Response` — writes `requests_dir()/<request_id>.json` **atomically** (write to `<id>.json.tmp` in the same dir, then rename), then polls `responses_dir()/<request_id>.json` until present or `request_timeout` elapses; on success reads+parses+deletes both files and returns the Response; on timeout or any IO error returns `degraded(request_id, "daemon_unavailable")`. **Never panics, never returns Err.**

- [ ] **Step 1: Write failing test** (a fake responder thread writes the response file after a short delay; assert `send` returns it; a second test with no responder asserts `send` returns a `Degraded` response within ~the request timeout).

```rust
#[test]
fn send_returns_degraded_when_no_daemon() {
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("AI_HANDOFF_HOME", home.path());
    std::fs::create_dir_all(ai_handoff_core::paths::requests_dir()).unwrap();
    std::fs::create_dir_all(ai_handoff_core::paths::responses_dir()).unwrap();
    let req = sample_request();
    let cfg = ClientConfig { request_timeout: std::time::Duration::from_millis(120), ..Default::default() };
    let resp = send(&req, &cfg);
    assert!(matches!(resp.status, crate::protocol::Status::Degraded));
    std::env::remove_var("AI_HANDOFF_HOME");
}
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** atomic write (tmp + rename), poll loop with `std::thread::sleep(poll_interval)`, deadline via `Instant::now() + request_timeout`. Ensure request/response dirs are created if missing. Clean up both files on success; on timeout, leave the request for the daemon to dead-letter.
- [ ] **Step 4: Run → PASS** (both online and offline tests).
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 10: `ipc::server` — watch requests, dispatch, write response

**Files:**
- Create: `crates/ai-handoff-ipc/src/server.rs`, modify `lib.rs`.

**Interfaces:**
- Consumes: `protocol::*`, `paths::*`.
- Produces:
  - `pub trait Handler { fn handle(&self, req: &Request) -> Response; }`
  - `pub fn serve_once(handler: &dyn Handler) -> usize` — scans `requests_dir()`, for each `*.json` (not `.tmp`): read+parse; call `handler.handle`; write the response atomically to `responses_dir()/<request_id>.json`; delete the request file. Malformed/unparseable requests are moved to `dead_letter_dir()`. Returns the count processed. Never panics.
  - `pub fn serve_forever(handler: &dyn Handler, poll: Duration) -> !` — loop `serve_once` then sleep.

- [ ] **Step 1: Write failing test** — an echo `Handler` returning `status=Ok`, `hook_stdout={"ok":true}`; drop a request file; call `serve_once`; assert the response file appears with the right `request_id` and the request file is gone. A second test: write a non-JSON request file; assert `serve_once` moves it to dead-letter and does not panic.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `serve_once`/`serve_forever`. Use the same tmp+rename atomic write as the client.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint + Codex review of `ai-handoff-ipc`** (focus: atomic write/rename race, partial-write read, dead-letter handling, request/response file lifecycle).

---

## Task 11: `daemon::store` — capsule write/read + pending lookup (atomic, no locks)

**Files:**
- Create: `crates/ai-handoff-daemon/src/store.rs`.

**Interfaces:**
- Consumes: `ai_handoff_core::{capsule::Capsule, paths}`.
- Produces:
  - `pub fn save_capsule(c: &Capsule) -> std::io::Result<PathBuf>` — atomic write to `paths::capsule_path(project_id, capsule_id)` (create project dir; tmp+rename). Because the daemon is the only writer, no lockfiles are used.
  - `pub fn find_pending(project_id: &str) -> Option<Capsule>` — scan `paths::project_dir(project_id)`, return the newest capsule (by `created_at`, tiebreak file mtime) whose `consumption.state == Pending`.
  - `pub fn mark_consumed(project_id: &str, capsule_id: &str, by: AgentKind, now: DateTime<Utc>) -> std::io::Result<()>` — read, set `consumption` to Consumed/by/now, atomic rewrite.

- [ ] **Step 1: Write failing tests** under a temp `AI_HANDOFF_HOME`: save two pending capsules with increasing `created_at`; `find_pending` returns the newer; `mark_consumed` on it; `find_pending` then returns the older. 
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with atomic tmp+rename writes; parse all `*.json` in the project dir, ignore unparseable ones.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 12: `daemon::dedupe` — event dedupe

**Files:**
- Create: `crates/ai-handoff-daemon/src/dedupe.rs`.

**Interfaces:**
- Produces:
  - `pub fn dedupe_key(req: &Request) -> String` — `sha256(agent | event | session_id | turn_id)` hex.
  - `pub struct Deduper { seen: HashSet<String>, order: VecDeque<String>, cap: usize }` with `pub fn new(cap: usize) -> Self`, `pub fn check_and_record(&mut self, key: &str) -> bool` returning `true` if already seen (i.e. duplicate), evicting oldest beyond `cap`.

- [ ] **Step 1: Write failing test** — same key twice: first `false`, second `true`; distinct keys both `false`; eviction past cap.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 13: `daemon::router` — NormalizedHookEvent → hook_stdout

**Files:**
- Create: `crates/ai-handoff-daemon/src/router.rs`.

**Interfaces:**
- Consumes: `ai_handoff_core::{hook_event, capsule, fingerprint, trigger, redaction, sensor}`, `daemon::{store, dedupe}`, `ipc::protocol::*`.
- Produces:
  - `pub struct Router { deduper: Mutex<Deduper> }` implementing `ipc::server::Handler`.
  - `Handler::handle` flow:
    1. Parse `req.agent`/`req.event`; build `NormalizedHookEvent` from `req.raw_hook_input`.
    2. Compute `project_id = fingerprint(&cwd)`.
    3. Dispatch per event (see below), producing `hook_stdout` JSON.
    4. Return `Response{ status: Ok, hook_stdout, .. }`. On any internal error, log and return `degraded(request_id, "daemon_error")` (never propagate — agent UX must not break).
  - Per-event behavior:
    - **SessionStart / UserPromptSubmit:** `find_pending(project_id)`; if a pending capsule exists and is not deduped, emit `{"hookSpecificOutput":{"hookEventName":<event>,"additionalContext":<rendered capsule context>}}` and `mark_consumed`. Else `{}`.
    - **PostToolUse:** read `used_percent_from_jsonl(transcript_path)`, `evaluate_trigger(...)` with config threshold/mode; if action is Create/Ask, record intent in diagnostics; emit `{}` (MVP does not auto-write on PostToolUse). 
    - **Stop:** search the final answer / transcript for a fenced `ai-handoff-capsule` JSON block; if found, build a `Capsule` (redact text fields, fill ids/fingerprint/timestamps, `consumption=Pending`), `save_capsule`; emit `{}`. If save fails, log only, still emit `{}`.

- [ ] **Step 1: Write failing tests** for each event with a temp home: 
  - Stop with a fenced capsule block → a capsule file is written under the project dir.
  - SessionStart with a pending capsule present → `hook_stdout` contains `additionalContext`, and the capsule becomes Consumed.
  - SessionStart with no pending → `hook_stdout == {}`.
  - A duplicate request (same dedupe key) → second call emits `{}`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the router. Keep the fenced-block parser small: locate ```` ```ai-handoff-capsule ```` … ```` ``` ````, parse the inner JSON into the MVP capsule summary/files/next_prompt fields.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 14: `daemon` binary — `daemon run`

**Files:**
- Modify: `crates/ai-handoff-daemon/src/main.rs`.

**Interfaces:**
- Consumes: `ipc::server::serve_forever`, `daemon::router::Router`, `paths`.
- Produces: a binary that, on `daemon run`, ensures `ipc/{requests,responses,dead-letter}` and `logs` exist, initializes tracing to `logs/daemon.log`, constructs a `Router`, and calls `serve_forever(&router, 25ms)`.

- [ ] **Step 1: Write a failing integration test** `crates/ai-handoff-daemon/tests/serve.rs`: spawn `serve_once` against a hand-written request file (reuse Router) and assert a response is produced end-to-end (this exercises router+store+ipc together). 
- [ ] **Step 2: Run → FAIL. Step 3: Implement `main.rs`. Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint + Codex review of `ai-handoff-daemon`** (focus: error swallowing correctness, dedupe under repeated requests, store atomicity, never-panic guarantee).

---

## Task 15: `cli` — clap entry + command skeleton

**Files:**
- Modify: `crates/ai-handoff-cli/src/main.rs`; create `commands/{hook,daemon,doctor,checkpoint}.rs`.

**Interfaces:**
- Produces a clap `Cli` with subcommands:
  - `hook <event> --agent <claude-code|codex>`
  - `daemon <run|status>`
  - `doctor [--json]`
  - `checkpoint [--message <m>]`
- `daemon run` delegates to `ai_handoff_daemon` (call a `pub fn run() -> !` exposed from the daemon crate, or shell the daemon binary — prefer exposing `ai_handoff_daemon::run()` as a lib fn and having both binaries call it).

- [ ] **Step 1: Write a failing test** `cargo test -p ai-handoff-cli` parsing args via clap's `try_parse_from` for `["ai-handoff","hook","session-start","--agent","codex"]` → the parsed struct has `event="session-start"`, `agent=Codex`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement clap derive structs + empty command bodies returning `Ok(())`. Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 16: `cli::commands::hook` — the hook target

**Files:**
- Modify: `crates/ai-handoff-cli/src/commands/hook.rs`.

**Interfaces:**
- Consumes: `ai_handoff_ipc::{protocol, client}`, `ai_handoff_core::{hook_event, paths}`.
- Produces: `pub fn run(event: &str, agent: &str) -> i32` (process exit code):
  1. Read **all of stdin** to a string; parse to `serde_json::Value` (on parse failure, `raw = Value::Null`).
  2. Build a `Request` (new uuid v4 `request_id`, `received_at = now`, `cwd = current_dir`, pull `session_id`/`turn_id` from raw if present, `client` filled from `env!("CARGO_PKG_VERSION")`, `pid`, platform).
  3. `let resp = client::send(&req, &ClientConfig::default());`
  4. Print `serde_json::to_string(&resp.hook_stdout)` to **stdout** (which is `{}` when degraded). Print any warnings to **stderr**.
  5. **Always return exit code 0** for hook invocations (Global Constraints: never break agent UX).

- [ ] **Step 1: Write a failing integration test** `crates/ai-handoff-cli/tests/hook_offline.rs`: set a temp `AI_HANDOFF_HOME` with no daemon; run `hook::run("session-start","codex")` with piped JSON stdin (use a helper that feeds a string — refactor `run` to take a `impl Read` for stdin and a `impl Write` for stdout so it is testable: `pub fn run_io(event, agent, input: &mut dyn Read, out: &mut dyn Write) -> i32`). Assert: returns 0, and `out` contains `{}`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `run_io` (testable core) and a thin `run` that wires real stdin/stdout. 
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 17: `cli::commands::{doctor,checkpoint}` (reduced)

**Files:**
- Modify: `crates/ai-handoff-cli/src/commands/doctor.rs`, `checkpoint.rs`.

**Interfaces:**
- Produces:
  - `doctor`: checks and prints (human + `--json`): CLI binary version, daemon reachable (send a `kind:"ping"` request; daemon router answers `status:Ok` for ping), home/store/ipc dirs exist & writable, fingerprint basis + cross-OS-stable hint for cwd. Exit 0 always.
  - `checkpoint`: build a minimal capsule from `--message` for the current cwd's fingerprint, send it through the daemon (a `kind:"checkpoint"` request the router maps to `save_capsule`). Prints the saved capsule path or a clear error; may exit non-zero (manual command).

- [ ] **Step 1: Write failing tests** — `doctor --json` with daemon offline reports `daemon: unreachable` and exits 0; `checkpoint` with daemon online (spawn `serve_once` loop in-test) writes a capsule. 
- [ ] **Step 2: Run → FAIL. Step 3: Implement** (extend the router to handle `kind:"ping"` and `kind:"checkpoint"`). **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint + Codex review of `ai-handoff-cli`** (focus: stdin reading completeness, exit-code discipline, doctor honesty).

---

## Task 18: Workspace end-to-end test (daemon online)

**Files:**
- Create: `tests/e2e_hook_daemon.rs` (workspace integration test; add a `[[test]]`-bearing crate or place under the cli crate's `tests/`).

**Interfaces:** uses the public APIs of all four crates.

- [ ] **Step 1: Write the failing e2e test**

Flow under a temp `AI_HANDOFF_HOME`:
1. Spawn a background thread running `ipc::server::serve_forever(&Router::new(), 10ms)`.
2. Simulate a **Stop** hook: call `hook::run_io("stop","codex", stdin=<final answer containing a fenced ai-handoff-capsule block>, out)`. Assert exit 0, out `{}`.
3. Poll the project dir until a capsule file appears (deadline 2s); assert its `consumption.state == "pending"` and `source_agent == "codex"`.
4. Simulate a **SessionStart** hook for the *other* agent: `hook::run_io("session-start","claude-code", stdin={cwd}, out)`. Assert `out` contains `additionalContext`.
5. Assert the capsule is now `consumed`.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Fix wiring** until green (no new product code should be needed; this is the integration proof).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Checkpoint (no commit).**

---

## Task 19: Manual Codex-on-Windows acceptance (the real bug)

**Files:**
- Create: `docs/v2/mvp-acceptance.md` (a checklist, committed later with the rest).

**Interfaces:** none (manual procedure).

- [ ] **Step 1: Build release binaries**

Run: `cargo build --release`
Artifacts: `target/release/ai-handoff.exe`, `target/release/ai-handoff-daemon.exe`.

- [ ] **Step 2: Start the daemon outside the sandbox**

Run (normal PowerShell, not inside Codex): `target/release/ai-handoff.exe daemon run`
Leave it running. Confirm `logs/daemon.log` is created under `%USERPROFILE%\.ai-handoff`.

- [ ] **Step 3: Point Codex hooks at the new binary + open IPC dir**

In `~/.codex/config.toml`:
```toml
[sandbox_workspace_write]
writable_roots = ["C:\\Users\\PC\\.ai-handoff\\ipc"]
```
In Codex hooks, set the four events to `"C:\\...\\ai-handoff.exe" hook <event> --agent codex` (with `commandWindows`). Trust via `/hooks`.

- [ ] **Step 4: Run a Codex session and verify**

Trigger SessionStart / UserPromptSubmit / PostToolUse / Stop. Verify in `logs/daemon.log` and the store:
  - No `EPERM` anywhere.
  - A capsule JSON is written under `store/capsules/<project-id>/` on Stop.
  - SessionStart in the peer agent injects the pending capsule.

- [ ] **Step 5: Record results in `docs/v2/mvp-acceptance.md`** and **Codex review of the whole MVP slice.** This closes Sub-project 1. (Still no commit — per Global Constraints, the single commit happens only when the entire replatform is complete.)

---

## Self-Review (performed against the spec)

- **Spec coverage:** §4.1 process model → Tasks 9/10/14/16; §4.2 crates → Tasks 2-17; §4.3 defaults (file IPC, JSON store, JSONL sensor, manual daemon) → Tasks 9/10/11/7/14; §4.4 events → Task 13; §4.5 failure policy → Tasks 9/13/16; §5 store layout → Tasks 2/11; §6 fingerprint risk → Task 3 (+parity cross-check); §7 testing → Tasks 3-18; §8 success criteria 1-5 → Tasks 18/19/3. Criterion 6 (v1 coexistence) was removed from the spec; no task needed. ✔
- **Placeholder scan:** the only intentional fill-in is `<PASTE_V1_HASH_24HEX>` (Task 3 Step 2 generates it) and the JSONL record shape (Task 7 confirms against the v1 source/fixture). Both are explicit generate-then-fill steps, not vague TODOs. ✔
- **Type consistency:** `GitRunner`/`GitResult` (Task 3) reused nowhere else; `Capsule`/`AgentKind`/`ConsumptionState` (Task 4) consumed by Tasks 11/13; `NormalizedHookEvent` (Task 6) consumed by Task 13; `Request`/`Response`/`degraded` (Task 8) consumed by Tasks 9/10/13/16; `Handler` (Task 10) implemented by `Router` (Task 13). Names align. ✔
```
