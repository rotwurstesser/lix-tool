// Debug builds only: hooks for the automated `tauri dev` check.

/// Topic for an automatic test generation, from the env var LIX_AUTOTEST.
#[tauri::command]
pub fn debug_autotest() -> Option<String> {
    std::env::var("LIX_AUTOTEST").ok().filter(|s| !s.is_empty())
}

/// Fixed screen for screenshots, from the env var LIX_SCREEN (see lib/debug-screens.ts).
#[tauri::command]
pub fn debug_screen() -> Option<String> {
    std::env::var("LIX_SCREEN").ok().filter(|s| !s.is_empty())
}

/// Prints a line from the UI to stdout.
#[tauri::command]
pub fn debug_log(line: String) {
    println!("[lix-ui] {line}");
}
