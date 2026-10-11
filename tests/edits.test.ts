import { describe, expect, it } from 'vitest';
import { bandPenalty, cleanEdit, editOptions } from '../lib/generate/edits.ts';
import { parseTitle, parseVariants } from '../lib/generate/parse.ts';
import { INSTRUCTIONS } from '../lib/generate/prompts.ts';
import { STORY, TITLE } from './fixture.ts';

describe('parseVariants', () => {
  it('strips numbering, bullets and quotes; keeps only full sentences', () => {
    const raw = [
      'Hier sind drei Varianten:',
      '1. Der Hund bellt laut.',
      '2) „Der Hund ruft: Hallo!“',
      '- *Der Hund schläft.*',
      '3. ohne Punkt am Ende',
      '',
    ].join('\n');
    expect(parseVariants(raw)).toEqual(['Der Hund bellt laut.', 'Der Hund ruft: Hallo!', 'Der Hund schläft.']);
  });
});

describe('parseTitle', () => {
  it('takes at most 3 words without punctuation', () => {
    expect(parseTitle('**Titel: „Hexe Xenia!“**\nmehr')).toBe('Hexe Xenia');
    expect(parseTitle('Der kleine mutige Fuchs')).toBe('Der kleine mutige');
    expect(parseTitle('')).toBe('');
  });
});

describe('editOptions', () => {
  const brief = (opts: ReturnType<typeof editOptions>) =>
    opts.map((o) => [Object.entries(INSTRUCTIONS).find(([, v]) => v === o.instruction)?.[0], o.start]);

  it('ranks flagged sentences first, then the predicted gap, then the original order', () => {
    // LIX with title is 26.3; target 20 means LIX must go down. Swap and split both round to a gap of 5.4.
    const opts = editOptions(STORY, { target: 20, title: TITLE, flagged: new Set([6]) });
    expect(brief(opts)).toEqual([
      ['shortenWord', 6],
      ['split', 6],
      ['shortenWord', 0],
      ['split', 0],
      ['shortenWord', 1],
      ['split', 1],
    ]);
  });

  it('puts the smallest predicted gap first and long sentences first among equals', () => {
    const story = [
      'Lena ruft laut.',
      'Der Igel rollt sich schnell zu einer runden Kugel zusammen.',
      'Plötzlich rennt der Hund los und bellt einen kleinen stacheligen Igel an.',
    ];
    // LIX must go down: swaps (gap 14.3) before splits (gap 16.3), longest sentence first within each.
    expect(brief(editOptions(story, { target: 10 }))).toEqual([
      ['shortenWord', 2],
      ['shortenWord', 1],
      ['split', 2],
      ['split', 1],
    ]);
  });

  it('offers longer words and joins when LIX must go up', () => {
    const opts = editOptions(['Ein Hund bellt.', 'Ein Hund bellt.', 'Ein Hund bellt.'], { target: 50 });
    // One swap (gap -35.9) is closer to the target than one join (gap -45.5).
    expect(brief(opts)).toEqual([
      ['lengthenWord', 0],
      ['lengthenWord', 1],
      ['lengthenWord', 2],
      ['join', 0],
      ['join', 1],
    ]);
    expect(opts.every((o) => o.start + o.count <= 3)).toBe(true);
  });
});

describe('sentence count band', () => {
  const long = 'Plötzlich rennt der Hund los und bellt einen kleinen stacheligen Igel an.';

  it('offers no splits at requested + 2 sentences or more', () => {
    const story = Array(7).fill(long);
    expect(editOptions(story, { target: 10, requested: 6 }).some((o) => o.instruction === INSTRUCTIONS.split)).toBe(true);
    expect(editOptions(story, { target: 10, requested: 5 }).some((o) => o.instruction === INSTRUCTIONS.split)).toBe(false);
  });

  it('offers no joins at requested - 2 sentences or fewer', () => {
    const story = Array(5).fill('Ein Hund bellt.');
    expect(editOptions(story, { target: 50, requested: 6 }).some((o) => o.instruction === INSTRUCTIONS.join)).toBe(true);
    expect(editOptions(story, { target: 50, requested: 7 }).some((o) => o.instruction === INSTRUCTIONS.join)).toBe(false);
  });

  it('adds one point per sentence outside the band', () => {
    expect([7, 8, 12, 13, 15].map((n) => bandPenalty(n, 10))).toEqual([1, 0, 0, 1, 3]);
    expect(bandPenalty(20)).toBe(0);
  });
});

describe('cleanEdit', () => {
  const known = new Set(['Der', 'Fuchs', 'findet', 'den', 'verlor', 'alten', 'Schlüssel', 'Schatz', 'im', 'Wald']);
  const isKnown = (w: string) => known.has(w);

  it('rejects an invented word', () => {
    expect(cleanEdit('Der Fuchs findet den Schlüssel.', ['Der Fuchs findet den Schlüsselchenz.'], isKnown)).toBe(false);
  });

  it('rejects a long word cut short', () => {
    expect(cleanEdit('Der Fuchs findet den verlorenen Schlüssel.', ['Der Fuchs findet den verlor Schlüssel.'], isKnown)).toBe(
      false,
    );
  });

  it('rejects a candidate with a wordless sentence', () => {
    expect(cleanEdit('Der Fuchs findet den Schlüssel.', ['.'], isKnown)).toBe(false);
    expect(cleanEdit('Der Fuchs findet den Schlüssel.', ['Der Fuchs findet den Schlüssel.', '!'], isKnown)).toBe(false);
  });

  it('rejects a candidate that drops more than half the words', () => {
    expect(cleanEdit('Der Fuchs findet den alten Schlüssel im Wald.', ['Der Fuchs.'], isKnown)).toBe(false);
    expect(cleanEdit('Der Fuchs findet den alten Schlüssel im Wald.', ['Der Fuchs findet den Schlüssel.'], isKnown)).toBe(true);
  });

  it('accepts a real word swap', () => {
    expect(cleanEdit('Der Fuchs findet den verlorenen Schlüssel.', ['Der Fuchs findet den alten Schlüssel.'], isKnown)).toBe(true);
  });
});
