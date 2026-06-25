use crate::AgentArg;
use ai_handoff_ipc::{
    client::{send, ClientConfig},
    protocol::{ClientInfo, Request, VERSION},
};
use chrono::{SecondsFormat, Utc};
use serde_json::Value;
use std::io::{Read, Write};

pub fn run(event: &str, agent: AgentArg) -> anyhow::Result<i32> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    Ok(run_io(event, agent.as_str(), &mut input, &mut output))
}

pub fn run_io(event: &str, agent: &str, input: &mut dyn Read, out: &mut dyn Write) -> i32 {
    let mut raw_text = String::new();
    let _ = input.read_to_string(&mut raw_text);
    let raw = serde_json::from_str::<Value>(raw_text.trim()).unwrap_or(Value::Null);
    let cwd = raw
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default()
        });

    let req = Request {
        version: VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: "hook_event".to_string(),
        agent: agent.to_string(),
        event: event.to_string(),
        received_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        cwd,
        session_id: raw
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        turn_id: raw
            .get("turn_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        raw_hook_input: raw,
        client: ClientInfo {
            binary_version: env!("CARGO_PKG_VERSION").to_string(),
            pid: std::process::id(),
            platform: std::env::consts::OS.to_string(),
        },
    };

    let resp = send(&req, &ClientConfig::default());
    for warning in &resp.warnings {
        eprintln!("[ai-handoff] {warning}");
    }
    let text = serde_json::to_string(&resp.hook_stdout).unwrap_or_else(|_| "{}".to_string());
    let _ = writeln!(out, "{text}");
    0
}
