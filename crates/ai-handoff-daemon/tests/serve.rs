use ai_handoff_daemon::{ensure_runtime_dirs, router::Router};
use ai_handoff_ipc::{
    protocol::{ClientInfo, Request, Response, Status, VERSION},
    server::serve_once,
};
use serde_json::json;

#[test]
fn serve_once_end_to_end_writes_response() {
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("AI_HANDOFF_HOME", home.path());
    ensure_runtime_dirs().unwrap();

    let req = Request {
        version: VERSION,
        request_id: "req-e2e".into(),
        kind: "hook_event".into(),
        agent: "claude-code".into(),
        event: "session-start".into(),
        received_at: "2026-06-25T12:34:56Z".into(),
        cwd: home.path().to_string_lossy().into_owned(),
        session_id: Some("s1".into()),
        turn_id: Some("t1".into()),
        raw_hook_input: json!({ "cwd": home.path().to_string_lossy() }),
        client: ClientInfo {
            binary_version: "2.0.0-mvp".into(),
            pid: 1,
            platform: "windows".into(),
        },
    };
    std::fs::write(
        ai_handoff_core::paths::requests_dir().join("req-e2e.json"),
        serde_json::to_vec(&req).unwrap(),
    )
    .unwrap();

    let router = Router::new();
    assert_eq!(serve_once(&router), 1);
    let resp: Response = serde_json::from_slice(
        &std::fs::read(ai_handoff_core::paths::responses_dir().join("req-e2e.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(resp.status, Status::Ok);
    assert_eq!(resp.hook_stdout, json!({}));
    assert!(ai_handoff_core::paths::logs_dir()
        .join("daemon.log")
        .exists());
    std::env::remove_var("AI_HANDOFF_HOME");
}
