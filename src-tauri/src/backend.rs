// Starts and stops the bundled Ollama server. Std only: no HTTP or process crates.

use serde::Serialize;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const FIRST_PORT: u16 = 11535;
const PORT_TRIES: u16 = 100;
const READY_TIMEOUT: Duration = Duration::from_secs(15);
// Ollama rejects "tauri://localhost" at start; the wildcard form passes its origin check.
const ORIGINS: &str = "tauri://*,http://tauri.localhost,http://localhost:3000";

#[derive(Clone, Debug)]
pub struct Config {
    /// The bundled `ollama` executable.
    pub bin: PathBuf,
    /// App data dir: models, pid file, log.
    pub app_data: PathBuf,
    /// Default idle time before Ollama unloads the model, e.g. "5m".
    pub keep_alive: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Starting,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
pub struct Status {
    pub state: State,
    pub message: String,
    pub url: Option<String>,
}

struct Inner {
    status: Status,
    child: Option<Child>,
    port: Option<u16>,
    /// Log size when the child started: error messages show only its own lines.
    log_start: u64,
    /// Counts starts and stops. A start thread with an old number gives up.
    generation: u64,
}

#[derive(Clone)]
pub struct Backend {
    config: Arc<Mutex<Config>>,
    inner: Arc<Mutex<Inner>>,
    /// Lock on <app data>/instance.lock, held while the app runs.
    instance_lock: Arc<Mutex<Option<File>>>,
}

impl Config {
    pub fn models_dir(&self) -> PathBuf {
        self.app_data.join("models")
    }
    pub fn pid_file(&self) -> PathBuf {
        self.app_data.join("ollama.pid")
    }
    pub fn log_file(&self) -> PathBuf {
        self.app_data.join("logs").join("ollama.log")
    }
    fn lock_file(&self) -> PathBuf {
        self.app_data.join("instance.lock")
    }
}

fn starting() -> Status {
    Status { state: State::Starting, message: "Starting the writing engine".into(), url: None }
}

impl Inner {
    /// A ready engine can die later (crash, kill). Then the status becomes failed.
    fn check_exit(&mut self, log: &Path) {
        if self.status.state != State::Ready {
            return;
        }
        let Some(child) = self.child.as_mut() else { return };
        if let Ok(Some(code)) = child.try_wait() {
            self.child = None;
            self.port = None;
            self.status = Status {
                state: State::Failed,
                message: format!("The writing engine stopped ({code}).{}", log_tail(log, self.log_start)),
                url: None,
            };
        }
    }
}

impl Backend {
    pub fn new(config: Config) -> Self {
        Backend {
            config: Arc::new(Mutex::new(config)),
            inner: Arc::new(Mutex::new(Inner { status: starting(), child: None, port: None, log_start: 0, generation: 0 })),
            instance_lock: Arc::new(Mutex::new(None)),
        }
    }

    pub fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    pub fn set_keep_alive(&self, keep_alive: String) {
        self.config.lock().unwrap().keep_alive = keep_alive;
    }

    pub fn status(&self) -> Status {
        let log = self.config().log_file();
        let mut inner = self.inner.lock().unwrap();
        inner.check_exit(&log);
        inner.status.clone()
    }

    pub fn url(&self) -> Option<String> {
        let status = self.status();
        match status.state {
            State::Ready => status.url,
            _ => None,
        }
    }

    /// Sets the status to starting at once and returns the number of this start.
    fn begin_start(&self) -> u64 {
        let mut inner = self.inner.lock().unwrap();
        inner.generation += 1;
        inner.status = starting();
        inner.generation
    }

    /// Starts Ollama on a background thread. The status is "starting" when this returns.
    pub fn start_async(&self) {
        let generation = self.begin_start();
        let me = self.clone();
        thread::spawn(move || me.run(generation));
    }

    /// Starts Ollama and waits until it answers or fails. Returns the final status.
    pub fn start(&self) -> Status {
        let generation = self.begin_start();
        self.run(generation)
    }

