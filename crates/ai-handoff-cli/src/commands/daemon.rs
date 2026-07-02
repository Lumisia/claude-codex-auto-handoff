use crate::DaemonAction;

pub fn run(action: DaemonAction, stay_alive: bool) -> anyhow::Result<i32> {
    match action {
        DaemonAction::Run => Ok(ai_handoff_daemon::run(stay_alive)),
        DaemonAction::Status => {
            let status = if super::hook::ping_daemon(std::time::Duration::from_millis(750)) {
                "reachable"
            } else {
                "unreachable"
            };
            println!("daemon status: {status}");
            Ok(0)
        }
    }
}
