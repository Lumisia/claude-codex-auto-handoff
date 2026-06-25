# AI Handoff v2 MVP Acceptance

Date: 2026-06-25
Branch: v2-rust-tauri

## Automated Verification

- [x] `cargo test -p ai-handoff-core`
- [x] `cargo test -p ai-handoff-ipc`
- [x] `cargo test -p ai-handoff-daemon`
- [x] `cargo test -p ai-handoff-cli`
- [x] `cargo test -p ai-handoff-cli --test e2e_hook_daemon`
- [x] `cargo build --release`

## Manual Codex-on-Windows Acceptance

Not completed in this Codex session. This requires changing the user's live
Codex hook configuration, trusting hooks via `/hooks`, and running the daemon
outside the sandbox.

Manual checklist:

- [ ] Start daemon outside Codex:
  `target/release/ai-handoff.exe daemon run`
- [ ] Add IPC dir to Codex `writable_roots`:
  `C:\Users\PC\.ai-handoff\ipc`
- [ ] Point Codex lifecycle hooks to:
  `target/release/ai-handoff.exe hook <event> --agent codex`
- [ ] Trust the new hooks via `/hooks`.
- [ ] Trigger `SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `Stop`.
- [ ] Confirm no `EPERM` appears.
- [ ] Confirm `Stop` writes a capsule under `store/capsules/<project-id>/`.
- [ ] Confirm peer `SessionStart` injects and consumes the pending capsule.

## Current MVP Result

The automated vertical slice passes: hook CLI writes file IPC requests, daemon
handles requests outside the hook process, Stop stores a pending capsule, and
peer SessionStart returns `additionalContext` and marks the capsule consumed.
