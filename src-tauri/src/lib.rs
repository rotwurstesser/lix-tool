mod spell;

pub use spell::unknown_words;

#[cfg(debug_assertions)]
mod debug;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        spell::spell_unknown,
        debug::debug_autotest,
        debug::debug_log
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![spell::spell_unknown]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running LIX Writer");
}
