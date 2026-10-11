import { isLongWord, lix, round1, words } from '../lix.ts';
import { INSTRUCTIONS } from './prompts.ts';

export const MAX_OPTIONS = 6;

export interface EditOption {
  instruction: string;
  // Edit replaces sentences[start .. start + count).
  start: number;
  count: number;
  // Predicted LIX minus target after the edit.
  predictedGap: number;
}

export interface EditContext {
  target: number;
  title?: string;
  // Indexes of sentences that contain unknown words.
  flagged?: Set<number>;
  // Requested sentence count. Splits and joins must not leave the allowed band.
  requested?: number;
}

// The sentence count may differ from the requested count by this much.
export const SENTENCE_BAND = 2;

// One point per sentence outside the allowed band.
export function bandPenalty(count: number, requested?: number): number {
  if (requested === undefined) return 0;
  return Math.max(0, count - (requested + SENTENCE_BAND)) + Math.max(0, requested - SENTENCE_BAND - count);
}

// Edits that move LIX toward the target, ranked.
export function editOptions(sents: string[], { target, title, flagged = new Set(), requested }: EditContext): EditOption[] {
  const titleWords = title ? words(title).length : 0;
  const total = words(sents.join(' ')).length + titleWords;
  const n = sents.length + (titleWords ? 1 : 0);
  const gap = lix(sents, { title }) - target;
  const wps = total / n;
  const swap = 100 / total; // LIX change of one long/short word swap
  const maySplit = requested === undefined || sents.length < requested + SENTENCE_BAND;
  const mayJoin = requested === undefined || sents.length > requested - SENTENCE_BAND;
  const opts: EditOption[] = [];
  sents.forEach((s, i) => {
    const ws = words(s);
    const nLong = ws.filter(isLongWord).length;
    if (gap > 0) {
      if (nLong) opts.push({ instruction: INSTRUCTIONS.shortenWord, start: i, count: 1, predictedGap: gap - swap });
      if (maySplit && ws.length >= 8) {
        opts.push({ instruction: INSTRUCTIONS.split, start: i, count: 1, predictedGap: gap - (wps - total / (n + 1)) });
      }
    } else {
      if (ws.length > nLong) {
        opts.push({ instruction: INSTRUCTIONS.lengthenWord, start: i, count: 1, predictedGap: gap + swap });
      }
      if (mayJoin && i + 1 < sents.length && sents.length > 2) {
        opts.push({ instruction: INSTRUCTIONS.join, start: i, count: 2, predictedGap: gap + (total / (n - 1) - wps) });
      }
    }
  });
  // Sentences with unknown words first, then the best predicted gap. Edits on long sentences first among equals.
  const key = (o: EditOption) => [flagged.has(o.start) ? 0 : 1, round1(Math.abs(o.predictedGap)), -words(sents[o.start]).length];
  opts.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let j = 0; j < ka.length; j++) if (ka[j] !== kb[j]) return ka[j] - kb[j];
    return 0;
  });
  return opts.slice(0, MAX_OPTIONS);
}

// Rejects candidates that cheat: invented words, or long words cut short (verlorenen -> verlor).
// Also rejects candidates that delete content: a sentence without words, or less than half the words left.
export function cleanEdit(oldText: string, newSents: string[], isKnown: (word: string) => boolean): boolean {
  const old = words(oldText);
  const fresh = words(newSents.join(' '));
  if (newSents.some((s) => !words(s).length)) return false;
  if (fresh.length * 2 < old.length) return false;
  const removed = old.filter((w) => !fresh.includes(w)).map((w) => w.toLowerCase());
  for (const w of fresh) {
    if (old.includes(w)) continue;
    if (!isKnown(w)) return false;
    const lw = w.toLowerCase();
    if (removed.some((r) => r !== lw && r.startsWith(lw) && [...w].length >= 3)) return false;
  }
  return true;
}
