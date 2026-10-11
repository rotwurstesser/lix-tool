pub mod backend;
pub mod grammar;
pub mod settings;
mod spell;

pub use spell::unknown_words;

#[cfg(debug_assertions)]
mod debug;

use backend::{Backend, Config, Status};
use grammar::Grammar;
use serde_json::{Map, Value};
use std::path::PathBuf;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, RunEvent, Theme, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
fn backend_status(backend: tauri::State<Backend>) -> Status {
    backend.status()
}

#[tauri::command]
fn backend_url(backend: tauri::State<Backend>) -> Option<String> {
    backend.url()
}

/// Restarts Ollama in the background; poll `backend_status`. The status is "starting" on return.
#[tauri::command]
fn backend_restart(backend: tauri::State<Backend>) -> Status {
    let cfg = backend.config();
    backend.set_keep_alive(settings::keep_alive(&cfg.app_data));
    backend.start_async();
    backend.status()
}

/// Bytes the models folder takes on disk, partial downloads included.
#[tauri::command]
fn models_disk_bytes(backend: tauri::State<Backend>) -> u64 {
    backend::allocated_bytes(&backend.config().models_dir())
}

/// Free bytes on the volume of `path`, default the models folder.
#[tauri::command]
fn free_disk_bytes(backend: tauri::State<Backend>, path: Option<String>) -> Result<u64, String> {
    let path = path.map(PathBuf::from).unwrap_or_else(|| backend.config().models_dir());
    backend::free_disk_bytes(&path)
}

#[tauri::command]
fn settings_get(backend: tauri::State<Backend>) -> Map<String, Value> {
    settings::load(&backend.config().app_data)
}

#[tauri::command]
fn settings_set(
    app: AppHandle,
    backend: tauri::State<Backend>,
    grammar: tauri::State<Grammar>,
    patch: Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    let theme_changed = patch.contains_key("theme");
    let all = settings::merge(&backend.config().app_data, patch)?;
    if theme_changed {
        let theme = settings::theme(&backend.config().app_data);
        for window in app.webview_windows().values() {
            apply_theme(window, theme);
        }
    }
    let keep_alive = settings::keep_alive(&backend.config().app_data);
    grammar.set_idle(grammar::idle_from_keep_alive(&keep_alive));
    backend.set_keep_alive(keep_alive);
    Ok(all)
}

#[tauri::command]
fn grammar_status(grammar: tauri::State<Grammar>) -> grammar::Status {
    grammar.status()
}

/// Starts the LanguageTool download in the background; progress comes as "grammar-status" events.
#[tauri::command]
fn grammar_install(grammar: tauri::State<Grammar>) -> grammar::Status {
    grammar.install_async();
    grammar.status()
}

#[tauri::command]
fn grammar_cancel(grammar: tauri::State<Grammar>) {
    grammar.cancel_install();
}

/// Stops LanguageTool and deletes its files.
#[tauri::command(async)]
fn grammar_remove(grammar: tauri::State<'_, Grammar>) -> Result<grammar::Status, String> {
    grammar.remove()?;
    Ok(grammar.status())
}

#[tauri::command(async)]
fn grammar_disk_bytes(grammar: tauri::State<'_, Grammar>) -> u64 {
    grammar.disk_bytes()
}

/// Starts LanguageTool if it does not run (the app warms it up while the model drafts). Returns the port.
#[tauri::command(async)]
fn grammar_ensure_running(grammar: tauri::State<'_, Grammar>) -> Result<u16, String> {
    grammar.ensure_running()
}

/// Checks a text with LanguageTool (started on demand) and returns its JSON reply.
#[tauri::command(async)]
fn grammar_check(grammar: tauri::State<'_, Grammar>, text: String, language: String, disabled_rules: Option<Vec<String>>) -> Result<Value, String> {
    let reply = grammar.check(&text, &language, &disabled_rules.unwrap_or_default())?;
    serde_json::from_str(&reply).map_err(|e| format!("LanguageTool sent invalid JSON: {e}"))
}

/// Opens the app data folder (models, LanguageTool, settings, logs) in Finder.
#[tauri::command(async)]
fn open_data_dir(backend: tauri::State<'_, Backend>) -> Result<(), String> {
    let dir = backend.config().app_data;
    let status = std::process::Command::new("/usr/bin/open").arg(&dir).status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Finder could not open {}", dir.display()))
    }
}

