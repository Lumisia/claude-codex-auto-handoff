pub mod detect;
pub mod state;

pub use detect::{detect_agents, targets_for, AgentPresence, InstallTargets};
pub use state::{load, save, state_path, ClaudeState, CodexState, FileMod, InstallState};
