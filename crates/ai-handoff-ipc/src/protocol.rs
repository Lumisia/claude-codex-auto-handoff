use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub version: u32,
    pub request_id: String,
    pub kind: String,
    pub agent: String,
    pub event: String,
    pub received_at: String,
    pub cwd: String,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub raw_hook_input: serde_json::Value,
    pub client: ClientInfo,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClientInfo {
    pub binary_version: String,
    pub pid: u32,
    pub platform: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    Degraded,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub version: u32,
    pub request_id: String,
    pub status: Status,
    pub hook_stdout: serde_json::Value,
    pub warnings: Vec<String>,
    pub diagnostics: serde_json::Value,
}

pub fn degraded(request_id: &str, warning: &str) -> Response {
    Response {
        version: VERSION,
        request_id: request_id.to_string(),
        status: Status::Degraded,
        hook_stdout: serde_json::json!({}),
        warnings: vec![warning.to_string()],
        diagnostics: serde_json::json!({}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_roundtrips_json() {
        let req = Request {
            version: VERSION,
            request_id: "req-1".into(),
            kind: "hook_event".into(),
            agent: "codex".into(),
            event: "stop".into(),
            received_at: "2026-06-25T12:34:56Z".into(),
            cwd: "/repo".into(),
            session_id: Some("s1".into()),
            turn_id: Some("t1".into()),
            raw_hook_input: json!({ "cwd": "/repo" }),
            client: ClientInfo {
                binary_version: "2.0.0-mvp".into(),
                pid: 123,
                platform: "windows".into(),
            },
        };

        let text = serde_json::to_string(&req).unwrap();
        let back: Request = serde_json::from_str(&text).unwrap();
        assert_eq!(back.version, VERSION);
        assert_eq!(back.request_id, "req-1");
        assert_eq!(back.client.platform, "windows");
    }

    #[test]
    fn response_roundtrips_snake_case_status() {
        let resp = Response {
            version: VERSION,
            request_id: "req-1".into(),
            status: Status::Ok,
            hook_stdout: json!({ "continue": true }),
            warnings: vec![],
            diagnostics: json!({ "daemon_latency_ms": 12 }),
        };

        let text = serde_json::to_string(&resp).unwrap();
        assert!(text.contains(r#""status":"ok""#));
        let back: Response = serde_json::from_str(&text).unwrap();
        assert_eq!(back.status, Status::Ok);
        assert_eq!(back.hook_stdout["continue"], true);
    }

    #[test]
    fn degraded_response_shape_is_safe_noop() {
        let resp = degraded("req-2", "daemon_unavailable");
        assert_eq!(resp.version, VERSION);
        assert_eq!(resp.request_id, "req-2");
        assert_eq!(resp.status, Status::Degraded);
        assert_eq!(resp.hook_stdout, json!({}));
        assert_eq!(resp.warnings, vec!["daemon_unavailable"]);
    }
}