fn native_theme(theme: &str) -> Option<Theme> {
    match theme {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// Window background behind the page, same as the CSS --bg token.
fn background(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x11, 0x13, 0x17, 0xff),
        _ => Color(0xf6, 0xf7, 0xf9, 0xff),
    }
}

/// Native window appearance (title bar, prefers-color-scheme) and background follow the setting.
fn apply_theme(window: &WebviewWindow, theme: &str) {
    let _ = window.set_theme(native_theme(theme));
    if let Ok(effective) = window.theme() {
        let _ = window.set_background_color(Some(background(effective)));
    }
}

/// Builds the main window from tauri.conf.json ("create": false) with the stored theme, so the first
/// paint already has the right colours.
fn create_main_window(app: &AppHandle, app_data: &std::path::Path) -> tauri::Result<()> {
    let theme = settings::theme(app_data);
    let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().unwrap_or_default();
    let builder = WebviewWindowBuilder::from_config(app, &config)?
        .theme(native_theme(theme))
        .initialization_script(settings::theme_script(theme));
    // Debug builds: LIX_WINDOW_SIZE=800x600 for screenshots.
    #[cfg(debug_assertions)]
    let builder = match std::env::var("LIX_WINDOW_SIZE").ok().and_then(|v| {
        let (w, h) = v.split_once('x')?;
        Some((w.parse::<f64>().ok()?, h.parse::<f64>().ok()?))
    }) {
        Some((w, h)) => builder.inner_size(w, h),
        None => builder,
    };
    let window = builder.build()?;
    apply_theme(&window, theme);
    Ok(())
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("LIX_APP_DATA") {
        return PathBuf::from(dir);
    }
    app.path().app_data_dir().expect("no app data dir")
}

/// Debug builds: LIX_GRAMMAR_CACHE=<dir> takes the archives from there (sha256 still checked).
fn grammar_cache() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("LIX_GRAMMAR_CACHE") {
        return Some(PathBuf::from(dir));
    }
    None
}

/// The bundled Ollama binary. `tauri dev` uses src-tauri/resources/ollama.
fn ollama_bin(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Ok(bin) = std::env::var("LIX_OLLAMA_BIN") {
            return PathBuf::from(bin);
        }
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ollama/ollama");
        if dev.exists() {
            return dev;
        }
    }
    app.path().resource_dir().map(|d| d.join("ollama/ollama")).unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().setup(|app| {
        let handle = app.handle();
        let app_data = app_data_dir(handle);
        create_main_window(handle, &app_data)?;
        let backend = Backend::new(Config {
            bin: ollama_bin(handle),
            keep_alive: settings::keep_alive(&app_data),
            app_data,
        });
        backend.start_async();
        let grammar = Grammar::new(grammar::Config {
            app_data: backend.config().app_data,
            manifest: grammar::Manifest::bundled(),
            cache_dir: grammar_cache(),
            idle: grammar::idle_from_keep_alive(&backend.config().keep_alive),
        });
        let events = handle.clone();
        grammar.on_change(move |status| {
            let _ = events.emit("grammar-status", status);
        });
        app.manage(backend);
        app.manage(grammar);
        Ok(())
    });

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        spell::spell_unknown,
        backend_status,
        backend_url,
        backend_restart,
        free_disk_bytes,
        models_disk_bytes,
        settings_get,
        settings_set,
        grammar_status,
        grammar_install,
        grammar_cancel,
        grammar_remove,
        grammar_disk_bytes,
        grammar_ensure_running,
        grammar_check,
        open_data_dir,
        debug::debug_autotest,
        debug::debug_screen,
        debug::debug_log
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        spell::spell_unknown,
        backend_status,
        backend_url,
        backend_restart,
        free_disk_bytes,
        models_disk_bytes,
        settings_get,
        settings_set,
        grammar_status,
        grammar_install,
        grammar_cancel,
        grammar_remove,
        grammar_disk_bytes,
        grammar_ensure_running,
        grammar_check,
        open_data_dir
    ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while running LIX Writer")
        .run(|app, event| {
            // Free the model memory and stop Ollama and LanguageTool before the app goes away.
            if let RunEvent::Exit = event {
                if let Some(grammar) = app.try_state::<Grammar>() {
                    grammar.cancel_install();
                    grammar.stop();
                }
                if let Some(backend) = app.try_state::<Backend>() {
                    backend.stop();
                }
            }
        });
}
