import { describe, expect, it } from 'vitest';
import { isRelevantMatch, LanguageToolChecker, type LtMatch, type LtTransport } from '../lib/generate/languagetool.ts';

function match(text: string, flagged: string, category: string, id = 'RULE'): LtMatch {
  const offset = text.indexOf(flagged);
  return {
    message: `${id} message`,
    offset,
    length: flagged.length,
    replacements: [{ value: 'fix1' }, { value: 'fix2' }],
    rule: { id, category: { id: category } },
    context: { text, offset, length: flagged.length },
  };
}

describe('LanguageTool match filter', () => {
  const t = 'Lena gab dem Hase eine Karotte und schnuffelte.';
  it('keeps grammar, casing and confused words', () => {
    expect(isRelevantMatch(match(t, 'dem Hase', 'GRAMMAR', 'DE_AGREEMENT'))).toBe(true);
    expect(isRelevantMatch(match(t, 'eine', 'CASING'))).toBe(true);
    expect(isRelevantMatch(match(t, 'und', 'CONFUSED_WORDS'))).toBe(true);
  });
  it('ignores typos on title-case names but keeps lower-case typos', () => {
    expect(isRelevantMatch(match(t, 'Lena', 'TYPOS', 'GERMAN_SPELLER_RULE'))).toBe(false);
    expect(isRelevantMatch(match(t, 'schnuffelte', 'TYPOS', 'GERMAN_SPELLER_RULE'))).toBe(true);
  });
  it('ignores style, punctuation and other categories', () => {
    expect(isRelevantMatch(match(t, 'Karotte', 'STYLE'))).toBe(false);
    expect(isRelevantMatch(match(t, '.', 'PUNCTUATION'))).toBe(false);
    expect(isRelevantMatch(match(t, 'und', 'REDUNDANCY'))).toBe(false);
  });
});

describe('LanguageToolChecker', () => {
  const sentences = ['Mia lacht.', 'Er gab dem Hase eine Karotte.', 'Mia heisst sie.'];
  const fake = (pick: (text: string) => LtMatch[]): LtTransport & { texts: string[] } => {
    const texts: string[] = [];
    return {
      texts,
      async check(text) {
        texts.push(text);
        return pick(text);
      },
    };
  };

  it('checks all sentences in one request and maps offsets to sentences', async () => {
    const lt = fake((text) => [match(text, 'dem Hase', 'GRAMMAR', 'DE_AGREEMENT'), match(text, 'Mia heisst', 'TYPOS')]);
    const issues = await new LanguageToolChecker(lt).check(sentences);
    expect(lt.texts).toEqual(['Mia lacht. Er gab dem Hase eine Karotte. Mia heisst sie.']);
    // The typo on "Mia heisst" starts with a name but holds a lower-case word: it counts.
    expect(issues).toEqual([
      { index: 1, message: 'DE_AGREEMENT message', snippet: 'dem Hase', offset: 7, length: 8, ruleId: 'DE_AGREEMENT', replacements: ['fix1', 'fix2'] },
      { index: 2, message: 'RULE message', snippet: 'Mia heisst', offset: 0, length: 10, ruleId: 'RULE', replacements: ['fix1', 'fix2'] },
    ]);
  });

  it('drops irrelevant matches and stops at the first with firstOnly', async () => {
    const lt = fake((text) => [match(text, 'Mia', 'TYPOS'), match(text, 'dem Hase', 'GRAMMAR'), match(text, 'eine', 'CASING')]);
    const all = await new LanguageToolChecker(lt).check(sentences);
    expect(all.map((i) => i.snippet)).toEqual(['dem Hase', 'eine']);
    const first = await new LanguageToolChecker(lt).check(sentences, { firstOnly: true });
    expect(first.map((i) => i.snippet)).toEqual(['dem Hase']);
  });
});
