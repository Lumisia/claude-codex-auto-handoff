use ai_handoff_daemon::router::Router;
use ai_handoff_ipc::protocol::{ClientInfo, Request, VERSION};
use ai_handoff_ipc::server::Handler;
use serde_json::json;

// Build a PostToolUse hook_event request whose transcript reports `used_percent`.
fn post_tool_use_req(cwd: &str, transcript: &str) -> Request {
    Request {
        version: VERSION,
        request_id: "req-1".to_string(),
        kind: "hook_event".to_string(),
        agent: "codex".to_string(),
        event: "post-tool-use".to_string(),
        received_at: "2026-06-26T00:00:00Z".to_string(),
        cwd: cwd.to_string(),
        session_id: Some("s-1".to_string()),
        turn_id: Some("t-1".to_string()),
        raw_hook_input: json!({ "cwd": cwd, "transcript_path": transcript }),
        client: ClientInfo {
            binary_version: "test".to_string(),
            pid: 0,
            platform: "test".to_string(),
        },
    }
}

#[test]
fn configured_threshold_overrides_the_old_hardcoded_80() {
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("AI_HANDOFF_HOME", home.path());

    // Global config lowers the threshold to 50 (the old hardcode was 80).
    std::fs::write(
        home.path().join("config.toml"),
        "[triggers.five_hour]\nthreshold_percent = 50\nmode = \"ask\"\n",
    )
    .unwrap();

    // Transcript whose latest primary used_percent is 60 (>= 50, < 80).
    let transcript = home.path().join("t.jsonl");
    std::fs::write(
        &transcript,
        "{\"payload\":{\"rate_limits\":{\"primary\":{\"used_percent\":60.0}}}}\n",
    )
    .unwrap();

    let req = post_tool_use_req(
        home.path().to_string_lossy().as_ref(),
        transcript.to_string_lossy().as_ref(),
    );
    let resp = Router::new().handle(&req);

    // With the configured threshold of 50, used=60 fires "threshold".
    // Under the old hardcoded 80 it would have been "below".
    assert_eq!(resp.diagnostics["trigger_reason"], "threshold");
    assert_eq!(resp.diagnostics["used_percent"], 60.0);

    std::env::remove_var("AI_HANDOFF_HOME");
}
