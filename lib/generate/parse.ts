import { words } from '../lix.ts';

// Variant lines from a model answer: numbering, bullets and quotes removed; only full sentences kept.
export function parseVariants(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const l = stripChars(line.replace(/^\s*(\d+[.)]|[-*])\s*/u, '').trim(), '"„“”«»*');
    if (l && /[.!?]["“”«»]?$/u.test(l)) out.push(l);
  }
  return out;
}

// Title from a model answer: first non-empty line, at most 3 words, no punctuation.
export function parseTitle(raw: string): string {
  const line = raw
    .replace(/[*#_`]+/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return '';
  return words(line.replace(/^titel\s*:/iu, '')).slice(0, 3).join(' ');
}

// Python str.strip(chars).
function stripChars(s: string, chars: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && chars.includes(s[start])) start++;
  while (end > start && chars.includes(s[end - 1])) end--;
  return s.slice(start, end);
}
