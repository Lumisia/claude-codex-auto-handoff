use ai_handoff_core::{config, fingerprint::fingerprint, sensor::record_claude_rate_limit, statusline::segment};
use ai_handoff_daemon::store::find_pending;
use chrono::Utc;
use serde_json::Value;
use std::io::{Read, Write};

pub fn run() -> anyhow::Result<i32> {
    let cfg = config::load();
    let now_ms = Utc::now().timestamp_millis();
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    Ok(run_io(&mut input, &mut output, now_ms, cfg.statusline.show))
}

pub fn run_io(input: &mut dyn Read, out: &mut dyn Write, now_ms: i64, show: bool) -> i32 {
    // Read all stdin; treat empty or unparseable as Value::Null.
    let mut raw_text = String::new();
    let _ = input.read_to_string(&mut raw_text);
    let json: Value = serde_json::from_str(raw_text.trim()).unwrap_or(Value::Null);

    // Record the rate-limit sample (ignore result — never error).
    record_claude_rate_limit(&json, now_ms);

    // Extract used_percent from rate_limits.five_hour.used_percentage.
    let used_percent: Option<f64> = json
        .get("rate_limits")
        .and_then(|rl| rl.get("five_hour"))
        .and_then(|fh| fh.get("used_percentage"))
        .and_then(Value::as_f64);

    // Derive cwd from input.cwd or input.workspace.current_dir.
    let cwd_str: Option<String> = json
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            json.get("workspace")
                .and_then(|ws| ws.get("current_dir"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    // Check pending capsule when cwd is known.
    let pending = cwd_str
        .as_deref()
        .map(|cwd| {
            let path = std::path::Path::new(cwd);
            let project_id = fingerprint(path);
            find_pending(&project_id).is_some()
        })
        .unwrap_or(false);

    // Render and print the segment.
    let seg = segment(used_percent, pending, show);
    if seg.is_empty() {
        // No trailing newline for empty segment.
    } else {
        let _ = write!(out, "{seg}");
    }

    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::{Mutex, MutexGuard};

    // Serialise all env-mutating tests (AI_HANDOFF_HOME) into one mutex.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock() -> MutexGuard<'static, ()> {
        TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    const NOW_MS: i64 = 1_750_000_000_000;

    fn run_with(json: &str, show: bool) -> (String, i32) {
        let mut input = Cursor::new(json.as_bytes().to_vec());
        let mut out: Vec<u8> = Vec::new();
        let code = run_io(&mut input, &mut out, NOW_MS, show);
        (String::from_utf8(out).unwrap(), code)
    }

    #[test]
    fn with_used_percentage_prints_segment_and_exits_zero() {
        let _g = lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());

        let payload = r#"{
            "session_id": "sess-abc",
            "rate_limits": { "five_hour": { "used_percentage": 42.0 } }
        }"#;
        let (out, code) = run_with(payload, true);
        assert_eq!(code, 0);
        assert_eq!(out, "AH 42%");

        std::env::remove_var("AI_HANDOFF_HOME");
    }

    #[test]
    fn empty_stdin_prints_ah_and_exits_zero() {
        let _g = lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());

        let (out, code) = run_with("", true);
        assert_eq!(code, 0);
        assert_eq!(out, "AH");

        std::env::remove_var("AI_HANDOFF_HOME");
    }

    #[test]
    fn show_false_produces_empty_output_and_exits_zero() {
        let _g = lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());

        let payload = r#"{
            "session_id": "sess-xyz",
            "rate_limits": { "five_hour": { "used_percentage": 55.0 } }
        }"#;
        let (out, code) = run_with(payload, false);
        assert_eq!(code, 0);
        assert!(out.is_empty(), "show=false must produce empty output, got: {out:?}");

        std::env::remove_var("AI_HANDOFF_HOME");
    }

    #[test]
    fn invalid_json_stdin_exits_zero_and_prints_ah() {
        let _g = lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());

        let (out, code) = run_with("NOT JSON {{{", true);
        assert_eq!(code, 0);
        assert_eq!(out, "AH");

        std::env::remove_var("AI_HANDOFF_HOME");
    }

    #[test]
    fn workspace_current_dir_fallback_for_cwd() {
        let _g = lock();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("AI_HANDOFF_HOME", home.path());

        // Use workspace.current_dir instead of cwd — still exits 0.
        let payload = r#"{
            "session_id": "sess-ws",
            "rate_limits": { "five_hour": { "used_percentage": 75.0 } },
            "workspace": { "current_dir": "C:\\some\\project" }
        }"#;
        let (out, code) = run_with(payload, true);
        assert_eq!(code, 0);
        assert_eq!(out, "AH 75%");

        std::env::remove_var("AI_HANDOFF_HOME");
    }
}
