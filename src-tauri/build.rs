fn main() {
    // The bundled Ollama comes from `npm run fetch-ollama`. An empty folder keeps
    // `cargo check` working before that; the app then reports the engine as missing.
    let _ = std::fs::create_dir_all("resources/ollama");
    tauri_build::build()
}
