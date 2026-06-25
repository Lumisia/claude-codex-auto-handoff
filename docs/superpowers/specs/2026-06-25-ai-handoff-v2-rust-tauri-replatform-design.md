# AI Handoff v2 — Rust/Tauri Replatform Design

**Date:** 2026-06-25
**Status:** Approved (program direction + Sub-project 1 MVP scope)
**Author:** brainstorming session (Lumisia + Claude)

---

## 1. Decision summary

ai-handoff v1.2.0 is a mature Node.js plugin (~4,600 LOC core, 78 test files,
4-language i18n) that brokers context-pressure-aware handoff between Claude Code
and Codex. Its automatic Codex hooks fail on Windows for two stacked reasons,
documented in `ai-handoff-hooks-report.md`:

1. `scripts/run-hook.mjs` performs a nested `node` spawn that is blocked
   (`EPERM`) inside the Codex sandbox.
2. The store write to `AI_HANDOFF_ROOT` is blocked (`EPERM`) inside the sandbox;
   `writable_roots` alone only addresses this second layer.

The user has chosen a **full replatform to Rust + Tauri 2 + React/Vite/TypeScript**
(per `ai-handoff-rust-tauri-v2-implementation-plan.md`), executed in stages. The
load-bearing architectural insight is:

> The hook process must NOT write the store. A thin native hook shim does only
> IPC; a daemon running OUTSIDE the sandbox owns all store writes.

This removes both EPERM layers: no nested spawn (single Rust binary) and no
in-sandbox store write (daemon is outside the sandbox; the hook only touches the
IPC directory, which is the single path added to Codex `writable_roots`).

### Fixed program-level decisions

- **Repository:** transform the existing repo (`github.com/Lumisia/claude-codex-auto-handoff`)
  in place into a Cargo workspace under `crates/`. This is a **full replacement** —
  the Node v1 codebase is removed as part of the replatform, NOT kept running in
  parallel.
- **Commit / push timing:** work proceeds in the working tree on the
  `v2-rust-tauri` branch with **no interim commits or pushes**. A single commit +
  push to the repo happens **only once the entire replatform is complete**.
- **Final version bump:** at that completion commit, bump to **v2.0.1** (v2.0.0
  is intentionally skipped per user preference).
- **Codex review:** Codex is invoked as advisory reviewer at each crate's
  implementation checkpoint (aligns with global CLAUDE.md). Codex findings are
  fixed for correctness/security/regression; uncertain findings are verified
  before acting. Codex does not gate commits by itself.

---

## 2. Program decomposition

Too large for a single spec. Build order prioritizes the vertical slice that
**proves the EPERM fix end-to-end first**; GUI is last. Each sub-project gets its
own spec → plan → implementation cycle.

| # | Sub-project | Goal |
|---|---|---|
| 0 | Toolchain bootstrap | `rustup` + MSVC C++ Build Tools; empty Cargo workspace skeleton |
| **1** | **MVP vertical slice** | **`cli` (hook shim) + `ipc` + `daemon` + minimal `core` → Codex-on-Windows EPERM solved end-to-end. ← THIS SPEC** |
| 2 | Installer / config-patcher | Claude + Codex settings patch, backups, OS service registration |
| 3 | Migration v1 → v2 | read v1 capsules, convert store, schema versioning |
| 4 | Core feature parity | port remaining v1 (sensors/monitors/ratelimit/memory/statusline/i18n) |
| 5 | Tauri GUI | dashboard / doctor / capsules / settings |
| 6 | Release / updater / CI | signed Tauri updater, GitHub Actions matrix, packaging |

### Toolchain reality (verified 2026-06-25)

| Requirement | Status |
|---|---|
| Node / pnpm | OK (v24.13.0 / pnpm 10.34.1) |
| WebView2 (Tauri prereq) | OK (Edge 149 present) |
| Rust (rustc/cargo) | **MISSING — install in Sub-project 0** |
| MSVC C++ Build Tools (Windows linker) | Unverified — confirm in Sub-project 0 |

---

## 3. Sub-project 1 — MVP scope

**"Done" criterion (user-selected: handoff + core sensors):**

In scope:
- Capsule save / load (JSON), the four hook events
  (SessionStart / UserPromptSubmit / PostToolUse / Stop), project fingerprint,
  store write via daemon.
- Context-pressure **threshold + burn-rate** detection and **auto-handoff
  trigger** (the `evaluateTrigger` logic).
- Pending-capsule injection on SessionStart / UserPromptSubmit.

Explicitly OUT of scope for the MVP (deferred to later sub-projects):
named pipe / UDS transport, SQLite index, installer, OS service registration,
migration, statusline / memory recall / usage monitor, appserver + shadow
sensors, GUI, updater.

---

## 4. MVP architecture

### 4.1 Process model

```
Codex / Claude hook  (inside sandbox)
  → ai-handoff(.exe) hook <event>        # thin shim; never writes the store
      → write   ipc/requests/<uuid>.json
      → poll    ipc/responses/<uuid>.json   (until timeout)
      → emit hook JSON on stdout, exit 0

ai-handoff daemon  (outside sandbox; manual `daemon run` for MVP)
  → watch ipc/requests → store write → write ipc/responses/<uuid>.json
```

EPERM is resolved because: (a) the hook is a single Rust binary — no nested
spawn; (b) the hook only writes under the IPC dir, the one path added to Codex
`writable_roots`; (c) all store writes happen in the daemon, which runs outside
the sandbox.

### 4.2 Crate boundaries (MVP only)

