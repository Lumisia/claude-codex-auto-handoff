pub fn run() -> anyhow::Result<i32> {
    let gui = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("AI Handoff.exe")));
    if let Some(gui) = gui {
        if gui.exists() {
            std::process::Command::new(gui).spawn()?;
            return Ok(0);
        }
    }

    eprintln!("AI Handoff dashboard executable not found next to ai-handoff.exe");
    Ok(1)
}
