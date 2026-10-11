import { describe, expect, it } from 'vitest';
import { SHEET_SENTENCES, SHEET_TITLE } from '../lib/debug-screens.ts';
import {
  chooseFit,
  CONTENT_HEIGHT_MM,
  estimateMeasure,
  footerText,
  LINE_HEIGHTS,
  sheetFileName,
  sheetStats,
  wrapLines,
  type Measure,
} from '../lib/reading-sheet.ts';
import { STORY, TITLE } from './fixture.ts';

describe('sheetStats and footer', () => {
  it('gives the numbers of the teacher sheet for the own samples', () => {
    for (const [title, sentences] of [
      [TITLE, STORY],
      [SHEET_TITLE, SHEET_SENTENCES],
    ] as const) {
      expect(sentences).toHaveLength(10);
      expect(sheetStats(title, [...sentences])).toEqual({ lix: 26, words: 112, targetSeconds: 67 });
    }
  });

  it('formats the footer like the template', () => {
    expect(footerText({ lix: 26, words: 112, targetSeconds: 67 })).toBe(
      'LIX: 26   Anzahl Wörter: 112   Zielzeit (maximal): 1min 7s',
    );
    expect(footerText({ lix: 18, words: 50, targetSeconds: 30 })).toBe(
      'LIX: 18   Anzahl Wörter: 50   Zielzeit (maximal): 30s',
    );
    expect(footerText({ lix: 30, words: 200, targetSeconds: 120 })).toBe(
      'LIX: 30   Anzahl Wörter: 200   Zielzeit (maximal): 2min 0s',
    );
  });

  it('recomputes with an edited title', () => {
    const plain = sheetStats('', [...SHEET_SENTENCES]);
    expect(plain.words).toBe(110);
    expect(sheetStats('Der freche Kater Moritz', [...SHEET_SENTENCES]).words).toBe(114);
    expect(sheetStats('  Kater Moritz  ', [...SHEET_SENTENCES]).lix).toBe(26);
  });
});

describe('sheetFileName', () => {
  it('follows the teacher file name', () => {
    expect(sheetFileName(26, 'Hexe Xenia')).toBe('Lesetraining_LIX26_Hexe_Xenia');
    expect(sheetFileName(31, '  Der  grosse / böse: Wolf? ')).toBe('Lesetraining_LIX31_Der_grosse_böse_Wolf');
    expect(sheetFileName(20, 'Die Strasse')).toBe('Lesetraining_LIX20_Die_Strasse');
    expect(sheetFileName(20, 'Die Straße')).toBe('Lesetraining_LIX20_Die_Strasse');
    expect(sheetFileName(22, '   ')).toBe('Lesetraining_LIX22');
  });
});

describe('wrapLines', () => {
  it('wraps greedily at word borders', () => {
    expect(wrapLines('', 10)).toBe(0);
    expect(wrapLines('eins zwei', 10)).toBe(1);
    expect(wrapLines('eins zwei drei', 10)).toBe(2);
    expect(wrapLines('Donaudampfschifffahrt', 10)).toBe(1);
  });
});

describe('chooseFit', () => {
  // Story and block heights in mm at line spacing 1.5; both scale with the spacing.
  const fixed = (story: number, block: number): Measure => (part, lh) =>
    (story + (part === 'all' ? block : 0)) * (lh / 1.5);

  it('keeps the boxes at the bottom at spacing 1.5 when everything fits', () => {
    expect(chooseFit('bottom', fixed(150, 80))).toEqual({ layout: 'bottom', lineHeight: 1.5, moved: false, overflow: false });
  });

  it('lowers the spacing step by step before it moves the boxes', () => {
    // 300 mm at 1.5 → 280 at 1.4 → 260 at 1.3 (fits 266.6 mm).
    expect(chooseFit('bottom', fixed(220, 80))).toEqual({ layout: 'bottom', lineHeight: 1.3, moved: false, overflow: false });
  });

  it('moves the boxes to the back when no spacing fits', () => {
    expect(chooseFit('bottom', fixed(250, 120))).toEqual({ layout: 'back', lineHeight: 1.5, moved: true, overflow: false });
  });

  it('uses the back layout when chosen, also when one page would fit', () => {
    expect(chooseFit('back', fixed(100, 50))).toEqual({ layout: 'back', lineHeight: 1.5, moved: false, overflow: false });
  });

  it('keeps the smallest spacing when the story alone needs more than one page', () => {
    expect(chooseFit('back', fixed(400, 50))).toEqual({ layout: 'back', lineHeight: LINE_HEIGHTS.at(-1), moved: false, overflow: true });
  });

  it('is exact at the page border', () => {
    expect(chooseFit('bottom', fixed(CONTENT_HEIGHT_MM - 80, 80)).layout).toBe('bottom');
    expect(chooseFit('bottom', fixed(CONTENT_HEIGHT_MM - 80 + 0.01, 80)).lineHeight).toBe(1.4);
  });

  it('estimate: the template-size text keeps the boxes at the bottom, a long text moves them', () => {
    const fit = chooseFit('bottom', estimateMeasure(SHEET_TITLE, [...SHEET_SENTENCES]));
    expect(fit.layout).toBe('bottom');
    expect(fit.moved).toBe(false);
    const longer = [...SHEET_SENTENCES, ...SHEET_SENTENCES.slice(0, 3)];
    expect(chooseFit('bottom', estimateMeasure(SHEET_TITLE, longer))).toMatchObject({ layout: 'back', moved: true, overflow: false });
    const double = [...SHEET_SENTENCES, ...SHEET_SENTENCES];
    expect(chooseFit('bottom', estimateMeasure(SHEET_TITLE, double))).toMatchObject({ layout: 'back', moved: true, overflow: true });
  });
});

describe('sheetStats with ß in the title', () => {
  it('counts the Swiss spelling that the sheet prints', () => {
    // "Straße" has 6 letters, the printed "Strasse" has 7 and counts as a long word.
    expect(sheetStats('Die Straße', ['Ein Hund läuft.'])).toEqual(sheetStats('Die Strasse', ['Ein Hund läuft.']));
  });
});
