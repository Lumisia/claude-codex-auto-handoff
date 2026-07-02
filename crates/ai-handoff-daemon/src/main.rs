fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args == ["run"] || args == ["daemon", "run"] {
        std::process::exit(ai_handoff_daemon::run(false));
    }
    if args == ["run", "--stay-alive"] || args == ["daemon", "run", "--stay-alive"] {
        std::process::exit(ai_handoff_daemon::run(true));
    }

    eprintln!("usage: ai-handoff-daemon [daemon] run [--stay-alive]");
    std::process::exit(2);
}
