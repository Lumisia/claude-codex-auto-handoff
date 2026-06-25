# AI Handoff Tauri Read-Only Dashboard Design

**Date:** 2026-06-25
**Status:** Draft pending user review
**Scope:** First Tauri GUI MVP plus `aho` dashboard launcher

## 1. Goal

Build the first desktop GUI slice for AI Handoff v2:

- A Tauri 2 + React/Vite/TypeScript desktop app.
- A read-only local dashboard for install health and handoff visibility.
- An `aho` command that opens the dashboard from `cmd`.

This slice must not become the hook target. Claude and Codex hooks continue to
call the console `ai-handoff` binary because hook stdout must remain reliable on
Windows.

## 2. Recommended Approach

Use a read-only dashboard first.

The GUI reads local state directly from known AI Handoff files and reports what
it sees. It does not repair configs, mutate capsules, or execute arbitrary shell
commands. This gives a visible Tauri MVP without expanding the already-sensitive
installer surface.

Deferred alternatives:

- Daemon API first: cleaner long-term boundary, but blocks GUI on daemon API
  design and implementation.
- Repair-first GUI: useful, but higher risk because it writes Codex and Claude
  config files from a new UI surface.

## 3. User-Facing MVP

### Overview

Show a dense status dashboard:

- Daemon: running, stopped, or unknown.
- Autostart: Scheduled Task, HKCU Run fallback, missing, or unknown.
- Claude hook: installed, missing, parse error.
- Codex hook: installed, missing, duplicate v1 warning, writable_roots status.
- IPC: path present, missing, unreadable.
- Store: present, missing, unreadable.
- Pending capsules count.
- Last capsule timestamp when available.

### Doctor

Show the same checks as a checklist with severity:

- OK
- Warning
- Error
- Unknown

MVP Doctor has no repair buttons. It may show short guidance text, but must not
attempt config mutation.

### Capsules

Show a read-only list:

- project id or path bucket
- source and target agent
- created time
- summary preview
- pending/consumed when detectable
- raw JSON viewer in a read-only panel

### Settings

Show resolved paths and current install state:

- AI Handoff home
- IPC root
- store root
- install state path
- autostart method
- CLI binary path when known

All settings are read-only in this slice.

### Logs

Show available daemon/hook/install logs if present. If no log file exists, show
an empty state. Do not create log files just by opening the GUI.

## 4. Architecture

Add an `apps/desktop` Tauri app:

```text
apps/desktop/
  package.json
  index.html
  src/
    main.tsx
    App.tsx
    api.ts
    types.ts
    styles.css
    views/
      Overview.tsx
      Doctor.tsx
      Capsules.tsx
      Settings.tsx
      Logs.tsx
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs
```

The Tauri backend exposes explicit read-only commands:

- `get_dashboard_snapshot`
- `list_capsules`
- `read_capsule`
- `read_logs`

The backend should reuse `ai-handoff-core` path helpers where practical. If the
existing helpers are not shaped for GUI reads yet, the app may contain a small
read-only adapter and move it into core later.

## 5. Data Flow

```text
React UI
  -> Tauri invoke("get_dashboard_snapshot")
  -> Rust backend reads local AI Handoff files
  -> Rust backend returns typed JSON
  -> React renders status, doctor rows, capsules, logs
```

Direct file reads:

- `%USERPROFILE%\.ai-handoff\install-state.json`
- `%USERPROFILE%\.codex\hooks.json`
- `%USERPROFILE%\.codex\config.toml`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.ai-handoff\store`
- `%USERPROFILE%\.ai-handoff\ipc`
- `%USERPROFILE%\.ai-handoff\logs`

The GUI must treat missing and malformed files as reportable states, not fatal
startup errors.

## 6. `aho` Launcher

Add `aho` as a convenience command for Windows `cmd`.

MVP implementation:

- Add CLI command `ai-handoff dashboard`.
- Add installer support that places or registers an `aho` shim.
- `aho` opens the Tauri dashboard when installed.

Preferred Windows shape:

- A small `aho.cmd` shim in an AI Handoff bin directory on PATH, or a copied
  `aho.exe` alias later.
- The shim runs the installed GUI executable, not the hook CLI.
- Per-user PATH registration is preferred over machine-wide PATH mutation.
- `ai-handoff install --yes` should be able to install the `aho` launch path
  without requiring administrator rights.

## 7. Error Handling

- GUI startup must not fail because Codex or Claude config is missing.
- Malformed JSON/TOML must show parse-error status and preserve the original
  file untouched.
- Permission errors must be visible in Doctor with the affected path.
- Log and capsule reads should cap file size to avoid freezing the UI.
- Tauri commands must be read-only and must not expose arbitrary command
  execution.

## 8. Testing

Rust backend tests:

- Missing config files produce `missing` statuses.
- Malformed config files produce `parse_error` statuses without panic.
- v2 hook blocks are detected.
- v1 duplicate hook signals are detected.
- capsule listing ignores malformed capsule files but reports count of skipped
  files.

Frontend tests or build checks:

- TypeScript build passes.
- Dashboard renders from a mocked snapshot.
- Empty state views render without layout overflow.

Manual verification:

- `cargo test --workspace`
- desktop app build
- run dashboard locally
- confirm `install --dry-run` still emits no duplicate warning on this machine
- if `aho` registration is implemented, open `cmd` and run `aho`

## 9. Out of Scope

- Config repair buttons.
- Capsule mutation.
- Daemon write API.
- Tauri updater.
- Signed installer.
- Tray menu polish.
- React Three Fiber.
- Monaco editor.
- GUI as hook target.

## 10. Acceptance Criteria

- Tauri app opens to Overview as first screen.
- Overview shows installed v2 state from this machine.
- Doctor distinguishes OK, warning, error, and unknown checks.
- Capsules view does not crash when store is empty or contains malformed JSON.
- Settings shows resolved local paths.
- Logs view handles missing logs.
- No Codex or Claude config file is modified by opening the GUI.
- `aho` opens the dashboard from Windows `cmd` after install.
