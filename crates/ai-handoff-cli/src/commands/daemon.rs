use crate::DaemonAction;

pub fn run(action: DaemonAction) -> anyhow::Result<i32> {
    match action {
        DaemonAction::Run => ai_handoff_daemon::run(),
        DaemonAction::Status => {
            println!("daemon status: unknown");
            Ok(0)
        }
    }
}