    fn run(&self, generation: u64) -> Status {
        self.shutdown_child();
        let mut result = self.launch(generation);
        let mut message = "Ready".to_string();
        // Ollama falls back to the CPU when its GPU check times out (seen on the first
        // start of a new install). One restart finds the GPU again.
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            if let Ok((_, log_start)) = &result {
                if gpu_fallback(&log_since(&self.config().log_file(), *log_start)) && self.current(generation) {
                    self.shutdown_child();
                    result = self.launch(generation);
                    message = "Ready (restarted once: the GPU check had timed out)".into();
                }
            }
        }
        let mut inner = self.inner.lock().unwrap();
        if inner.generation == generation {
            inner.status = match result {
                Ok((url, _)) => Status { state: State::Ready, message, url: Some(url) },
                Err(message) => {
                    if let Some(mut child) = inner.child.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    Status { state: State::Failed, message, url: None }
                }
            };
        }
        inner.status.clone()
    }

    fn current(&self, generation: u64) -> bool {
        self.inner.lock().unwrap().generation == generation
    }

    /// One app per data folder: a second one would share the models and the pid file.
    fn lock_instance(&self, cfg: &Config) -> Result<(), String> {
        let mut lock = self.instance_lock.lock().unwrap();
        if lock.is_some() {
            return Ok(());
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(cfg.lock_file())
            .map_err(|e| format!("Cannot open the lock file: {e}"))?;
        match file.try_lock() {
            Ok(()) => {
                *lock = Some(file);
                Ok(())
            }
            Err(TryLockError::WouldBlock) => Err("LIX Writer is already open. Close the other window first.".into()),
            Err(TryLockError::Error(e)) => Err(format!("Cannot lock the data folder: {e}")),
        }
    }

    /// Returns the URL and the log size at start.
    fn launch(&self, generation: u64) -> Result<(String, u64), String> {
        let cfg = self.config();
        fs::create_dir_all(cfg.models_dir()).map_err(|e| format!("Cannot create the data folder: {e}"))?;
        if let Some(dir) = cfg.log_file().parent() {
            let _ = fs::create_dir_all(dir);
        }
        self.lock_instance(&cfg)?;
        kill_stale(&cfg);
        if !cfg.bin.is_file() {
            return Err(format!("The writing engine is missing ({}). Reinstall the app.", cfg.bin.display()));
        }
        let port = free_port(FIRST_PORT).ok_or("No free port found for the writing engine (11535-11634 all taken).")?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(cfg.log_file())
            .map_err(|e| format!("Cannot open the log file: {e}"))?;
        let log_start = log.metadata().map(|m| m.len()).unwrap_or(0);
        let log_err = log.try_clone().map_err(|e| e.to_string())?;
        let child = Command::new(&cfg.bin)
            .arg("serve")
            .env("OLLAMA_HOST", format!("127.0.0.1:{port}"))
            .env("OLLAMA_MODELS", cfg.models_dir())
            .env("OLLAMA_MAX_LOADED_MODELS", "1")
            .env("OLLAMA_NUM_PARALLEL", "1")
            .env("OLLAMA_KEEP_ALIVE", &cfg.keep_alive)
            .env("OLLAMA_ORIGINS", ORIGINS)
            // Without this, Ollama opens a connection to its cloud service even when offline use is all we need.
            .env("OLLAMA_NO_CLOUD", "1")
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(log_err)
            .spawn()
            .map_err(|e| format!("The writing engine does not start: {e}"))?;
        {
            let mut inner = self.inner.lock().unwrap();
            // A stop or a newer start came in meanwhile: this child must not live on.
            if inner.generation != generation {
                drop(inner);
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err("Superseded by a newer start or a stop".into());
            }
            let _ = fs::write(cfg.pid_file(), format!("{}\n", child.id()));
            inner.child = Some(child);
            inner.port = Some(port);
            inner.log_start = log_start;
        }

        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            if let Ok((200, _)) = http(port, "GET", "/api/version", None, Duration::from_millis(500)) {
                return Ok((format!("http://127.0.0.1:{port}"), log_start));
            }
            {
                let mut inner = self.inner.lock().unwrap();
                if inner.generation != generation {
                    return Err("Superseded by a newer start or a stop".into());
                }
                if let Some(child) = inner.child.as_mut() {
                    if let Ok(Some(code)) = child.try_wait() {
                        return Err(format!("The writing engine stopped at start ({code}).{}", log_tail(&cfg.log_file(), log_start)));
                    }
                }
            }
            if Instant::now() > deadline {
                return Err(format!("The writing engine did not answer within 15 s.{}", log_tail(&cfg.log_file(), log_start)));
            }
            thread::sleep(Duration::from_millis(200));
        }
    }

