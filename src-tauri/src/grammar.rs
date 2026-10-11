// Optional grammar checker: downloads LanguageTool and a Java runtime into app data,
// checks their sha256, and runs the LanguageTool server only while checks come in.

use crate::backend::{self, free_port, kill_pid, log_tail, orphans, process_command, process_table, terminate};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const FIRST_PORT: u16 = 8181;
const READY_TIMEOUT: Duration = Duration::from_secs(60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);
// A generation checks many times within a minute. A JVM start costs seconds, so the
// server stays up at least this long, also with "unload immediately".
const MIN_IDLE: Duration = Duration::from_secs(30);
const WATCH_EVERY: Duration = Duration::from_secs(2);
// Downloads plus the unpacked files (about 560 MB) plus headroom.
const NEED_DISK_BYTES: u64 = 1_200_000_000;
const MANIFEST: &str = include_str!("../resources/grammar-manifest.json");
// A download that sends no byte for this long fails. The blocking reqwest timeout applies to each read.
#[cfg(not(test))]
const DOWNLOAD_STALL: Duration = Duration::from_secs(30);
#[cfg(test)]
const DOWNLOAD_STALL: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Artifact {
    pub version: String,
    pub url: String,
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
    /// Path inside the unpacked archive: the LanguageTool folder, or the Java home.
    pub root: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Manifest {
    pub languagetool: Artifact,
    pub jre: Artifact,
}

impl Manifest {
    pub fn bundled() -> Manifest {
        serde_json::from_str(MANIFEST).expect("grammar-manifest.json is invalid")
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub app_data: PathBuf,
    pub manifest: Manifest,
    /// Folder with already downloaded archives (dev and test runs). The sha256 check still runs.
    pub cache_dir: Option<PathBuf>,
    /// Idle time before the server stops.
    pub idle: Duration,
}

impl Config {
    pub fn dir(&self) -> PathBuf {
        self.app_data.join("grammar")
    }
    fn downloads(&self) -> PathBuf {
        self.dir().join("downloads")
    }
    fn lt_dir(&self) -> PathBuf {
        self.dir().join("languagetool")
    }
    fn jre_dir(&self) -> PathBuf {
        self.dir().join("jre")
    }
    fn marker(&self) -> PathBuf {
        self.dir().join("installed.json")
    }
    pub fn pid_file(&self) -> PathBuf {
        self.dir().join("languagetool.pid")
    }
    pub fn log_file(&self) -> PathBuf {
        self.app_data.join("logs").join("languagetool.log")
    }
    pub fn java(&self) -> PathBuf {
        self.jre_dir().join(&self.manifest.jre.root).join("bin/java")
    }
    fn lt_root(&self) -> PathBuf {
        self.lt_dir().join(&self.manifest.languagetool.root)
    }

    /// Installed means: marker of this manifest, Java and the server jar in place.
    pub fn installed(&self) -> bool {
        let marker = fs::read_to_string(self.marker()).ok().and_then(|t| serde_json::from_str::<Manifest>(&t).ok());
        marker.as_ref() == Some(&self.manifest) && self.java().is_file() && self.lt_root().join("languagetool-server.jar").is_file()
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Install {
    Missing,
    Installing,
    Installed,
    Failed,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// "download", "verify" or "unpack".
    pub step: String,
    /// "Java runtime" or "LanguageTool".
    pub item: String,
    pub done: u64,
    pub total: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub install: Install,
    pub message: String,
    pub progress: Option<Progress>,
    /// Sum of both downloads, for the setup text.
    pub download_bytes: u64,
    pub running: bool,
    pub port: Option<u16>,
}

type Listener = Box<dyn Fn(Status) + Send + Sync>;

struct Inner {
    install: Install,
    message: String,
    progress: Option<Progress>,
    child: Option<Child>,
    port: Option<u16>,
    last_used: Instant,
    /// Checks in progress: the idle stop waits for them.
    in_flight: u32,
}

#[derive(Clone)]
pub struct Grammar {
    config: Arc<Mutex<Config>>,
    inner: Arc<Mutex<Inner>>,
    cancel: Arc<AtomicBool>,
    /// Only one start at a time; checks that come in meanwhile wait for it.
    start_lock: Arc<Mutex<()>>,
    watching: Arc<AtomicBool>,
    listener: Arc<Mutex<Option<Listener>>>,
}

/// Idle time from the keep-alive setting ("5m", "30s", "1h", "0", "-1" = never).
pub fn idle_from_keep_alive(value: &str) -> Duration {
    let v = value.trim();
    let (num, unit) = match v.char_indices().last() {
        Some((i, c)) if c.is_ascii_alphabetic() => (&v[..i], c),
        _ => (v, 's'),
    };
    let Ok(n) = num.parse::<f64>() else { return Duration::from_secs(300) };
    if n < 0.0 {
        return Duration::MAX;
    }
    let secs = match unit {
        'h' => n * 3600.0,
        'm' => n * 60.0,
        _ => n,
    };
    Duration::from_secs_f64(secs).max(MIN_IDLE)
}

impl Grammar {
    pub fn new(config: Config) -> Self {
        let install = if config.installed() { Install::Installed } else { Install::Missing };
        Grammar {
            config: Arc::new(Mutex::new(config)),
            inner: Arc::new(Mutex::new(Inner {
                install,
                message: String::new(),
                progress: None,
                child: None,
                port: None,
                last_used: Instant::now(),
                in_flight: 0,
            })),
            cancel: Arc::new(AtomicBool::new(false)),
            start_lock: Arc::new(Mutex::new(())),
            watching: Arc::new(AtomicBool::new(false)),
            listener: Arc::new(Mutex::new(None)),
        }
    }

    pub fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    pub fn set_idle(&self, idle: Duration) {
        self.config.lock().unwrap().idle = idle;
    }

    /// Called on every install status change (the app sends it to the UI as an event).
    pub fn on_change(&self, listener: impl Fn(Status) + Send + Sync + 'static) {
        *self.listener.lock().unwrap() = Some(Box::new(listener));
    }

    pub fn status(&self) -> Status {
        let cfg = self.config();
        let mut inner = self.inner.lock().unwrap();
        if let Some(child) = inner.child.as_mut() {
            if let Ok(Some(_)) = child.try_wait() {
                inner.child = None;
                inner.port = None;
            }
        }
        Status {
            install: inner.install.clone(),
            message: inner.message.clone(),
            progress: inner.progress.clone(),
            download_bytes: cfg.manifest.languagetool.bytes + cfg.manifest.jre.bytes,
            running: inner.child.is_some(),
            port: inner.port,
        }
    }

    pub fn disk_bytes(&self) -> u64 {
        backend::allocated_bytes(&self.config().dir())
    }

    fn set_install(&self, install: Install, message: &str, progress: Option<Progress>) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.install = install;
            inner.message = message.to_string();
            inner.progress = progress;
        }
        self.notify();
    }

    fn notify(&self) {
        let status = self.status();
        if let Some(listener) = self.listener.lock().unwrap().as_ref() {
            listener(status);
        }
    }

    /// Starts the install on a background thread. Returns false when one already runs.
    pub fn install_async(&self) -> bool {
        if !self.begin_install() {
            return false;
        }
        let me = self.clone();
        thread::spawn(move || me.run_install());
        true
    }

    /// Downloads, checks and unpacks both parts. Blocks until done. Returns the final status.
    pub fn install(&self) -> Status {
        if self.begin_install() {
            self.run_install();
        }
        self.status()
    }

    fn begin_install(&self) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if inner.install == Install::Installing {
            return false;
        }
        inner.install = Install::Installing;
        inner.message = "Preparing the download".into();
        inner.progress = None;
        self.cancel.store(false, Ordering::SeqCst);
        true
    }

    fn run_install(&self) {
        self.notify();
        let cfg = self.config();
        match self.install_steps(&cfg) {
            Ok(()) => self.set_install(Install::Installed, "LanguageTool is installed.", None),
            Err(message) => {
                // Never leave half an install or an unchecked archive behind.
                let _ = fs::remove_dir_all(cfg.dir());
                if self.cancel.load(Ordering::SeqCst) {
                    self.set_install(Install::Missing, "Download cancelled.", None);
                } else {
                    self.set_install(Install::Failed, &message, None);
                }
            }
        }
    }

    fn install_steps(&self, cfg: &Config) -> Result<(), String> {
        if let Ok(free) = backend::free_disk_bytes(&cfg.app_data) {
            if free < NEED_DISK_BYTES {
                return Err(format!(
                    "Not enough disk space. The grammar checker needs {:.1} GB free, this Mac has {:.1} GB.",
                    NEED_DISK_BYTES as f64 / 1e9,
                    free as f64 / 1e9
                ));
            }
        }
        let _ = fs::remove_dir_all(cfg.dir());
        fs::create_dir_all(cfg.downloads()).map_err(|e| format!("Cannot create the grammar folder: {e}"))?;
        let jre = self.fetch(cfg, &cfg.manifest.jre, "Java runtime")?;
        let lt = self.fetch(cfg, &cfg.manifest.languagetool, "LanguageTool")?;

        self.progress("unpack", "Java runtime", 0, 1);
        unpack_tar_gz(&jre, &cfg.jre_dir())?;
        self.check_cancel()?;
        self.progress("unpack", "LanguageTool", 0, 1);
        unpack_zip(&lt, &cfg.lt_dir())?;
        self.check_cancel()?;
        let _ = fs::remove_dir_all(cfg.downloads());
        if !cfg.java().is_file() || !cfg.lt_root().join("languagetool-server.jar").is_file() {
            return Err("The downloaded files do not have the expected layout.".into());
        }
        let marker = serde_json::to_string_pretty(&cfg.manifest).map_err(|e| e.to_string())?;
        self.check_cancel()?;
        fs::write(cfg.marker(), marker).map_err(|e| format!("Cannot write the install marker: {e}"))?;
        Ok(())
    }

    fn check_cancel(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            Err("Download cancelled.".into())
        } else {
            Ok(())
        }
    }

    fn progress(&self, step: &str, item: &str, done: u64, total: u64) {
        let message = match step {
            "download" => format!("Downloading {item}"),
            "verify" => format!("Checking {item}"),
            _ => format!("Unpacking {item}"),
        };
        self.set_install(
            Install::Installing,
            &message,
            Some(Progress { step: step.into(), item: item.into(), done, total }),
        );
    }

    /// Gets one archive (cache copy or download), hashes it on the way, compares the sha256.
    fn fetch(&self, cfg: &Config, art: &Artifact, item: &str) -> Result<PathBuf, String> {
        let dest = cfg.downloads().join(&art.file);
        let part = cfg.downloads().join(format!("{}.part", art.file));
        let mut out = File::create(&part).map_err(|e| format!("Cannot write {}: {e}", part.display()))?;
        let mut hash = Sha256::new();
        let cached = cfg.cache_dir.as_ref().map(|d| d.join(&art.file)).filter(|p| p.is_file());
        let (mut reader, total): (Box<dyn Read>, u64) = match cached {
            Some(path) => {
                let file = File::open(&path).map_err(|e| e.to_string())?;
                let len = file.metadata().map(|m| m.len()).unwrap_or(art.bytes);
                (Box::new(file), len)
            }
            None => {
                let client = reqwest::blocking::Client::builder()
                    .connect_timeout(Duration::from_secs(20))
                    .timeout(DOWNLOAD_STALL)
                    .build()
                    .map_err(|e| e.to_string())?;
                let resp = client
                    .get(&art.url)
                    .send()
                    .map_err(|e| format!("Cannot download {item}. Check the internet connection. ({e})"))?;
                if !resp.status().is_success() {
                    return Err(format!("Cannot download {item} (HTTP {}).", resp.status().as_u16()));
                }
                let len = resp.content_length().unwrap_or(art.bytes);
                (Box::new(resp), len)
            }
        };
        let mut buf = vec![0u8; 256 * 1024];
        let mut done = 0u64;
        let mut last = Instant::now();
        self.progress("download", item, 0, total);
        loop {
            self.check_cancel()?;
            let n = reader.read(&mut buf).map_err(|e| format!("The {item} download broke off. ({e})"))?;
            if n == 0 {
                break;
            }
            hash.update(&buf[..n]);
            out.write_all(&buf[..n]).map_err(|e| format!("Cannot write the download: {e}"))?;
            done += n as u64;
            if last.elapsed() >= Duration::from_millis(250) {
                last = Instant::now();
                self.progress("download", item, done, total);
            }
        }
        out.flush().map_err(|e| e.to_string())?;
        self.progress("verify", item, done, total);
        let got = hex(&hash.finalize());
        if !got.eq_ignore_ascii_case(&art.sha256) {
            return Err(format!(
                "The {item} download is damaged (sha256 mismatch). The files were removed. Try again. (expected {}, got {got})",
                art.sha256
            ));
        }
        fs::rename(&part, &dest).map_err(|e| e.to_string())?;
        Ok(dest)
    }

    pub fn cancel_install(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Stops the server and deletes every grammar file. A running install gives up.
    pub fn remove(&self) -> Result<(), String> {
        self.cancel_install();
        self.stop();
        // Wait for a running install to see the cancel flag and clean up.
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.inner.lock().unwrap().install == Install::Installing && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        let dir = self.config().dir();
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("Cannot delete {}: {e}", dir.display()))?;
        }
        self.set_install(Install::Missing, "LanguageTool was removed.", None);
        Ok(())
    }

    /// Starts the server when it does not run. Returns its port.
    pub fn ensure_running(&self) -> Result<u16, String> {
        let _start = self.start_lock.lock().unwrap();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.last_used = Instant::now();
            let port = inner.port;
            if let (Some(child), Some(port)) = (inner.child.as_mut(), port) {
                if matches!(child.try_wait(), Ok(None)) {
                    return Ok(port);
                }
                inner.child = None;
                inner.port = None;
            }
            if inner.install != Install::Installed {
                return Err("LanguageTool is not installed.".into());
            }
        }
        let port = self.launch()?;
        self.watch();
        Ok(port)
    }

    fn launch(&self) -> Result<u16, String> {
        let cfg = self.config();
        if let Some(dir) = cfg.log_file().parent() {
            let _ = fs::create_dir_all(dir);
        }
        kill_stale(&cfg);
        let port = free_port(FIRST_PORT).ok_or("No free port for LanguageTool (8181-8280 all taken).")?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(cfg.log_file())
            .map_err(|e| format!("Cannot open the log file: {e}"))?;
        let log_start = log.metadata().map(|m| m.len()).unwrap_or(0);
        let log_err = log.try_clone().map_err(|e| e.to_string())?;
        // The server binds to localhost only (no --public). The app calls it from Rust, so no CORS origin is needed.
        let child = Command::new(cfg.java())
            .args(["-Xmx512m", "-Djava.awt.headless=true", "-cp", "languagetool-server.jar", "org.languagetool.server.HTTPServer"])
            .args(["--port", &port.to_string()])
            .current_dir(cfg.lt_root())
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(log_err)
            .spawn()
            .map_err(|e| format!("LanguageTool does not start: {e}"))?;
        let _ = fs::write(cfg.pid_file(), format!("{}\n", child.id()));
        {
            let mut inner = self.inner.lock().unwrap();
            inner.child = Some(child);
            inner.port = Some(port);
        }
        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            if let Ok((200, _)) = backend::http(port, "GET", "/v2/languages", None, Duration::from_secs(2)) {
                return Ok(port);
            }
            let exited = {
                let mut inner = self.inner.lock().unwrap();
                match inner.child.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(Some(code))) => Some(code.to_string()),
                    None => Some("stopped".into()),
                    _ => None,
                }
            };
            if let Some(code) = exited {
                self.stop();
                return Err(format!("LanguageTool stopped at start ({code}).{}", log_tail(&cfg.log_file(), log_start)));
            }
            if Instant::now() > deadline {
                self.stop();
                return Err(format!("LanguageTool did not answer within 60 s.{}", log_tail(&cfg.log_file(), log_start)));
            }
            thread::sleep(Duration::from_millis(200));
        }
    }

    /// Checks `text` and returns the raw LanguageTool JSON. Starts the server if needed.
    pub fn check(&self, text: &str, language: &str, disabled_rules: &[String]) -> Result<String, String> {
        self.inner.lock().unwrap().in_flight += 1;
        let result = self.check_inner(text, language, disabled_rules);
        let mut inner = self.inner.lock().unwrap();
        inner.in_flight -= 1;
        inner.last_used = Instant::now();
        result
    }

    fn check_inner(&self, text: &str, language: &str, disabled_rules: &[String]) -> Result<String, String> {
        let port = self.ensure_running()?;
        let mut body = format!("language={}&text={}", form_encode(language), form_encode(text));
        if !disabled_rules.is_empty() {
            body.push_str(&format!("&disabledRules={}", form_encode(&disabled_rules.join(","))));
        }
        let (code, reply) = backend::request(port, "POST", "/v2/check", "application/x-www-form-urlencoded", Some(&body), CHECK_TIMEOUT)
            .map_err(|e| format!("LanguageTool check failed: {e}"))?;
        if code != 200 {
            return Err(format!("LanguageTool check failed ({code}): {}", reply.chars().take(200).collect::<String>()));
        }
        Ok(reply)
    }

    /// One watcher thread per app: stops the server after the idle time.
    fn watch(&self) {
        if self.watching.swap(true, Ordering::SeqCst) {
            return;
        }
        let me = self.clone();
        thread::spawn(move || loop {
            thread::sleep(WATCH_EVERY);
            if let Some(mut child) = me.take_idle() {
                terminate(&mut child);
            }
        });
    }

    /// Takes the server when it is idle. The check and the take use one lock, so a new check
    /// either sees no server (and starts one) or blocks the idle stop.
    fn take_idle(&self) -> Option<Child> {
        let cfg = self.config();
        let mut inner = self.inner.lock().unwrap();
        if inner.child.is_none() || inner.in_flight > 0 || inner.last_used.elapsed() < cfg.idle {
            return None;
        }
        take_child(&mut inner, &cfg)
    }

    /// Stops the server (SIGTERM, SIGKILL after 5 s) and removes the pid file.
    pub fn stop(&self) {
        let cfg = self.config();
        let child = take_child(&mut self.inner.lock().unwrap(), &cfg);
        if let Some(mut child) = child {
            terminate(&mut child);
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.inner.lock().unwrap().child.as_ref().map(|c| c.id())
    }
}

