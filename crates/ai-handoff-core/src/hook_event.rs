use crate::capsule::AgentKind;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HookEventKind {
    SessionStart,
    UserPromptSubmit,
    PostToolUse,
    Stop,
}

impl HookEventKind {
    pub fn parse(s: &str) -> Option<Self> {
        let compact: String = s
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect();

        match compact.as_str() {
            "sessionstart" => Some(Self::SessionStart),
            "userprompt" | "userpromptsubmit" => Some(Self::UserPromptSubmit),
            "posttooluse" => Some(Self::PostToolUse),
            "stop" => Some(Self::Stop),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NormalizedHookEvent {
    pub agent: AgentKind,
    pub event: HookEventKind,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub cwd: PathBuf,
    pub transcript_path: Option<PathBuf>,
    pub tool_name: Option<String>,
    pub tool_input: Value,
    pub tool_response: Value,
    pub raw: Value,
}

pub fn normalize(agent: AgentKind, event: HookEventKind, raw: &Value) -> NormalizedHookEvent {
    let cwd = first_string(
        raw,
        &[
            &["cwd"],
            &["workspace", "current_dir"],
            &["workspace", "cwd"],
            &["workspace", "root"],
        ],
    )
    .map(PathBuf::from)
    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    NormalizedHookEvent {
        agent,
        event,
        session_id: first_string(raw, &[&["session_id"], &["session", "id"], &["sessionId"]]),
        turn_id: first_string(raw, &[&["turn_id"], &["turn", "id"], &["turnId"]]),
        cwd,
        transcript_path: first_string(raw, &[&["transcript_path"], &["transcript", "path"]])
            .map(PathBuf::from),
        tool_name: first_string(raw, &[&["tool_name"], &["tool", "name"], &["toolName"]]),
        tool_input: first_value(raw, &[&["tool_input"], &["tool", "input"], &["toolInput"]])
            .cloned()
            .unwrap_or(Value::Null),
        tool_response: first_value(
            raw,
            &[
                &["tool_response"],
                &["tool", "response"],
                &["tool", "output"],
                &["toolResponse"],
            ],
        )
        .cloned()
        .unwrap_or(Value::Null),
        raw: raw.clone(),
    }
}

fn first_string(raw: &Value, paths: &[&[&str]]) -> Option<String> {
    paths
        .iter()
        .filter_map(|path| first_value(raw, &[*path]))
        .find_map(|value| value.as_str().map(str::to_owned))
}

fn first_value<'a>(raw: &'a Value, paths: &[&[&str]]) -> Option<&'a Value> {
    for path in paths {
        let mut value = raw;
        let mut found = true;
        for key in *path {
            match value.get(*key) {
                Some(next) => value = next,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if found {
            return Some(value);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capsule::AgentKind;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn parses_event_kind_from_cli_and_payload_spellings() {
        assert_eq!(
            HookEventKind::parse("session-start"),
            Some(HookEventKind::SessionStart)
        );
        assert_eq!(
            HookEventKind::parse("SessionStart"),
            Some(HookEventKind::SessionStart)
        );
        assert_eq!(
            HookEventKind::parse("user-prompt"),
            Some(HookEventKind::UserPromptSubmit)
        );
        assert_eq!(
            HookEventKind::parse("UserPromptSubmit"),
            Some(HookEventKind::UserPromptSubmit)
        );
        assert_eq!(
            HookEventKind::parse("PostToolUse"),
            Some(HookEventKind::PostToolUse)
        );
        assert_eq!(HookEventKind::parse("stop"), Some(HookEventKind::Stop));
        assert_eq!(HookEventKind::parse("nope"), None);
    }

    #[test]
    fn normalizes_claude_post_tool_use() {
        let raw = json!({
            "session_id": "s1",
            "cwd": "/work/repo",
            "transcript_path": "/t.jsonl",
            "tool_name": "Edit",
            "tool_input": { "file_path": "a.rs" },
            "tool_response": { "ok": true }
        });
        let n = normalize(AgentKind::ClaudeCode, HookEventKind::PostToolUse, &raw);
        assert_eq!(n.session_id.as_deref(), Some("s1"));
        assert_eq!(n.cwd, PathBuf::from("/work/repo"));
        assert_eq!(n.transcript_path, Some(PathBuf::from("/t.jsonl")));
        assert_eq!(n.tool_name.as_deref(), Some("Edit"));
        assert_eq!(n.tool_input["file_path"], "a.rs");
        assert_eq!(n.tool_response["ok"], true);
    }

    #[test]
    fn normalizes_codex_nested_fields() {
        let raw = json!({
            "session": { "id": "codex-s" },
            "turn_id": "turn-1",
            "workspace": { "current_dir": "/repo" },
            "transcript_path": "/codex.jsonl",
            "tool": {
                "name": "shell_command",
                "input": { "command": "cargo test" },
                "response": { "exit_code": 0 }
            }
        });
        let n = normalize(AgentKind::Codex, HookEventKind::PostToolUse, &raw);
        assert_eq!(n.session_id.as_deref(), Some("codex-s"));
        assert_eq!(n.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(n.cwd, PathBuf::from("/repo"));
        assert_eq!(n.tool_name.as_deref(), Some("shell_command"));
        assert_eq!(n.tool_input["command"], "cargo test");
        assert_eq!(n.tool_response["exit_code"], 0);
    }
}
