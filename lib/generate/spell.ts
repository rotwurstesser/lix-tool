export interface SpellChecker {
  // Returns the words the checker does not know.
  unknown(words: string[]): Promise<Set<string>>;
}

export class NoopSpellChecker implements SpellChecker {
  async unknown(): Promise<Set<string>> {
    return new Set();
  }
}

// Asks the checker once per distinct word and remembers the answer.
export class CachedSpellChecker {
  private readonly checker: SpellChecker;
  private readonly known = new Map<string, boolean>();

  constructor(checker: SpellChecker) {
    this.checker = checker;
  }

  async prime(words: string[]): Promise<void> {
    const fresh = [...new Set(words.filter((w) => !this.known.has(w)))];
    if (!fresh.length) return;
    const bad = await this.checker.unknown(fresh);
    for (const w of fresh) this.known.set(w, !bad.has(w));
  }

  // Call prime() for the word first.
  isKnown(word: string): boolean {
    return this.known.get(word) ?? true;
  }
}