/// Removes the pid file under the caller's lock, so a server that starts next keeps its own pid file.
fn take_child(inner: &mut Inner, cfg: &Config) -> Option<Child> {
    inner.port = None;
    let child = inner.child.take();
    if child.is_some() {
        let _ = fs::remove_file(cfg.pid_file());
    }
    child
}

/// After a crash: kill our old server (pid file, or an orphan that runs our Java).
fn kill_stale(cfg: &Config) {
    let java = cfg.java().to_string_lossy().into_owned();
    if let Ok(text) = fs::read_to_string(cfg.pid_file()) {
        if let Ok(pid) = text.trim().parse::<u32>() {
            if process_command(pid).is_some_and(|cmd| cmd.starts_with(&java)) {
                kill_pid(pid);
            }
        }
        let _ = fs::remove_file(cfg.pid_file());
    }
    for pid in orphans(&process_table(), &java) {
        kill_pid(pid);
    }
}

/// Unpacks into a fresh `<dest>.tmp`, then renames it to `dest`.
fn unpack_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let tmp = fresh_tmp(dest)?;
    // macOS tar refuses ".." members and strips leading "/" by default.
    let out = Command::new("/usr/bin/tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(&tmp)
        .output()
        .map_err(|e| format!("Cannot run tar: {e}"))?;
    if !out.status.success() {
        let _ = fs::remove_dir_all(&tmp);
        return Err(format!("Cannot unpack the Java runtime: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

fn unpack_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let tmp = fresh_tmp(dest)?;
    let file = File::open(archive).map_err(|e| e.to_string())?;
    // extract() keeps every path inside the target folder.
    let result = zip::ZipArchive::new(file).and_then(|mut z| z.extract(&tmp));
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&tmp);
        return Err(format!("Cannot unpack LanguageTool: {e}"));
    }
    fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

fn fresh_tmp(dest: &Path) -> Result<PathBuf, String> {
    let tmp = dest.with_extension("tmp");
    let _ = fs::remove_dir_all(&tmp);
    let _ = fs::remove_dir_all(dest);
    fs::create_dir_all(&tmp).map_err(|e| format!("Cannot create {}: {e}", tmp.display()))?;
    Ok(tmp)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// application/x-www-form-urlencoded value.
fn form_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'*' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lix-grammar-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    /// A tiny fake JRE (tar.gz) and LanguageTool (zip) in `cache`, with a manifest that matches them.
    fn fake_archives(cache: &Path) -> Manifest {
        let src = cache.join("src");
        fs::create_dir_all(src.join("jre-x/Contents/Home/bin")).unwrap();
        fs::write(src.join("jre-x/Contents/Home/bin/java"), "#!/bin/sh\n").unwrap();
        let status = Command::new("/usr/bin/tar")
            .arg("-czf")
            .arg(cache.join("jre.tar.gz"))
            .arg("-C")
            .arg(&src)
            .arg("jre-x")
            .status()
            .unwrap();
        assert!(status.success());
        let mut zip = zip::ZipWriter::new(File::create(cache.join("lt.zip")).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("LT-x/languagetool-server.jar", opts).unwrap();
        zip.write_all(b"jar").unwrap();
        zip.finish().unwrap();
        let art = |file: &str, root: &str| {
            let bytes = fs::read(cache.join(file)).unwrap();
            Artifact {
                version: "x".into(),
                url: "http://127.0.0.1:9/unused".into(),
                file: file.into(),
                bytes: bytes.len() as u64,
                sha256: sha(&bytes),
                root: root.into(),
            }
        };
        Manifest { languagetool: art("lt.zip", "LT-x"), jre: art("jre.tar.gz", "jre-x/Contents/Home") }
    }

    #[test]
    fn bundled_manifest_parses() {
        let m = Manifest::bundled();
        assert_eq!(m.languagetool.version, "6.6");
        assert_eq!(m.jre.sha256.len(), 64);
        assert_eq!(m.languagetool.sha256.len(), 64);
    }

    #[test]
    fn install_from_cache_verifies_and_unpacks() {
        let dir = temp_dir("ok");
        let cache = dir.join("cache");
        fs::create_dir_all(&cache).unwrap();
        let manifest = fake_archives(&cache);
        let app_data = dir.join("app");
        let cfg = Config { app_data: app_data.clone(), manifest, cache_dir: Some(cache), idle: MIN_IDLE };
        let g = Grammar::new(cfg.clone());
        assert_eq!(g.status().install, Install::Missing);
        let status = g.install();
        assert_eq!(status.install, Install::Installed, "{}", status.message);
        assert!(cfg.installed());
        assert!(!cfg.downloads().exists(), "archives must be deleted after unpacking");
        // A new app start sees the install.
        assert_eq!(Grammar::new(cfg.clone()).status().install, Install::Installed);
        g.remove().unwrap();
        assert!(!cfg.dir().exists());
        assert_eq!(g.status().install, Install::Missing);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sha_mismatch_fails_and_removes_files() {
        let dir = temp_dir("badsha");
        let cache = dir.join("cache");
        fs::create_dir_all(&cache).unwrap();
        let mut manifest = fake_archives(&cache);
        manifest.languagetool.sha256 = "0".repeat(64);
        let cfg = Config { app_data: dir.join("app"), manifest, cache_dir: Some(cache), idle: MIN_IDLE };
        let events = Arc::new(Mutex::new(Vec::new()));
        let g = Grammar::new(cfg.clone());
        let seen = events.clone();
        g.on_change(move |s| seen.lock().unwrap().push(s.install));
        let status = g.install();
        assert_eq!(status.install, Install::Failed);
        assert!(status.message.contains("sha256 mismatch"), "{}", status.message);
        assert!(!cfg.dir().exists(), "files left after a sha256 mismatch");
        assert!(!cfg.installed());
        let events = events.lock().unwrap();
        assert!(events.contains(&Install::Installing) && events.last() == Some(&Install::Failed), "{events:?}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cancel_during_unpack_ends_not_installed() {
        let dir = temp_dir("cancelunpack");
        let cache = dir.join("cache");
        fs::create_dir_all(&cache).unwrap();
        let manifest = fake_archives(&cache);
        let cfg = Config { app_data: dir.join("app"), manifest, cache_dir: Some(cache), idle: MIN_IDLE };
        let g = Grammar::new(cfg.clone());
        let me = g.clone();
        g.on_change(move |s| {
            if s.progress.as_ref().is_some_and(|p| p.step == "unpack" && p.item == "LanguageTool") {
                me.cancel_install();
            }
        });
        let status = g.install();
        assert_eq!(status.install, Install::Missing, "{}", status.message);
        assert!(!cfg.installed());
        assert!(!cfg.dir().exists(), "files left after a cancelled install");
        let _ = fs::remove_dir_all(dir);
    }

    /// Installs from a server that sends the headers and 10 bytes, then stalls with the socket open.
    fn stalled_install(name: &str, cancel: bool) -> Status {
        let dir = temp_dir(name);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/jre.tar.gz", listener.local_addr().unwrap());
        thread::spawn(move || {
            if let Ok((mut sock, _)) = listener.accept() {
                let mut req = [0u8; 1024];
                let _ = sock.read(&mut req);
                let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n0123456789");
                thread::sleep(Duration::from_secs(30));
            }
        });
        let mut manifest = Manifest::bundled();
        manifest.jre.url = url;
        let cfg = Config { app_data: dir.join("app"), manifest, cache_dir: None, idle: MIN_IDLE };
        let g = Grammar::new(cfg.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        let me = g.clone();
        thread::spawn(move || {
            let _ = tx.send(me.install());
        });
        if cancel {
            thread::sleep(Duration::from_millis(200));
            g.cancel_install();
        }
        let status = rx.recv_timeout(Duration::from_secs(10)).expect("a stalled download must not hang");
        assert!(!cfg.dir().exists(), "files left after a stalled download");
        let _ = fs::remove_dir_all(dir);
        status
    }

    #[test]
    fn stalled_download_fails() {
        let status = stalled_install("stall", false);
        assert_eq!(status.install, Install::Failed, "{}", status.message);
        assert!(status.message.contains("broke off"), "{}", status.message);
    }

    #[test]
    fn cancel_during_stalled_download_ends_not_installed() {
        assert_eq!(stalled_install("stallcancel", true).install, Install::Missing);
    }

    #[test]
    fn idle_take_respects_last_use_and_in_flight() {
        let dir = temp_dir("idle");
        let g = Grammar::new(Config {
            app_data: dir.clone(),
            manifest: Manifest::bundled(),
            cache_dir: None,
            idle: Duration::from_secs(3600),
        });
        g.inner.lock().unwrap().child = Some(Command::new("/bin/sleep").arg("30").spawn().unwrap());
        assert!(g.take_idle().is_none(), "recently used server was taken");
        g.set_idle(Duration::ZERO);
        g.inner.lock().unwrap().in_flight = 1;
        assert!(g.take_idle().is_none(), "server with a check in flight was taken");
        g.inner.lock().unwrap().in_flight = 0;
        let mut child = g.take_idle().expect("idle server was not taken");
        assert!(g.inner.lock().unwrap().child.is_none());
        terminate(&mut child);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn check_without_install_fails_fast() {
        let dir = temp_dir("noinstall");
        let g = Grammar::new(Config { app_data: dir.clone(), manifest: Manifest::bundled(), cache_dir: None, idle: MIN_IDLE });
        let err = g.check("Hallo.", "de-CH", &[]).unwrap_err();
        assert!(err.contains("not installed"), "{err}");
        assert_eq!(g.inner.lock().unwrap().in_flight, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn idle_follows_keep_alive_with_a_floor() {
        assert_eq!(idle_from_keep_alive("5m"), Duration::from_secs(300));
        assert_eq!(idle_from_keep_alive("15m"), Duration::from_secs(900));
        assert_eq!(idle_from_keep_alive("0"), MIN_IDLE);
        assert_eq!(idle_from_keep_alive("0s"), MIN_IDLE);
        assert_eq!(idle_from_keep_alive("1h"), Duration::from_secs(3600));
        assert_eq!(idle_from_keep_alive("-1"), Duration::MAX);
        assert_eq!(idle_from_keep_alive("junk"), Duration::from_secs(300));
    }

    #[test]
    fn form_encoding() {
        assert_eq!(form_encode("dem Hase & ß"), "dem+Hase+%26+%C3%9F");
    }
}
