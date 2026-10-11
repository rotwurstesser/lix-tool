// Runs the app backend without the GUI, for experiments/eval/app-backend.sh.
// Usage: cargo run --example backend_cli -- --app-data DIR [--bin PATH] [--keep-alive 10s]
// Prints one JSON status line after start. Reads commands from stdin:
// "status", "restart", "quit". End of input also quits (unload, stop, cleanup).

use lix_writer_lib::backend::{Backend, Config};
use std::io::BufRead;
use std::path::PathBuf;

fn main() {
    let mut app_data = None;
    let mut bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ollama/ollama");
    let mut keep_alive = "5m".to_string();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = args.next().expect("missing value");
        match arg.as_str() {
            "--app-data" => app_data = Some(PathBuf::from(value)),
            "--bin" => bin = PathBuf::from(value),
            "--keep-alive" => keep_alive = value,
            other => panic!("unknown argument {other}"),
        }
    }
    let app_data = app_data.expect("--app-data is required");
    let backend = Backend::new(Config { bin, app_data, keep_alive });

    let print = |b: &Backend| println!("{}", serde_json::to_string(&b.status()).unwrap());
    backend.start();
    print(&backend);

    for line in std::io::stdin().lock().lines() {
        match line.unwrap_or_default().trim() {
            "status" => print(&backend),
            "restart" => {
                backend.start();
                print(&backend);
            }
            "quit" => break,
            _ => {}
        }
    }
    backend.stop();
    println!("{{\"state\":\"stopped\"}}");
}
