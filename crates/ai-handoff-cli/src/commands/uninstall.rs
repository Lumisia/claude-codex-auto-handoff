use std::{
    io::{Read, Write},
    path::Path,
};

use ai_handoff_core::{
    install::{apply_uninstall, state, targets_for, InstallTargets},
    paths,
};
use anyhow::{bail, Context};

use super::autostart::delete_autostart;

pub use super::autostart::{delete_hkcu_run_argv, delete_task_argv};

pub fn run(keep_store: bool, purge_store: bool) -> anyhow::Result<i32> {
    let base_dirs = directories::BaseDirs::new().context("could not determine user home")?;
    let exe = std::env::current_exe().context("could not determine current executable")?;
    let targets = targets_for(
        base_dirs.home_dir(),
        &paths::home(),
        &paths::ipc_dir(),
        &exe,
    );
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    run_with_targets(
        &targets,
        keep_store,
        purge_store,
        &mut stdin.lock(),
        &mut stdout.lock(),
        true,
    )
}

pub fn run_with_targets(
    targets: &InstallTargets,
    keep_store: bool,
    purge_store: bool,
    input: &mut dyn Read,
    out: &mut dyn Write,
    delete_task: bool,
) -> anyhow::Result<i32> {
    if keep_store && purge_store {
        bail!("--keep-store and --purge-store cannot be used together");
    }

    let st = state::load(&targets.home);
    apply_uninstall(targets, &st)?;

    if delete_task {
        delete_autostart(&st)?;
    }
    super::launcher::remove_aho_launcher(&st)?;
    purge_file(&state::state_path(&targets.home))?;

    if purge_store {
        if confirm(
            input,
            out,
            "Delete local AI Handoff store/log/ipc data? [y/N] ",
        )? {
            purge_local_data(targets)?;
            writeln!(out, "Local AI Handoff data purged.")?;
        } else {
            writeln!(out, "Purge cancelled; local data kept.")?;
        }
    } else {
        writeln!(out, "Local AI Handoff store/logs kept.")?;
    }

    writeln!(out, "Uninstall complete.")?;
    Ok(0)
}

fn confirm(input: &mut dyn Read, out: &mut dyn Write, prompt: &str) -> anyhow::Result<bool> {
    write!(out, "{prompt}")?;
    out.flush()?;
    let mut answer = String::new();
    input.read_to_string(&mut answer)?;
    Ok(matches!(
        answer.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}

fn purge_dir(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn purge_file(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn purge_local_data(targets: &InstallTargets) -> std::io::Result<()> {
    purge_dir(&targets.home.join("store"))?;
    purge_dir(&targets.ipc_dir)?;
    purge_dir(&targets.home.join("logs"))?;
    purge_file(&state::state_path(&targets.home))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_task_argv_targets_ai_handoff_task() {
        assert_eq!(
            delete_task_argv(),
            vec!["/Delete", "/TN", "AI Handoff", "/F"]
        );
    }

    #[test]
    fn uninstall_removes_recorded_launcher_cmd() {
        let dir = tempfile::tempdir().unwrap();
        let user_home = dir.path();
        let ai_home = user_home.join("ai-home");
        let bin = ai_home.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let launcher = bin.join("aho.cmd");
        std::fs::write(&launcher, "@echo off\r\n").unwrap();
        state::save(
            &ai_home,
            &state::InstallState {
                launcher: Some(state::LauncherState {
                    path: Some(launcher.to_string_lossy().into_owned()),
                    path_dir_added: None,
                }),
                ..Default::default()
            },
        )
        .unwrap();
        let targets = targets_for(
            user_home,
            &ai_home,
            &ai_home.join("ipc"),
            std::path::Path::new("C:/p/ai-handoff.exe"),
        );
        let mut input: &[u8] = b"";
        let mut output = Vec::new();

        let code =
            run_with_targets(&targets, false, false, &mut input, &mut output, false).unwrap();

        assert_eq!(code, 0);
        assert!(!launcher.exists());
    }
}
