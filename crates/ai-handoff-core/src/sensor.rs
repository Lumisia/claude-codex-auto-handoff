use serde_json::Value;
use std::path::Path;

pub fn used_percent_from_jsonl(path: &Path) -> Option<f64> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find_map(parse_used_percent_line)
}

fn parse_used_percent_line(line: &str) -> Option<f64> {
    let value: Value = serde_json::from_str(line).ok()?;
    value
        .get("payload")?
        .get("rate_limits")?
        .get("primary")?
        .get("used_percent")?
        .as_f64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonl_missing_file_is_none() {
        assert!(used_percent_from_jsonl(std::path::Path::new("/no/such.jsonl")).is_none());
    }

    #[test]
    fn jsonl_reads_latest_used_percent() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("u.jsonl");
        std::fs::write(
            &p,
            "{\"payload\":{\"rate_limits\":{\"primary\":{\"used_percent\":12.5}}}}\n\
             {\"type\":\"x\"}\n\
             {\"payload\":{\"rate_limits\":{\"primary\":{\"used_percent\":42.5}}}}\n",
        )
        .unwrap();
        assert_eq!(used_percent_from_jsonl(&p), Some(42.5));
    }

    #[test]
    fn jsonl_ignores_non_primary_shapes() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("u.jsonl");
        std::fs::write(&p, "{\"used_percent\":42.5}\n").unwrap();
        assert!(used_percent_from_jsonl(&p).is_none());
    }
}
