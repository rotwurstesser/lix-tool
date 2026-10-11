// Reads words from stdin, one per line. Prints each word that the macOS German spell checker does not know.
import AppKit

let checker = NSSpellChecker.shared
while let line = readLine() {
    let word = line.trimmingCharacters(in: .whitespaces)
    if word.isEmpty { continue }
    let range = checker.checkSpelling(of: word, startingAt: 0, language: "de", wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
    if range.length > 0 { print(word) }
}