    /// Unloads all models and stops Ollama. Start threads still running give up.
    pub fn stop(&self) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.generation += 1;
            inner.status = Status { state: State::Failed, message: "The writing engine is stopped.".into(), url: None };
        }
        self.shutdown_child();
    }

    /// Stops our child and its runners (llama-server), removes the pid file.
    fn shutdown_child(&self) {
        let (child, port) = {
            let mut inner = self.inner.lock().unwrap();
            (inner.child.take(), inner.port.take())
        };
        let cfg = self.config();
        if let Some(port) = port {
            unload_all(port);
        }
        if let Some(mut child) = child {
            let runners = descendants(&process_table(), child.id());
            terminate(&mut child);
            for pid in runners {
                if process_command(pid).is_some() {
                    kill_pid(pid);
                }
            }
            // Only the owner of the child wrote the pid file. A refused second instance must keep it.
            let _ = fs::remove_file(cfg.pid_file());
        }
    }
}

/// Free bytes on the volume that holds `path` (from `/bin/df -kP`).
pub fn free_disk_bytes(path: &Path) -> Result<u64, String> {
    let out = Command::new("/bin/df").arg("-kP").arg(path).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    parse_df(&String::from_utf8_lossy(&out.stdout)).ok_or_else(|| "Cannot read df output".into())
}

fn parse_df(text: &str) -> Option<u64> {
    let line = text.lines().nth(1)?;
    let avail: u64 = line.split_whitespace().nth(3)?.parse().ok()?;
    Some(avail * 1024)
}

/// First port from `start` upward that nobody listens on.
pub fn free_port(start: u16) -> Option<u16> {
    (start..start.saturating_add(PORT_TRIES)).find(|&p| port_free(p))
}

fn port_free(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    // A bind can succeed next to a wildcard listener, so also try to connect.
    if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
        return false;
    }
    TcpListener::bind(addr).is_ok()
}

/// Minimal HTTP/1.1 request to 127.0.0.1. Returns status code and body.
pub fn http(port: u16, method: &str, path: &str, body: Option<&str>, timeout: Duration) -> std::io::Result<(u16, String)> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let body = body.unwrap_or("");
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    let _ = stream.shutdown(Shutdown::Both);
    let text = String::from_utf8_lossy(&raw);
    let code = text
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .ok_or_else(|| std::io::Error::other("bad HTTP response"))?;
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    Ok((code, body))
}

/// Asks Ollama to free the memory of every loaded model now.
fn unload_all(port: u16) {
    let Ok((200, body)) = http(port, "GET", "/api/ps", None, Duration::from_secs(2)) else { return };
    let Ok(ps) = serde_json::from_str::<serde_json::Value>(&body) else { return };
    let models = ps["models"].as_array().cloned().unwrap_or_default();
    for m in models {
        if let Some(name) = m["name"].as_str() {
            let req = serde_json::json!({ "model": name, "keep_alive": 0 }).to_string();
            let _ = http(port, "POST", "/api/generate", Some(&req), Duration::from_secs(10));
        }
    }
}

