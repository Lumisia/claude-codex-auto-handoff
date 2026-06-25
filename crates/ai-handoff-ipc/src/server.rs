use crate::protocol::{Request, Response};
use ai_handoff_core::paths::{dead_letter_dir, requests_dir, responses_dir};
use std::path::Path;
use std::time::Duration;

pub trait Handler {
    fn handle(&self, req: &Request) -> Response;
}

pub fn serve_once(handler: &dyn Handler) -> usize {
    let _ = std::fs::create_dir_all(requests_dir());
    let _ = std::fs::create_dir_all(responses_dir());
    let _ = std::fs::create_dir_all(dead_letter_dir());

    let Ok(entries) = std::fs::read_dir(requests_dir()) else {
        return 0;
    };

    let mut processed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_request_file(&path) {
            continue;
        }

        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let req = match serde_json::from_slice::<Request>(&bytes) {
            Ok(req) => req,
            Err(_) => {
                move_to_dead_letter(&path);
                continue;
            }
        };

        let response = handler.handle(&req);
        if write_response(&response).is_ok() {
            let _ = std::fs::remove_file(&path);
            processed += 1;
        }
    }

    processed
}

pub fn serve_forever(handler: &dyn Handler, poll: Duration) -> ! {
    loop {
        serve_once(handler);
        std::thread::sleep(poll);
    }
}

fn is_request_file(path: &Path) -> bool {
    path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json")
}

fn write_response(resp: &Response) -> std::io::Result<()> {
    let dir = responses_dir();
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.json", resp.request_id));
    let tmp = dir.join(format!("{}.json.tmp", resp.request_id));
    let bytes = serde_json::to_vec(resp)?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn move_to_dead_letter(path: &Path) {
    let _ = std::fs::create_dir_all(dead_letter_dir());
    if let Some(name) = path.file_name() {
        let dest = dead_letter_dir().join(name);
        let _ = std::fs::remove_file(&dest);
        if std::fs::rename(path, &dest).is_err() {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ClientInfo, Request, Response, Status, VERSION};
    use crate::test_support::env_lock;
    use ai_handoff_core::paths::{dead_letter_dir, requests_dir, responses_dir};
    use serde_json::json;

    struct EchoHandler;
    impl Handler for EchoHandler {
        fn handle(&self, req: &Request) -> Response {
            Response {
                version: VERSION,
                request_id: req.request_id.clone(),
                status: Status::Ok,
                hook_stdout: json!({ "ok": true }),
                warnings: vec![],
                diagnostics: json!({}),
            }
        }
    }

    fn sample_request(id: &str) -> Request {
        Request {
            version: VERSION,
            request_id: id.into(),
            kind: "hook_event".into(),
            agent: "codex".into(),
            event: "stop".into(),
            received_at: "2026-06-25T12:34:56Z".into(),
            cwd: "/repo".into(),
            session_id: None,
            turn_id: None,
            raw_hook_input: json!({}),
            client: ClientInfo {
                binary_version: "2.0.0-mvp".into(),
                pid: 1,
                platform: "windows".into(),
            },
        }
    }

    #[test]
    fn serve_once_writes_response_and_deletes_request() {
        let _guard = env_lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());
        std::fs::create_dir_all(requests_dir()).unwrap();
        std::fs::create_dir_all(responses_dir()).unwrap();
        let req = sample_request("req-server");
        let req_path = requests_dir().join("req-server.json");
        std::fs::write(&req_path, serde_json::to_vec(&req).unwrap()).unwrap();

        assert_eq!(serve_once(&EchoHandler), 1);
        assert!(!req_path.exists());
        let resp: Response = serde_json::from_slice(
            &std::fs::read(responses_dir().join("req-server.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(resp.request_id, "req-server");
        assert_eq!(resp.hook_stdout["ok"], true);
        std::env::remove_var("AI_HANDOFF_HOME");
    }

    #[test]
    fn serve_once_moves_malformed_requests_to_dead_letter() {
        let _guard = env_lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());
        std::fs::create_dir_all(requests_dir()).unwrap();
        let req_path = requests_dir().join("bad.json");
        std::fs::write(&req_path, b"not json").unwrap();

        assert_eq!(serve_once(&EchoHandler), 0);
        assert!(!req_path.exists());
        assert!(dead_letter_dir().join("bad.json").exists());
        std::env::remove_var("AI_HANDOFF_HOME");
    }
}
