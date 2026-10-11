import { describe, expect, it } from 'vitest';
import {
  countWords,
  formatTargetTime,
  isLongWord,
  lix,
  round1,
  splitSentences,
  swissSpelling,
  targetTimeSeconds,
  words,
} from '../lib/lix.ts';
import { STORY, TITLE } from './fixture.ts';

describe('splitSentences', () => {
  it('keeps abbreviations inside the sentence', () => {
    expect(splitSentences('Er kauft z.B. Brot, Milch usw. beim Bäcker. Dr. Klein kommt auch. Sie lacht.')).toEqual([
      'Er kauft z.B. Brot, Milch usw. beim Bäcker.',
      'Dr. Klein kommt auch.',
      'Sie lacht.',
    ]);
  });

  it('keeps decimals inside the sentence', () => {
    expect(splitSentences('Der Zug fährt um 7.30 Uhr ab. Er ist pünktlich.')).toEqual([
      'Der Zug fährt um 7.30 Uhr ab.',
      'Er ist pünktlich.',
    ]);
  });

  it('keeps direct speech with "rief er" as one sentence', () => {
    expect(splitSentences('„Hilfe!“, rief er. „Ich komme!“ Dann rannte sie los.')).toEqual([
      '„Hilfe!“, rief er.',
      '„Ich komme!“',
      'Dann rannte sie los.',
    ]);
  });

  it('drops markdown and a leading title line', () => {
    expect(splitSentences('# **Der kleine Fuchs**\n\nDer Fuchs schläft. Er träumt.')).toEqual([
      'Der Fuchs schläft.',
      'Er träumt.',
    ]);
  });

  it('joins hard-wrapped lines instead of dropping them', () => {
    expect(splitSentences('Der Fuchs schläft.\nEr träumt von einem\ngrossen Wald. Dann wacht er auf.')).toEqual([
      'Der Fuchs schläft.',
      'Er träumt von einem grossen Wald.',
      'Dann wacht er auf.',
    ]);
  });

  it('keeps a long first line without end punctuation (wrapped text, not a title)', () => {
    expect(splitSentences('Der kleine Fuchs läuft am frühen Morgen ganz allein durch den\ndunklen Wald.')).toEqual([
      'Der kleine Fuchs läuft am frühen Morgen ganz allein durch den dunklen Wald.',
    ]);
  });

  it('splits before a digit, but not after a bare number (date, ordinal)', () => {
    expect(splitSentences('Es war spät. 3 Kinder kamen. Am 3. Mai schneite es.')).toEqual([
      'Es war spät.',
      '3 Kinder kamen.',
      'Am 3. Mai schneite es.',
    ]);
  });

  it('returns nothing for empty or garbled input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('... !!! ???')).toEqual([]);
  });
});

describe('words', () => {
  it('counts umlauts and words with an inner hyphen as one word', () => {
    expect(words('Die Bäckerei-Tür öffnet sich, 3 Kinder rufen „Grüezi“.')).toEqual([
      'Die',
      'Bäckerei-Tür',
      'öffnet',
      'sich',
      'Kinder',
      'rufen',
      'Grüezi',
    ]);
  });

  it('measures long words in letters', () => {
    expect(isLongWord('grossen')).toBe(true);
    expect(isLongWord('Bäcker')).toBe(false);
    expect(isLongWord('Würstel')).toBe(true);
  });

  it('does not count hyphens as letters; a hyphenated compound stays one word', () => {
    expect(words('Die U-Boote tauchen.')).toEqual(['Die', 'U-Boote', 'tauchen']);
    expect(isLongWord('U-Boote')).toBe(false);
    expect(isLongWord('See-Erlebnis')).toBe(true);
  });
});

describe('lix', () => {
  it('fixture has the counts of the teacher sheet', () => {
    const ws = words(STORY.join(' '));
    expect(STORY).toHaveLength(10);
    expect(ws).toHaveLength(110);
    expect(ws.filter(isLongWord)).toHaveLength(18);
  });

  it('counts the title as words and one sentence', () => {
    expect(round1(lix(STORY, { title: TITLE }))).toBe(26.3);
    expect(countWords(STORY, { title: TITLE })).toBe(112);
  });

  it('without title', () => {
    expect(round1(lix(STORY))).toBe(27.4);
    expect(countWords(STORY)).toBe(110);
  });

  it('is 0 for no text', () => {
    expect(lix([])).toBe(0);
  });
});

describe('target time', () => {
  it('112 words take 67 s at 100 words per minute', () => {
    expect(targetTimeSeconds(112)).toBe(67);
    expect(formatTargetTime(67)).toBe('1min 7s');
  });
});

describe('swissSpelling', () => {
  it('replaces ß with ss', () => {
    expect(swissSpelling('Der große Fuß stößt an die Straße.')).toBe('Der grosse Fuss stösst an die Strasse.');
  });
});

describe('round1', () => {
  it('rounds half to even like Python', () => {
    expect(round1(26.25)).toBe(26.2);
    expect(round1(26.35)).toBe(26.4);
    expect(round1(26.2532)).toBe(26.3);
  });
});
