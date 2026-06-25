use ai_handoff_ipc::protocol::Request;
use sha2::{Digest, Sha256};
use std::collections::{HashSet, VecDeque};

pub fn dedupe_key(req: &Request) -> String {
    let mut hasher = Sha256::new();
    hasher.update(req.agent.as_bytes());
    hasher.update(b"\0");
    hasher.update(req.event.as_bytes());
    hasher.update(b"\0");
    hasher.update(req.session_id.as_deref().unwrap_or("").as_bytes());
    hasher.update(b"\0");
    hasher.update(req.turn_id.as_deref().unwrap_or("").as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub struct Deduper {
    seen: HashSet<String>,
    order: VecDeque<String>,
    cap: usize,
}

impl Deduper {
    pub fn new(cap: usize) -> Self {
        Self {
            seen: HashSet::new(),
            order: VecDeque::new(),
            cap,
        }
    }

    pub fn check_and_record(&mut self, key: &str) -> bool {
        if self.seen.contains(key) {
            return true;
        }
        if self.cap == 0 {
            return false;
        }

        let key = key.to_string();
        self.seen.insert(key.clone());
        self.order.push_back(key);

        while self.order.len() > self.cap {
            if let Some(oldest) = self.order.pop_front() {
                self.seen.remove(&oldest);
            }
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_handoff_ipc::protocol::{ClientInfo, Request, VERSION};
    use serde_json::json;

    fn request(session_id: Option<&str>, turn_id: Option<&str>) -> Request {
        Request {
            version: VERSION,
            request_id: format!("req-{}", turn_id.unwrap_or("none")),
            kind: "hook_event".into(),
            agent: "codex".into(),
            event: "stop".into(),
            received_at: "2026-06-25T12:34:56Z".into(),
            cwd: "/repo".into(),
            session_id: session_id.map(str::to_owned),
            turn_id: turn_id.map(str::to_owned),
            raw_hook_input: json!({}),
            client: ClientInfo {
                binary_version: "2.0.0-mvp".into(),
                pid: 1,
                platform: "windows".into(),
            },
        }
    }

    #[test]
    fn key_is_stable_and_distinguishes_turns() {
        let a = dedupe_key(&request(Some("s"), Some("t1")));
        let b = dedupe_key(&request(Some("s"), Some("t1")));
        let c = dedupe_key(&request(Some("s"), Some("t2")));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn check_and_record_detects_duplicates() {
        let mut d = Deduper::new(10);
        assert!(!d.check_and_record("a"));
        assert!(d.check_and_record("a"));
        assert!(!d.check_and_record("b"));
    }

    #[test]
    fn evicts_oldest_beyond_cap() {
        let mut d = Deduper::new(2);
        assert!(!d.check_and_record("a"));
        assert!(!d.check_and_record("b"));
        assert!(!d.check_and_record("c"));
        assert!(!d.check_and_record("a"));
        assert!(d.check_and_record("c"));
    }
}
