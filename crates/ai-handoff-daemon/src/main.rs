fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args == ["run"] || args == ["daemon", "run"] {
        ai_handoff_daemon::run();
    }

    eprintln!("usage: ai-handoff-daemon [daemon] run");
    std::process::exit(2);
}