| crate | MVP responsibility |
|---|---|
| `ai-handoff-core` | OS path resolution, project fingerprint (faithful port), capsule schema (v2 subset), `evaluateTrigger` math, hook-payload normalization, redaction |
| `ai-handoff-ipc` | **file IPC only**: request/response protocol, atomic rename, timeouts, request id/nonce |
| `ai-handoff-daemon` | IPC watch loop, store writer, event dedupe; runs via manual `daemon run` |
| `ai-handoff-cli` | `hook <event> --agent <claude-code\|codex>`, `daemon run`, reduced `doctor`, `checkpoint` |

### 4.3 Default choices (approved)

- **IPC:** file IPC only. Named pipe / UDS deferred (sandbox traversal of a pipe
  to an outside-sandbox process is uncertain; the file path under `writable_roots`
  is the guaranteed channel). Named pipe becomes an optional fast-path later.
- **Store index:** JSON files only; **no SQLite** in the MVP (list/search is a GUI
  concern → Sub-project 5). Capsule JSON is the source of truth.
- **Repo:** add a Cargo workspace under `crates/` in the existing repo. Full
  replacement — v1 is not kept running in parallel; uncommitted until the whole
  replatform is complete.
- **Daemon lifecycle:** manual `daemon run` for the MVP; OS service registration
  (Scheduled Task / LaunchAgent / systemd-user) is Sub-project 2.
- **Sensor input:** JSONL parsing only for `usedPercent`. The appserver / shadow /
  statusline readers are excluded. If `usedPercent` is unavailable, the trigger
  evaluates to `none` and the hook is a no-op — proving the auto-handoff skeleton
  with minimal risk.

### 4.4 Events handled

SessionStart (inject pending capsule), UserPromptSubmit (threshold check +
pending injection), PostToolUse (threshold check), Stop (parse + save capsule).
Agent-specific Codex/Claude payloads are normalized into a shared
`NormalizedHookEvent` model in `core`.

### 4.5 Failure policy (never break agent UX)

- Daemon unavailable or request timeout → hook emits `{}` on stdout, exit 0.
- Stop-event save failure → logged in the daemon log only; hook still exits 0.
- Manual CLI commands (not hooks) may return meaningful non-zero exit codes.

Recommended timeouts (from the plan): connect 150 ms, request 1500 ms, file IPC
wait 2000 ms, within the agent hook timeout of 10 s.

---

## 5. Store layout (MVP subset)

```
<AI_HANDOFF_HOME>/
├─ config.toml
├─ store/
│  ├─ schema-version
│  ├─ capsules/<project-id>/<capsule-id>.json   # source of truth
│  ├─ projects/<project-id>.json
│  └─ sessions/<session-id>.json
├─ ipc/
│  ├─ requests/
│  ├─ responses/
│  └─ dead-letter/
└─ logs/
   ├─ daemon.log
   └─ hook.log
```

Windows home defaults to `%USERPROFILE%\.ai-handoff` (not `%LOCALAPPDATA%`) to
avoid the MSIX/Store AppData redirection split that can make Claude and Codex see
different physical paths. The capsule schema is the v2 subset needed for handoff:
`schema_version`, `capsule_id`, `project_id`, `created_at`, `source_agent`,
`target_agent`, `session`, `summary`, `files`, `next_prompt`, `redaction`,
`consumption`.

---

## 6. Highest risk — project fingerprint port

`projectFingerprintInfo` (~200 LOC in `core/lib/fingerprint.mjs`) decides which
capsule bucket a project maps to. If the Rust port diverges, Claude and Codex
land in different buckets and **handoff silently fails**. Subtleties that must be
preserved byte-for-byte:

- basis priority: `remote.origin.url` → gitroot → path.
- git-config value decoding (inline comments, quoted/escaped values).
- credential sanitization of the remote URL (userinfo + query/fragment for
  scheme URLs; scp-style SSH left untouched).
- relative local-remote anchoring against repo root (lexical, never realpath).
- sandbox-blocked fallback: only when `git` is blocked (EPERM/ENOENT/EACCES) do
  we read `.git` from the filesystem — the working-git path must stay identical.
- final fingerprint = `sha256(basis.value)` truncated to 24 hex chars.

**Mitigation:** the v1 test suite is the oracle. The Rust port is validated by
feeding identical inputs and asserting byte-identical fingerprints against v1
fixtures (especially `tests/fingerprint.test.mjs` and
`tests/fingerprint-redact.test.mjs`).

---

## 7. Testing strategy (MVP)

- **Unit:** path resolution per OS, fingerprint (oracle parity vs v1),
  `evaluateTrigger` (threshold + burn-rate), payload normalization, redaction.
- **Integration:** CLI hook with daemon online; with daemon offline (no-op exit
  0); file IPC round-trip; daemon store write; duplicate-event dedupe.
- **Manual acceptance (the real bug):** in a Codex-on-Windows session with
  `writable_roots = [ipc dir]`, run all four hook events and confirm a capsule is
  written without EPERM, and a pending capsule is injected on the next session.

---

## 8. Success criteria

The MVP is complete when:

1. `ai-handoff hook <event> --agent codex` inside a Codex sandbox writes a capsule
   (via the daemon) with **no EPERM**, exit 0.
2. A pending capsule from one agent is injected into the other on SessionStart.
3. Threshold / burn-rate auto-handoff trigger fires correctly from JSONL-derived
   `usedPercent` (and is a clean no-op when the signal is absent).
4. Daemon-offline and timeout paths are no-ops with exit 0.
5. Fingerprint port passes byte-parity against v1 fixtures (fixtures used as a
   correctness oracle even though v1 itself is being retired).

---

## 9. Out of scope (whole-program reminders)

Deferred to their numbered sub-projects: named pipe/UDS, SQLite index, installer
& config-patcher, OS service registration, v1→v2 migration, full sensor/monitor/
memory/statusline/i18n parity, Tauri GUI, signed updater, CI matrix, packaging.