/// SIGTERM first so Ollama stops its runners, SIGKILL after 5 s.
fn terminate(child: &mut Child) {
    let _ = Command::new("/bin/kill").arg("-TERM").arg(child.id().to_string()).status();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// On start: a crash can leave our Ollama running. Kill it only if the pid
/// file points at a process that runs our bundled binary.
fn kill_stale(cfg: &Config) {
    if let Ok(text) = fs::read_to_string(cfg.pid_file()) {
        if let Ok(pid) = text.trim().parse::<u32>() {
            if process_command(pid).is_some_and(|cmd| cmd.starts_with(&*cfg.bin.to_string_lossy())) {
                kill_pid(pid);
            }
        }
        let _ = fs::remove_file(cfg.pid_file());
    }
    // Leftovers of a crash: processes from our binary folder whose parent is gone (ppid 1).
    // A running app instance keeps its engine as a child, so this never hits a live one.
    // Two rounds: runners become orphans once their orphaned server is stopped.
    let Some(dir) = cfg.bin.parent() else { return };
    let prefix = format!("{}/", dir.to_string_lossy());
    for _ in 0..2 {
        for pid in orphans(&process_table(), &prefix) {
            kill_pid(pid);
        }
    }
}

struct Proc {
    pid: u32,
    ppid: u32,
    command: String,
}

fn process_table() -> Vec<Proc> {
    let Ok(out) = Command::new("/bin/ps").args(["-axo", "pid=,ppid=,command="]).output() else { return Vec::new() };
    parse_ps(&String::from_utf8_lossy(&out.stdout))
}

fn parse_ps(text: &str) -> Vec<Proc> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?.parse().ok()?;
            let ppid = parts.next()?.parse().ok()?;
            let command = parts.collect::<Vec<_>>().join(" ");
            Some(Proc { pid, ppid, command })
        })
        .collect()
}

/// All children, grandchildren, ... of `root`.
fn descendants(procs: &[Proc], root: u32) -> Vec<u32> {
    let mut found = vec![root];
    let mut i = 0;
    while i < found.len() {
        let parent = found[i];
        found.extend(procs.iter().filter(|p| p.ppid == parent && !found.contains(&p.pid)).map(|p| p.pid).collect::<Vec<_>>());
        i += 1;
    }
    found.remove(0);
    found
}

/// Processes adopted by launchd whose executable lies under `prefix`.
fn orphans(procs: &[Proc], prefix: &str) -> Vec<u32> {
    procs.iter().filter(|p| p.ppid == 1 && p.command.starts_with(prefix)).map(|p| p.pid).collect()
}

/// The Ollama log since byte `from`.
fn log_since(path: &Path, from: u64) -> String {
    let Ok(bytes) = fs::read(path) else { return String::new() };
    String::from_utf8_lossy(bytes.get(from as usize..).unwrap_or_default()).into_owned()
}

/// True when Ollama reports only CPU compute, e.g. after its GPU check timed out.
fn gpu_fallback(log: &str) -> bool {
    let compute: Vec<&str> = log.lines().filter(|l| l.contains("msg=\"inference compute\"")).collect();
    !compute.is_empty() && compute.iter().all(|l| l.contains("library=cpu"))
}

/// Bytes the files under `dir` take on disk (allocated blocks, so sparse parts do not count).
pub fn allocated_bytes(dir: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => allocated_bytes(&e.path()),
            Ok(m) => m.blocks() * 512,
            Err(_) => 0,
        })
        .sum()
}

fn process_command(pid: u32) -> Option<String> {
    let out = Command::new("/bin/ps").args(["-p", &pid.to_string(), "-o", "command="]).output().ok()?;
    let cmd = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!cmd.is_empty()).then_some(cmd)
}

