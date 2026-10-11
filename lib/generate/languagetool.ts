// LanguageTool as the grammar checker of the loop. The app reaches it through Rust (lib/grammar.ts),
// the eval runner over HTTP.
import type { GrammarCheckOptions, GrammarChecker, GrammarIssue } from './grammar.ts';

// Swiss German: accepts "grossen" and "Spass", still flags "dem Hase" (DE_AGREEMENT). Checked on LanguageTool 6.6.
export const LT_LANGUAGE = 'de-CH';
// Categories that count as a grammar error.
export const LT_CATEGORIES: ReadonlySet<string> = new Set(['GRAMMAR', 'CASING', 'CONFUSED_WORDS']);

export interface LtMatch {
  message: string;
  offset: number;
  length: number;
  replacements?: Array<{ value: string }>;
  rule: { id: string; category: { id: string } };
  context: { text: string; offset: number; length: number };
}

export interface LtTransport {
  check(text: string, signal?: AbortSignal): Promise<LtMatch[]>;
}

/** The flagged words of a match, from its context. */
export function snippet(m: LtMatch): string {
  return m.context.text.slice(m.context.offset, m.context.offset + m.context.length);
}

const TITLE_CASE = /^\p{Lu}[\p{Ll}\p{M}'’-]*$/u;

/**
 * Grammar, casing and confused words count. Typos count only on lower-case words: a title-case
 * word is mostly a name, and the speller does not know names.
 */
export function isRelevantMatch(m: LtMatch): boolean {
  const category = m.rule.category.id;
  if (LT_CATEGORIES.has(category)) return true;
  if (category !== 'TYPOS') return false;
  return !snippet(m)
    .split(/\s+/)
    .every((w) => TITLE_CASE.test(w));
}

export class HttpLanguageTool implements LtTransport {
  readonly url: string;
  readonly language: string;

  constructor(url: string, language = LT_LANGUAGE) {
    this.url = url.replace(/\/+$/, '');
    this.language = language;
  }

  async check(text: string, signal?: AbortSignal): Promise<LtMatch[]> {
    const res = await fetch(`${this.url}/v2/check`, {
      method: 'POST',
      body: new URLSearchParams({ text, language: this.language }),
      // Keep the per-request timeout also when the caller passes its own signal.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LanguageTool check failed (${res.status})`);
    return ((await res.json()) as { matches: LtMatch[] }).matches;
  }
}

/** Checks all sentences in one request and maps each match back to its sentence. */
export class LanguageToolChecker implements GrammarChecker {
  private readonly lt: LtTransport;

  constructor(lt: LtTransport) {
    this.lt = lt;
  }

  async check(sentences: string[], opts: GrammarCheckOptions = {}): Promise<GrammarIssue[]> {
    const starts: number[] = [];
    let pos = 0;
    for (const s of sentences) {
      starts.push(pos);
      pos += s.length + 1;
    }
    const matches = await this.lt.check(sentences.join(' '), opts.signal);
    const issues: GrammarIssue[] = [];
    for (const m of matches) {
      if (!isRelevantMatch(m)) continue;
      let index = starts.length - 1;
      while (index > 0 && starts[index] > m.offset) index--;
      issues.push({
        index,
        message: m.message,
        snippet: snippet(m),
        offset: m.offset - starts[index],
        length: m.length,
        ruleId: m.rule.id,
        replacements: (m.replacements ?? []).slice(0, 3).map((r) => r.value),
      });
      if (opts.firstOnly) break;
    }
    return issues;
  }
}
