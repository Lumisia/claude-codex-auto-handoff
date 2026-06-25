# AI Handoff v2 — Sub-project 2: Installer / Config-Patcher Design

**Date:** 2026-06-25
**Status:** Approved (scope + uninstall model)
**Depends on:** Sub-project 1 (native hook shim + daemon) complete @ commit 5c19dcf
**Scope:** Windows only; both agents (Codex + Claude). macOS/Linux, packaged installer, and GUI are out of scope (later sub-projects).

---

## 1. Goal

`ai-handoff install` wires the user's live Claude and Codex so their lifecycle
hooks call the v2 native binary, and Codex's sandbox is allowed to write the IPC
directory — without clobbering the user's existing (large, hand-maintained)
config. `ai-handoff uninstall` cleanly removes exactly what we added and nothing
else. This is what finally enables the real Codex-on-Windows EPERM acceptance
(Sub-project 1 §8 left it pending).

## 2. The non-negotiable: never clobber, surgical uninstall

The user's real `~/.codex/config.toml` is ~8.5 KB: `sandbox_mode`, `[windows]`,
~25 `[projects.'...']` trust entries, `[marketplaces]`, `[plugins]`, `[desktop]`
themes, `[hooks.state]` trust hashes, `[mcp_servers]` with computer-use runtime
paths, `[tui]`. Two rules follow:

1. **Install edits surgically.** Never parse-and-reserialize the whole file (that
   reorders tables, drops comments, and can corrupt literal-string paths like
   `'\\?\C:\...'` and quoted keys like `[projects.'c:\...']`). Use a
   format-preserving editor (`toml_edit`) for `config.toml`; key-merge for JSON.

