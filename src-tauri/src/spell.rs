// German spell check with the macOS NSSpellChecker (same as tools/spellcheck.swift).

/// Returns the words that the German spell checker does not know.
/// Call it on the main thread.
#[cfg(target_os = "macos")]
pub fn unknown_words(words: &[String]) -> Vec<String> {
    use objc2_app_kit::NSSpellChecker;
    use objc2_foundation::NSString;

    let checker = NSSpellChecker::sharedSpellChecker();
    let lang = NSString::from_str("de");
    words
        .iter()
        .filter(|w| {
            let word = w.trim();
            if word.is_empty() {
                return false;
            }
            let s = NSString::from_str(word);
            // SAFETY: a null word count pointer is allowed.
            let range = unsafe {
                checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(
                    &s,
                    0,
                    Some(&lang),
                    false,
                    0,
                    std::ptr::null_mut(),
                )
            };
            range.length > 0
        })
        .cloned()
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn unknown_words(_words: &[String]) -> Vec<String> {
    Vec::new()
}

/// Tauri command. Runs the check on the main thread and waits for the answer.
#[tauri::command]
pub async fn spell_unknown<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    words: Vec<String>,
) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(unknown_words(&words));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}
