use std::path::{Path, PathBuf};

use ai_handoff_core::install::state::{InstallState, LauncherState};

pub fn install_aho_launcher(
    ai_home: &Path,
    target_exe: Option<&Path>,
) -> anyhow::Result<LauncherState> {
    install_aho_launcher_with(ai_home, target_exe, ensure_user_path_contains)
}

fn install_aho_launcher_with<F>(
    ai_home: &Path,
    target_exe: Option<&Path>,
    ensure_path: F,
) -> anyhow::Result<LauncherState>
where
    F: FnOnce(&Path) -> anyhow::Result<Option<String>>,
{
    let bin = ai_home.join("bin");
    std::fs::create_dir_all(&bin)?;
    let cmd = bin.join("aho.cmd");
    let target = target_exe
        .map(Path::to_path_buf)
        .unwrap_or_else(default_cli_target);
    let text = format!("@echo off\r\n\"{}\" %*\r\n", target.to_string_lossy());
    std::fs::write(&cmd, text)?;
    let path_dir_added = ensure_path(&bin)?;
    Ok(LauncherState {
        path: Some(cmd.to_string_lossy().into_owned()),
        path_dir_added,
    })
}

pub fn remove_aho_launcher(st: &InstallState) -> anyhow::Result<()> {
    remove_aho_launcher_with(st, remove_user_path_entry)
}

fn remove_aho_launcher_with<F>(st: &InstallState, remove_path: F) -> anyhow::Result<()>
where
    F: FnOnce(&Path) -> anyhow::Result<()>,
{
    if let Some(path) = st.launcher.as_ref().and_then(|l| l.path.as_ref()) {
        let p = PathBuf::from(path);
        if p.exists() {
            std::fs::remove_file(p)?;
        }
    }
    if let Some(dir) = st.launcher.as_ref().and_then(|l| l.path_dir_added.as_ref()) {
        remove_path(Path::new(dir))?;
    }
    Ok(())
}

fn default_cli_target() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("ai-handoff.exe"))
}

#[cfg(windows)]
fn ensure_user_path_contains(bin: &Path) -> anyhow::Result<Option<String>> {
    let current = read_user_path()?;
    let (next, added) = append_user_path_entry(&current, bin);
    if added.is_some() {
        write_user_path(&next)?;
    }
    // Our bin dir lives under the AI home, so its presence on PATH is our entry.
    // Record it whenever it ends up present (added now or already there) so an
    // idempotent re-install keeps ownership for uninstall to remove.
    Ok(Some(bin.to_string_lossy().into_owned()))
}

#[cfg(not(windows))]
fn ensure_user_path_contains(_bin: &Path) -> anyhow::Result<Option<String>> {
    Ok(None)
}

#[cfg(windows)]
fn remove_user_path_entry(bin: &Path) -> anyhow::Result<()> {
    let current = read_user_path()?;
    let bin_text = bin.to_string_lossy().to_string();
    let next = current
        .split(';')
        .filter(|entry| !entry.eq_ignore_ascii_case(&bin_text))
        .collect::<Vec<_>>()
        .join(";");
    if next != current {
        write_user_path(&next)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn remove_user_path_entry(_bin: &Path) -> anyhow::Result<()> {
    Ok(())
}

fn append_user_path_entry(existing: &str, bin: &Path) -> (String, Option<String>) {
    let bin_text = bin.to_string_lossy().to_string();
    if existing
        .split(';')
        .any(|entry| entry.eq_ignore_ascii_case(&bin_text))
    {
        return (existing.to_string(), None);
    }
    let next = if existing.trim().is_empty() {
        bin_text.clone()
    } else {
        format!("{existing};{bin_text}")
    };
    (next, Some(bin_text))
}

#[cfg(windows)]
fn read_user_path() -> anyhow::Result<String> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Environment", "/v", "Path"])
        .output()?;
    if !output.status.success() {
        return Ok(String::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("Path")
                .and_then(|rest| rest.split_once("REG_"))
                .and_then(|(_, rest)| rest.split_once(' '))
                .map(|(_, value)| value.trim().to_string())
        })
        .unwrap_or_default())
}

#[cfg(windows)]
fn write_user_path(value: &str) -> anyhow::Result<()> {
    let status = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Environment",
            "/v",
            "Path",
            "/t",
            "REG_EXPAND_SZ",
            "/d",
            value,
            "/f",
        ])
        .status()?;
    anyhow::ensure!(status.success(), "failed to update HKCU user Path");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn writes_aho_cmd_that_invokes_cli_with_forwarded_args() {
        let dir = tempfile::tempdir().unwrap();
        let cli = dir.path().join("ai-handoff.exe");

        let state = install_aho_launcher_with(dir.path(), Some(&cli), |_| Ok(None)).unwrap();
        let path = std::path::PathBuf::from(state.path.unwrap());
        let text = std::fs::read_to_string(path).unwrap();

        assert!(text.contains("@echo off"));
        assert!(text.contains("ai-handoff.exe"));
        assert!(text.contains("%*"));
        assert!(!text.contains("start \"\""));
    }

    #[test]
    fn records_path_dir_added_when_path_updater_adds_it() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");

        let state = install_aho_launcher_with(dir.path(), None, |actual_bin| {
            assert_eq!(actual_bin, bin);
            Ok(Some(actual_bin.to_string_lossy().into_owned()))
        })
        .unwrap();

        assert_eq!(
            state.path_dir_added,
            Some(bin.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn remove_launcher_deletes_recorded_cmd_and_owned_path_entry() {
        let dir = tempfile::tempdir().unwrap();
        let removed_path = RefCell::new(None);
        let state = install_aho_launcher_with(dir.path(), None, |_| Ok(None)).unwrap();
        let path = std::path::PathBuf::from(state.path.clone().unwrap());
        assert!(path.exists());

        let install_state = ai_handoff_core::install::state::InstallState {
            launcher: Some(ai_handoff_core::install::state::LauncherState {
                path: state.path,
                path_dir_added: Some(dir.path().join("bin").to_string_lossy().into_owned()),
            }),
            ..Default::default()
        };
        remove_aho_launcher_with(&install_state, |p| {
            *removed_path.borrow_mut() = Some(p.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert!(!path.exists());
        assert_eq!(*removed_path.borrow(), Some(dir.path().join("bin")));
    }

    #[test]
    fn path_append_preserves_existing_entries_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        let existing = format!("C:\\Windows\\System32;{}", bin.to_string_lossy());

        let (next, added) = append_user_path_entry(&existing, &bin);

        assert_eq!(next, existing);
        assert_eq!(added, None);
    }
}
