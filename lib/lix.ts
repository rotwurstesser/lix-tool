// Text counting rules shared by the generator, the UI and the evals.
// Ported from experiments/draft_then_fix.py (v3).

// Abbreviations and decimals must not end a sentence.
const ABBREV = /(?<![\p{L}\p{N}_])(z\.\s?B|d\.\s?h|u\.\s?a|usw|bzw|ca|Dr|Hr|Fr|Nr|St)\./gu;
const DOT = '․';
const END_OF_LINE = /[.!?]["“”«»]?\s*$/u;
// A sentence ends at .!? (plus closing quote) only when a new sentence starts, so "„Hilfe!“, rief er" stays one.
// A period after a bare number does not end a sentence ("am 3. Mai").
const SENTENCE_BREAK =
  /(?<=[.!?]["“”«»])\s+(?=[A-ZÄÖÜ„"«\d])|(?<=[.!?])(?<!(?:^|[^\p{L}\p{N}_])\p{N}+\.)\s+(?=[A-ZÄÖÜ„"«\d])/u;
// A leading line without end punctuation and with at most this many words is a title.
const MAX_TITLE_WORDS = 8;
const WORD = /\p{L}+(?:-\p{L}+)*/gu;

export function splitSentences(text: string): string[] {
  let t = text.replace(/[*#_`]+/g, '');
  // Drop a leading title line. Other lines without end punctuation are wrapped sentence text and stay.
  const lines = t.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && !END_OF_LINE.test(lines[first].trim()) && words(lines[first]).length <= MAX_TITLE_WORDS) {
    lines.splice(first, 1);
  }
  t = lines.join(' ');
  t = t.replace(ABBREV, (m) => m.replaceAll('.', DOT));
  t = t.replace(/(\d)\.(\d)/g, `$1${DOT}$2`);
  t = t.split(/\s+/).filter(Boolean).join(' ');
  return t
    .split(SENTENCE_BREAK)
    .map((p) => p.replaceAll(DOT, '.').trim())
    .filter((p) => /[\p{L}\p{N}_]/u.test(p));
}

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

// Long word = more than 6 letters. Hyphens do not count as letters.
export function isLongWord(word: string): boolean {
  return [...word.replaceAll('-', '')].length > 6;
}

export interface LixOptions {
  title?: string;
}

// Teacher's rule: a title adds its words to the word count and counts as one sentence.
export function lix(sentences: string[], { title }: LixOptions = {}): number {
  const titleWords = title ? words(title) : [];
  const ws = [...titleWords, ...words(sentences.join(' '))];
  const n = sentences.length + (titleWords.length ? 1 : 0);
  if (!ws.length || !sentences.length) return 0;
  return ws.length / n + (100 * ws.filter(isLongWord).length) / ws.length;
}

export function countWords(sentences: string[], { title }: LixOptions = {}): number {
  return words([title ?? '', ...sentences].join(' ')).length;
}

// Reading speed of the teacher's sheet: 100 words per minute.
export function targetTimeSeconds(wordCount: number): number {
  return Math.round((wordCount * 60) / 100);
}

export function formatTargetTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return min ? `${min}min ${sec}s` : `${sec}s`;
}

// Swiss spelling: no ß.
export function swissSpelling(text: string): string {
  return text.normalize('NFC').replaceAll('ß', 'ss').replaceAll('ẞ', 'SS');
}

// Python round(x, 1): round half to even.
export function round1(x: number): number {
  const scaled = x * 10;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const r = diff > 0.5 || (diff === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
  return r / 10;
}
