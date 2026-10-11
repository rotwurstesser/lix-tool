// Debug builds only: hooks for the automated `tauri dev` check.

/// Topic for an automatic test generation, from the env var LIX_AUTOTEST.
#[tauri::command]
pub fn debug_autotest() -> Option<String> {
    std::env::var("LIX_AUTOTEST").ok().filter(|s| !s.is_empty())
}

/// Prints a line from the UI to stdout.
#[tauri::command]
pub fn debug_log(line: String) {
    println!("[lix-ui] {line}");
}
