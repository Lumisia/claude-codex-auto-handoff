use clap::{Parser, Subcommand, ValueEnum};

pub mod commands;

#[derive(Debug, Parser)]
#[command(name = "ai-handoff")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    Hook {
        event: String,
        #[arg(long, value_enum, default_value_t = AgentArg::Codex)]
        agent: AgentArg,
    },
    Daemon {
        #[arg(value_enum)]
        action: DaemonAction,
    },
    Doctor {
        #[arg(long)]
        json: bool,
    },
    Checkpoint {
        #[arg(long)]
        message: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AgentArg {
    #[value(name = "claude-code")]
    ClaudeCode,
    Codex,
}

impl AgentArg {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum DaemonAction {
    Run,
    Status,
}

pub fn main_entry() -> anyhow::Result<i32> {
    run_cli(Cli::parse())
}

pub fn run_cli(cli: Cli) -> anyhow::Result<i32> {
    match cli.command {
        Commands::Hook { event, agent } => commands::hook::run(&event, agent),
        Commands::Daemon { action } => commands::daemon::run(action),
        Commands::Doctor { json } => commands::doctor::run(json),
        Commands::Checkpoint { message } => commands::checkpoint::run(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_hook_command() {
        let cli = Cli::try_parse_from(["ai-handoff", "hook", "session-start", "--agent", "codex"])
            .unwrap();

        match cli.command {
            Commands::Hook { event, agent } => {
                assert_eq!(event, "session-start");
                assert_eq!(agent, AgentArg::Codex);
            }
            other => panic!("unexpected command: {other:?}"),
        }
    }
}
