use ai_handoff_cli::commands::hook;
use std::io::Cursor;

#[test]
fn hook_offline_returns_noop_stdout_and_exit_zero() {
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("AI_HANDOFF_HOME", home.path());
    let mut input = Cursor::new(r#"{"cwd":"C:\\repo","session_id":"s1"}"#.as_bytes());
    let mut out = Vec::new();
    let code = hook::run_io("session-start", "codex", &mut input, &mut out);
    assert_eq!(code, 0);
    assert_eq!(String::from_utf8(out).unwrap(), "{}\n");
    std::env::remove_var("AI_HANDOFF_HOME");
}
