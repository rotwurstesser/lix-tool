// End-to-end check of grammar.rs without the GUI: install (sha256 verified), start, check, stop.
// Usage: cargo run --example grammar_cli -- --app-data DIR [--cache DIR] [MODE]
//   (default)     install, check the two probe sentences, measure RSS, stop, prove no java is left
//   --idle-test   also prove the idle stop: no check for the idle floor (30 s), then the process is gone
//   --wrong-hash  install with a wrong LanguageTool sha256: must fail and leave no files
//   --serve       install, start, print the port, keep running until stdin closes (for the eval)
// Exit code 0 when every assertion holds.

use lix_writer_lib::grammar::{idle_from_keep_alive, Config, Grammar, Install, Manifest};
use std::io::BufRead;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

fn fail(msg: &str) -> ! {
    eprintln!("FAIL: {msg}");
    std::process::exit(1);
}

fn rss_kb(pid: u32) -> Option<u64> {
    let out = Command::new("/bin/ps").args(["-o", "rss=", "-p", &pid.to_string()]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

fn java_left(java: &str) -> String {
    let out = Command::new("/usr/bin/pgrep").args(["-fl", java]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn matches(json: &str) -> Vec<(String, String, String)> {
    let v: serde_json::Value = serde_json::from_str(json).unwrap();
    v["matches"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            let ctx = &m["context"];
            let text = ctx["text"].as_str().unwrap_or("");
            let off = ctx["offset"].as_u64().unwrap_or(0) as usize;
            let len = ctx["length"].as_u64().unwrap_or(0) as usize;
            let snippet: String = text.chars().skip(off).take(len).collect();
            (m["rule"]["id"].as_str().unwrap_or("").to_string(), m["rule"]["category"]["id"].as_str().unwrap_or("").to_string(), snippet)
        })
        .collect()
}

fn main() {
    let mut app_data = None;
    let mut cache = None;
    let mut mode = "default".to_string();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--app-data" => app_data = args.next().map(PathBuf::from),
            "--cache" => cache = args.next().map(PathBuf::from),
            "--idle-test" | "--wrong-hash" | "--serve" => mode = arg[2..].to_string(),
            other => fail(&format!("unknown argument {other}")),
        }
    }
    let app_data = app_data.unwrap_or_else(|| fail("--app-data is required"));
    let mut manifest = Manifest::bundled();
    if mode == "wrong-hash" {
        manifest.languagetool.sha256 = "0".repeat(64);
    }
    let cfg = Config { app_data, manifest, cache_dir: cache, idle: idle_from_keep_alive("0") };
    let grammar = Grammar::new(cfg.clone());
    let java = cfg.java().to_string_lossy().into_owned();

    let t0 = Instant::now();
    let status = grammar.install();
    println!("install: {:?} \"{}\" in {:.1} s", status.install, status.message, t0.elapsed().as_secs_f64());
    if mode == "wrong-hash" {
        if status.install != Install::Failed || !status.message.contains("sha256 mismatch") {
            fail("a wrong sha256 must end in the failed state");
        }
        if cfg.dir().exists() {
            fail(&format!("{} still exists after the sha256 mismatch", cfg.dir().display()));
        }
        println!("PASS wrong-hash: failed state, {} removed", cfg.dir().display());
        return;
    }
    if status.install != Install::Installed {
        fail(&status.message);
    }
    println!("disk: {} MB in {}", grammar.disk_bytes() / 1_000_000, cfg.dir().display());

    if mode == "serve" {
        let port = grammar.ensure_running().unwrap_or_else(|e| fail(&e));
        // Keep the server busy-marked: the eval checks for hours, so the idle stop must not hit between stories.
        grammar.set_idle(Duration::MAX);
        println!("serving http://127.0.0.1:{port} pid {}", grammar.pid().unwrap_or(0));
        for _ in std::io::stdin().lock().lines() {}
        grammar.stop();
        let left = java_left(&java);
        println!("stopped; java left: {}", if left.is_empty() { "none" } else { &left });
        return;
    }

    let t1 = Instant::now();
    let port = grammar.ensure_running().unwrap_or_else(|e| fail(&e));
    let pid = grammar.pid().unwrap();
    println!("server: port {port} pid {pid}, ready in {:.1} s", t1.elapsed().as_secs_f64());

    // Sample RSS while checks run.
    let peak = Arc::new(AtomicU64::new(0));
    let done = Arc::new(AtomicBool::new(false));
    let sampler = {
        let (peak, done) = (peak.clone(), done.clone());
        thread::spawn(move || {
            while !done.load(Ordering::SeqCst) {
                if let Some(kb) = rss_kb(pid) {
                    peak.fetch_max(kb, Ordering::SeqCst);
                }
                thread::sleep(Duration::from_millis(100));
            }
        })
    };

    let t2 = Instant::now();
    let bad = grammar.check("Er gab dem Hase eine Karotte.", "de-CH", &[]).unwrap_or_else(|e| fail(&e));
    let bad = matches(&bad);
    println!("check 1 ({:.1} s, first check loads German): {bad:?}", t2.elapsed().as_secs_f64());
    if !bad.iter().any(|(id, cat, snip)| id == "DE_AGREEMENT" && cat == "GRAMMAR" && snip.contains("dem Hase")) {
        fail("\"dem Hase\" not flagged as DE_AGREEMENT");
    }
    let good = grammar
        .check("Der Hund hatte einen grossen Knochen und viel Spass.", "de-CH", &[])
        .unwrap_or_else(|e| fail(&e));
    let good = matches(&good);
    println!("check 2: {good:?}");
    if good.iter().any(|(_, _, snip)| snip.contains("grossen") || snip.contains("Spass")) {
        fail("Swiss spelling \"grossen\" / \"Spass\" was flagged");
    }
    let story = "Am Sonntag geht Lena mit ihrem Hund in den grossen Park. Die Sonne scheint hell und die Vögel singen fröhlich im Baum. \
                 Plötzlich rennt der Hund los und bellt einen kleinen Igel an. Lena ruft ihn zurück, aber er gehorcht ihr heute leider nicht.";
    let t3 = Instant::now();
    for _ in 0..20 {
        grammar.check(story, "de-CH", &[]).unwrap_or_else(|e| fail(&e));
    }
    println!("20 story checks: {:.0} ms each", t3.elapsed().as_secs_f64() * 1000.0 / 20.0);
    done.store(true, Ordering::SeqCst);
    sampler.join().unwrap();
    let now = rss_kb(pid).unwrap_or(0);
    println!("RSS java pid {pid}: peak during checks {} MB, after checks {} MB", peak.load(Ordering::SeqCst) / 1024, now / 1024);

    if mode == "idle-test" {
        let t4 = Instant::now();
        while grammar.status().running && t4.elapsed() < Duration::from_secs(90) {
            thread::sleep(Duration::from_millis(500));
        }
        let left = java_left(&java);
        println!("idle stop after {:.0} s; java left: {}", t4.elapsed().as_secs_f64(), if left.is_empty() { "none" } else { &left });
        if !left.is_empty() || grammar.status().running {
            fail("server still running after the idle time");
        }
    }

    // What the app does on exit.
    grammar.stop();
    thread::sleep(Duration::from_millis(300));
    let left = java_left(&java);
    println!("after stop, pgrep -fl {java}: {}", if left.is_empty() { "(nothing)" } else { &left });
    if !left.is_empty() {
        fail("java process left after stop");
    }
    println!("PASS");
}
