pub mod backend;
pub mod settings;
mod spell;

pub use spell::unknown_words;

#[cfg(debug_assertions)]
mod debug;

use backend::{Backend, Config, Status};
use serde_json::{Map, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, RunEvent};

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
fn settings_set(backend: tauri::State<Backend>, patch: Map<String, Value>) -> Result<Map<String, Value>, String> {
    let all = settings::merge(&backend.config().app_data, patch)?;
    backend.set_keep_alive(settings::keep_alive(&backend.config().app_data));
    Ok(all)
}

fn app_data_dir(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("LIX_APP_DATA") {
        return PathBuf::from(dir);
    }
    app.path().app_data_dir().expect("no app data dir")
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
        let backend = Backend::new(Config {
            bin: ollama_bin(handle),
            keep_alive: settings::keep_alive(&app_data),
            app_data,
        });
        backend.start_async();
        app.manage(backend);
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
        debug::debug_autotest,
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
        settings_set
    ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while running LIX Writer")
        .run(|app, event| {
            // Free the model memory and stop Ollama before the app goes away.
            if let RunEvent::Exit = event {
                if let Some(backend) = app.try_state::<Backend>() {
                    backend.stop();
                }
            }
        });
}