2. **Uninstall removes only our managed entries — it does NOT restore a backup.**
   *Rationale (user-raised):* if uninstall blindly restored the pre-install
   backup of `config.toml`/`hooks.json`/`settings.json`, then anything the user
   installed or changed *after* our install (new MCP servers, new project trusts,
   other tools' edits) would be silently wiped. So uninstall must delete exactly
   the items we added, leaving everything else — including later user changes —
   intact. Backups are a **safety net for manual recovery only**, never the
   uninstall mechanism.

`install-state.json` is the source of truth for what to remove: it records each
item we added (which file, which key/array-element/hook-id), so uninstall is a
precise reversal driven by recorded state, not by guessing or by restoring a
snapshot.

## 3. Doc-grounded Codex formats (verified against official docs)

Per the requirement to implement Codex from real documentation, the formats
below are taken from the official Codex docs and MUST be re-verified against the
live doc at implementation time (field names can evolve):

- **User-level hooks** — `https://developers.openai.com/codex/hooks`. Codex reads
  user hooks from `~/.codex/hooks.json` (JSON) OR `[[hooks.<Event>]]` tables in
  `config.toml`. We use the standalone **`~/.codex/hooks.json`** (a separate file
  keeps the complex `config.toml` untouched for hooks). Shape:
  ```json
  {
    "hooks": {
      "SessionStart": [
        { "matcher": "startup|resume",
          "hooks": [ { "type": "command", "command": "...", "statusMessage": "..." } ] }
      ]
    }
  }
  ```
  Trust: a non-managed command hook must be reviewed/trusted via the `/hooks`
  command; trust is recorded against the hook's hash, so any later edit needs
  re-trust. Multiple matching command hooks for one event run **concurrently** —
  this is precisely why a leftover v1 plugin hook would double-fire (§6).
  **At implementation time, verify from the live doc the exact optional fields**
  (`commandWindows`, `timeout`, allowed `matcher` values) before emitting them.

- **Sandbox writable roots** — `https://developers.openai.com/codex/config-reference`.
  Top-level table:
  ```toml
  [sandbox_workspace_write]
  writable_roots = ["C:\\Users\\PC\\.ai-handoff\\ipc"]
  ```
  (`sandbox_mode = "workspace-write"` is a top-level key and is already present
  in the user's config.) We add **only the IPC dir** to `writable_roots`, never
  the store.

- **Env for spawned hooks** — same reference. Top-level table:
  ```toml
  [shell_environment_policy]
  set = { AI_HANDOFF_HOME = "C:\\Users\\PC\\.ai-handoff" }
  ```
  `inherit` ∈ {`all`,`core`,`none`}. We set only our key inside `set`, preserving
  any existing `set`/`inherit`.

- **Sandbox applies to spawned commands** — `https://developers.openai.com/codex/concepts/sandboxing`
  (the reason the hook must not write the store; the daemon does, outside the sandbox).

## 4. Architecture

Logic vs. IO are split so the patch math is unit-testable without touching live
files:

- **`ai-handoff-core::install`** (pure, testable): detect agents/configs; compute
  the patch plan; render a dry-run diff; apply via format-preserving editors;
  compute the surgical-removal plan from `install-state.json`; backup helper.
  New dep: `toml_edit`.
- **`ai-handoff-cli::commands::{install, uninstall}`**: stdin/stdout, the
  approval prompt, writing files, Scheduled Task registration.

Files: `crates/ai-handoff-core/src/install/{mod.rs, detect.rs, codex.rs, claude.rs, state.rs, diff.rs, backup.rs}`,
`crates/ai-handoff-cli/src/commands/{install.rs, uninstall.rs}`.

## 5. Commands

```
ai-handoff install   [--dry-run] [--yes] [--agents codex,claude]
ai-handoff uninstall [--keep-store | --purge-store]
```

- Hook command paths use `std::env::current_exe()` — install wires hooks to
  wherever the running binary lives (a packaged installer is Sub-project 6).
- `install` default: detect → print plan + diff → require confirmation → backup →
  apply → verify (re-read, confirm our entries present) → print `/hooks` trust
  reminder. `--dry-run` stops after the diff. `--yes` skips the prompt.
- Re-running `install` is **idempotent**: managed entries are matched and
  replaced in place (by recorded id / our exe path), never duplicated.

## 6. Patch targets (Windows) and their managed entries

| Target | We ADD (managed) | Preserve |
|---|---|---|
| `~/.codex/hooks.json` | 4 lifecycle hooks → `"<exe>" hook <event> --agent codex` (+ doc-verified `commandWindows`/`timeout`), each tagged so uninstall finds exactly them | any non-ours hooks |
| `~/.codex/config.toml` | `[sandbox_workspace_write].writable_roots` += IPC dir; `[shell_environment_policy].set.AI_HANDOFF_HOME` | everything else (25 projects, mcp, themes, hooks.state, …) |
| `~/.claude/settings.json` | `hooks` block (4 events) → `"<exe>"` + `args:[hook,<event>,--agent,claude-code]` | model, statusLine, enabledPlugins, … |

Uninstall reverses each: remove our 4 Codex hooks (leave others); remove only our
IPC path from `writable_roots` (drop the table only if it becomes empty AND we
created it); remove only `AI_HANDOFF_HOME` from `set` (drop table if we created it
and it's now empty); remove our Claude hook entries (leave any user hooks).

## 7. v1 duplicate-hook handling (detect + guide, no auto plugin edit)

The user currently has the v1 `ai-handoff` plugin active and trusted (Claude
`enabledPlugins` + Codex `[hooks.state]` for `hooks-codex.json`). Because Codex
runs same-event hooks concurrently, leaving v1 in place double-fires every event.
The installer **detects** this and **warns with explicit guidance**: disable the
v1 plugin's lifecycle hooks (Codex: reject them in `/hooks`; Claude: set
`enabledPlugins."ai-handoff@…" = false` or uninstall the v1 plugin). It does
**not** auto-edit plugin state — the v1 plugin may still provide slash
commands/skills the user wants, and silently toggling another component's
enablement is exactly the kind of clobber §2 forbids.

## 8. Backups + install-state

Before first modifying any file: copy to `<file>.ai-handoff-backup-YYYYMMDD-HHMMSS`
(safety net only). `~/.ai-handoff/install-state.json` records, per modified file:
the backup path, and the exact managed items added (hook ids, the writable_roots
value we appended, the env key we set, the Claude hook event ids). Uninstall and
re-install read this to act precisely.

## 9. Daemon autostart

Windows Scheduled Task, per-user, on logon:
```
schtasks /Create /SC ONLOGON /TN "AI Handoff" /TR "\"<exe>\" daemon run" /RL LIMITED /F
```
`install` registers it; `uninstall` removes it (`schtasks /Delete /TN "AI Handoff" /F`).
Recorded in `install-state.json`.

## 10. Testing

- **Unit (core, no live files):** use the user's real complex `config.toml` as a
  committed fixture (sanitized if needed); assert that after patch, every
  pre-existing table/key is byte-preserved and only the two new tables/keys are
  added; assert idempotent re-apply; assert surgical uninstall removes exactly our
  entries and a fixture with *post-install user additions* keeps those additions;
  hooks.json + settings.json merge/idempotency/removal; backup creation; dry-run
  diff text. **Tests operate on temp copies — never the user's real files.**
- **CLI integration:** `install --dry-run` against temp `$HOME` copies prints a
  correct plan and writes nothing; `install --yes` then `uninstall` round-trips a
  fixture back to a state where only our entries are gone.
- **Manual acceptance (the real goal):** run `ai-handoff install` on this machine,
  trust hooks via Codex `/hooks`, run a Codex session, confirm capsule write with
  no EPERM and cross-agent injection; then `ai-handoff uninstall` and confirm the
  user's other config is untouched.

## 11. Implementation process

- Codex review checkpoint after the core `install` module and after the CLI
  commands (correctness of surgical removal, toml_edit preservation, idempotency,
  never-clobber).
- Codex-specific behavior is implemented from the **live official docs** (URLs in
  §3), re-verifying exact field names at implementation time, not from memory.

## 12. Out of scope

macOS/Linux patchers, LaunchAgent/systemd, packaged installer + signed updater,
GUI, automatic v1 plugin disablement, migration of the v1 store (Sub-project 3).

## 13. Success criteria

1. `ai-handoff install` on Windows adds our hooks + the two Codex config tables +
   the Claude hooks block + Scheduled Task, with the real `config.toml`'s other
   ~25 tables byte-preserved.
2. Re-running `install` does not duplicate anything.
3. `ai-handoff uninstall` removes exactly our entries; a config that gained
   user additions after install keeps those additions.
4. Backups exist but are not used as the uninstall path.
5. v1 duplicate plugin hooks are detected and surfaced with guidance.
6. Manual: a real Codex session post-install writes a capsule with no EPERM.
