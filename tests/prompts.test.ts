import { describe, expect, it } from 'vitest';
import { draftPrompt, wordsPerSentence } from '../lib/generate/prompts.ts';

describe('wordsPerSentence', () => {
  it.each([
    [15, 5],
    [25, 8],
    [28, 11],
    [30, 13],
    [34, 17],
    [35, 18],
    [45, 22],
    [50, 25],
  ])('target %i -> %i words', (target, wps) => {
    expect(wordsPerSentence(target)).toBe(wps);
  });
});

describe('draftPrompt', () => {
  it('asks for short words only below LIX 30', () => {
    expect(draftPrompt('einen Hund', 10, 25)).toContain('etwa 8 Wörter pro Satz. Verwende kurze, einfache Wörter');
    expect(draftPrompt('einen Hund', 10, 30)).not.toContain('kurze, einfache Wörter');
    expect(draftPrompt('einen Hund', 10, 45)).toMatch(/^Schreibe eine Kindergeschichte .* etwa 22 Wörter pro Satz\. Einfache/);
  });
});
