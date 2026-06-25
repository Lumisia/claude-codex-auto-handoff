pub mod dedupe;
pub mod router;
pub mod store;

use std::time::Duration;

pub fn ensure_runtime_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(ai_handoff_core::paths::requests_dir())?;
    std::fs::create_dir_all(ai_handoff_core::paths::responses_dir())?;
    std::fs::create_dir_all(ai_handoff_core::paths::dead_letter_dir())?;
    std::fs::create_dir_all(ai_handoff_core::paths::logs_dir())?;
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(ai_handoff_core::paths::logs_dir().join("daemon.log"))?;
    Ok(())
}

pub fn run() -> ! {
    let _ = ensure_runtime_dirs();
    let router = router::Router::new();
    ai_handoff_ipc::server::serve_forever(&router, Duration::from_millis(25))
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::{Mutex, MutexGuard};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    pub(crate) fn env_lock() -> MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
    }
}
