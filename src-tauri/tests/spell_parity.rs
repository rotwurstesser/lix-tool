// Same word list as the TS test for tools/spellcheck.swift. Both must give the same unknown words.
// harness = false: this main() runs on the main thread, as NSSpellChecker needs.

#[derive(serde::Deserialize)]
struct Parity {
    words: Vec<String>,
    unknown: Vec<String>,
}

fn main() {
    if !cfg!(target_os = "macos") {
        println!("spell_parity: skipped (not macOS)");
        return;
    }
    let parity: Parity = serde_json::from_str(include_str!("../../tests/spell-parity.json")).unwrap();
    let got = lix_writer_lib::unknown_words(&parity.words);
    assert_eq!(got, parity.unknown, "spell.rs disagrees with the parity list");
    println!("spell_parity: ok ({} words, {} unknown)", parity.words.len(), got.len());
}