fn kill_pid(pid: u32) {
    let id = pid.to_string();
    let _ = Command::new("/bin/kill").args(["-TERM", &id]).stderr(Stdio::null()).status();
    for _ in 0..30 {
        if process_command(pid).is_none() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = Command::new("/bin/kill").args(["-KILL", &id]).stderr(Stdio::null()).status();
}

/// Last lines the Ollama log got since byte `from`, for error messages.
fn log_tail(path: &Path, from: u64) -> String {
    let Ok(bytes) = fs::read(path) else { return String::new() };
    let text = String::from_utf8_lossy(bytes.get(from as usize..).unwrap_or_default());
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tail = lines[lines.len().saturating_sub(3)..].join(" | ");
    if tail.is_empty() {
        return tail;
    }
    let start = tail.char_indices().rev().nth(399).map_or(0, |(i, _)| i);
    format!(" Log: {}", &tail[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn df_parses_available_kib() {
        let out = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 971350180 500000000 400000000 56% /System/Volumes/Data\n";
        assert_eq!(parse_df(out), Some(400_000_000 * 1024));
        assert_eq!(parse_df("header only\n"), None);
    }

    #[test]
    fn free_disk_on_root_is_positive() {
        assert!(free_disk_bytes(Path::new("/")).unwrap() > 0);
    }

    #[test]
    fn taken_port_is_skipped() {
        let first = free_port(FIRST_PORT + 50).unwrap();
        let _hold = TcpListener::bind(("127.0.0.1", first)).unwrap();
        let next = free_port(first).unwrap();
        assert!(next > first);
    }

    #[test]
    fn missing_binary_fails_with_message() {
        let dir = std::env::temp_dir().join(format!("lix-backend-test-{}", std::process::id()));
        let backend = Backend::new(Config {
            bin: dir.join("no-such-ollama"),
            app_data: dir.clone(),
            keep_alive: "5m".into(),
        });
        let status = backend.start();
        assert_eq!(status.state, State::Failed);
        assert!(status.message.contains("missing"), "{}", status.message);
        assert!(backend.url().is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_binary_fails_with_message() {
        let dir = std::env::temp_dir().join(format!("lix-backend-corrupt-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("ollama");
        fs::write(&bin, b"\xcf\xfa\xed\xfe garbage").unwrap();
        let _ = Command::new("/bin/chmod").arg("+x").arg(&bin).status();
        let backend = Backend::new(Config { bin, app_data: dir.clone(), keep_alive: "5m".into() });
        let status = backend.start();
        assert_eq!(status.state, State::Failed);
        // Spawn fails, or the shell fallback exits at once: both must end as failed.
        assert!(status.message.contains("does not start") || status.message.contains("stopped at start"), "{}", status.message);
        let _ = fs::remove_dir_all(dir);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lix-backend-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn script(dir: &Path, body: &str) -> PathBuf {
        let bin = dir.join("ollama");
        fs::write(&bin, format!("#!/bin/sh\n{body}\n")).unwrap();
        let _ = Command::new("/bin/chmod").arg("+x").arg(&bin).status();
        bin
    }

    #[test]
    fn ready_engine_that_dies_becomes_failed() {
        let dir = temp_dir("dies");
        let backend = Backend::new(Config { bin: dir.join("x"), app_data: dir.clone(), keep_alive: "5m".into() });
        {
            let mut inner = backend.inner.lock().unwrap();
            inner.child = Some(Command::new("/usr/bin/true").spawn().unwrap());
            inner.port = Some(1);
            inner.status = Status { state: State::Ready, message: "Ready".into(), url: Some("http://127.0.0.1:1".into()) };
        }
        thread::sleep(Duration::from_millis(300));
        let status = backend.status();
        assert_eq!(status.state, State::Failed);
        assert!(status.message.contains("stopped"), "{}", status.message);
        assert!(backend.url().is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn restart_reports_starting_before_it_returns() {
        let dir = temp_dir("restart");
        let backend = Backend::new(Config { bin: dir.join("missing"), app_data: dir.clone(), keep_alive: "5m".into() });
        backend.inner.lock().unwrap().status = Status { state: State::Failed, message: "old".into(), url: None };
        backend.start_async();
        // Never the old failure: either starting, or the new failure of this start.
        let status = backend.status();
        assert!(status.state == State::Starting || status.message.contains("missing"), "{status:?}");
        thread::sleep(Duration::from_millis(500));
        assert!(backend.status().message.contains("missing"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn stop_makes_a_pending_launch_give_up() {
        let dir = temp_dir("pending");
        let bin = script(&dir, "sleep 30");
        let backend = Backend::new(Config { bin: bin.clone(), app_data: dir.clone(), keep_alive: "5m".into() });
        let generation = backend.begin_start();
        backend.stop();
        let result = backend.launch(generation);
        assert!(result.unwrap_err().contains("Superseded"));
        assert!(backend.inner.lock().unwrap().child.is_none());
        let left = Command::new("/usr/bin/pgrep").arg("-f").arg(bin.to_string_lossy().as_ref()).output().unwrap();
        assert!(left.stdout.is_empty(), "child left: {}", String::from_utf8_lossy(&left.stdout));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn second_instance_on_same_data_folder_is_refused() {
        let dir = temp_dir("lock");
        let first = Backend::new(Config { bin: dir.join("missing"), app_data: dir.clone(), keep_alive: "5m".into() });
        first.lock_instance(&first.config()).unwrap();
        let second = Backend::new(Config { bin: dir.join("missing"), app_data: dir.clone(), keep_alive: "5m".into() });
        let status = second.start();
        assert_eq!(status.state, State::Failed);
        assert!(status.message.contains("already open"), "{}", status.message);
        fs::write(dir.join("ollama.pid"), "1\n").unwrap();
        second.stop();
        assert!(dir.join("ollama.pid").exists(), "a refused instance removed the pid file of the running one");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_targets_only_own_children_and_orphans() {
        let ps = "  1     0 /sbin/launchd\n\
                  100     1 /App/Resources/ollama/ollama serve\n\
                  101   100 /App/Resources/ollama/llama-server --port 5\n\
                  200   900 /App/Resources/ollama/ollama serve\n\
                  201   200 /App/Resources/ollama/llama-server --port 6\n\
                  300     1 /opt/homebrew/opt/ollama/bin/ollama serve\n\
                  102   101 /App/Resources/ollama/helper\n";
        let procs = parse_ps(ps);
        assert_eq!(procs.len(), 7);
        let mut kids = descendants(&procs, 100);
        kids.sort();
        assert_eq!(kids, vec![101, 102]);
        // 200 belongs to a live app (pid 900): not an orphan. Brew Ollama is outside the prefix.
        assert_eq!(orphans(&procs, "/App/Resources/ollama/"), vec![100]);
    }

    #[test]
    fn gpu_fallback_reads_the_compute_lines() {
        let cpu = "time=1 level=WARN source=runner.go:584 msg=\"llama-server GPU discovery watchdog timed out\"\n\
                   time=2 level=INFO source=types.go:50 msg=\"inference compute\" id=cpu library=cpu compute=\"\" name=cpu";
        let metal = "time=3 level=INFO source=types.go:32 msg=\"inference compute\" id=0 filter_id=0 library=Metal compute=0.0 name=MTL0";
        assert!(gpu_fallback(cpu));
        assert!(!gpu_fallback(metal));
        assert!(!gpu_fallback(&format!("{metal}\n{cpu}")));
        assert!(!gpu_fallback("no compute line yet"));
    }

    #[test]
    fn allocated_bytes_counts_written_data_only() {
        let dir = temp_dir("alloc");
        fs::create_dir_all(dir.join("blobs")).unwrap();
        fs::write(dir.join("blobs/a"), vec![1u8; 1_000_000]).unwrap();
        // A sparse file: 100 MB long, almost nothing written.
        let sparse = File::create(dir.join("blobs/b-partial")).unwrap();
        sparse.set_len(100_000_000).unwrap();
        let bytes = allocated_bytes(&dir);
        assert!((1_000_000..10_000_000).contains(&bytes), "{bytes}");
        let _ = fs::remove_dir_all(dir);
    }
}
