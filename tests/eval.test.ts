import { describe, expect, it } from 'vitest';
import {
  judgeMatches,
  type LtMatch,
  median,
  parseArgs,
  type ResultRow,
  summarize,
  summaryMarkdown,
  TOPICS,
} from '../experiments/eval/eval.ts';

describe('parseArgs', () => {
  it('reads all options', () => {
    const a = parseArgs([
      '--set', 'heldout', '--repeats', '2', '--targets', '25, 35,45', '--sentences', '10',
      '--ollama', 'http://127.0.0.1:11435', '--model', 'gemma4:e2b-it-qat', '--out', 'runs/x',
      '--grammar', 'languagetool', '--lt', 'http://localhost:9000',
    ]);
    expect(a).toEqual({
      set: 'heldout',
      repeats: 2,
      targets: [25, 35, 45],
      sentences: 10,
      ollama: 'http://127.0.0.1:11435',
      model: 'gemma4:e2b-it-qat',
      out: 'runs/x',
      grammar: 'languagetool',
      lt: 'http://localhost:9000',
      ltLoop: 'http://localhost:9000',
    });
  });

  it('fills defaults', () => {
    const a = parseArgs(['--set', 'dev', '--model', 'm', '--out', 'o']);
    expect(a).toMatchObject({ repeats: 1, targets: [25, 35, 45], sentences: 10, grammar: 'model', lt: 'http://127.0.0.1:8081', ltLoop: 'http://127.0.0.1:8081' });
  });

  it('takes a separate server for the in-loop checker', () => {
    const a = parseArgs(['--set', 'dev', '--model', 'm', '--out', 'o', '--lt-loop', 'http://127.0.0.1:8181']);
    expect(a).toMatchObject({ lt: 'http://127.0.0.1:8081', ltLoop: 'http://127.0.0.1:8181' });
  });

  it.each([
    [['--model', 'm', '--out', 'o'], /--set is required/],
    [['--set', 'all', '--model', 'm', '--out', 'o'], /--set must be/],
    [['--set', 'dev', '--model', 'm', '--out', 'o', '--repeats', '0'], /positive integer/],
    [['--set', 'dev', '--model', 'm', '--out', 'o', '--targets', '25,x'], /positive integer/],
    [['--set', 'dev', '--model', 'm', '--out', 'o', '--grammar', 'llm'], /--grammar must be/],
    [['--set', 'dev', '--model', 'm', '--out', 'o', '--seed', '1'], /Unknown option --seed/],
    [['--set', 'dev', '--model', '--out', 'o'], /--model needs a value/],
    [['heldout'], /Unexpected argument/],
  ])('rejects %j', (argv, msg) => {
    expect(() => parseArgs(argv)).toThrow(msg);
  });
});

describe('topic sets', () => {
  it('keeps the frozen held-out set', () => {
    expect(TOPICS.heldout).toHaveLength(10);
    expect(TOPICS.heldout[0]).toBe('eine Katze, die auf dem Dach festsitzt');
    expect(TOPICS.heldout[9]).toBe('ein Pinguin, der zum ersten Mal schwimmt');
  });
});

const match = (category: string, text: string): LtMatch => ({
  message: 'm',
  rule: { id: 'R', category: { id: category } },
  context: { text: `xx ${text} yy`, offset: 3, length: text.length },
});

describe('judgeMatches', () => {
  it('counts grammar categories and typos apart', () => {
    const j = judgeMatches([
      match('GRAMMAR', 'dem Hase'),
      match('CASING', 'schritt'),
      match('TYPOS', 'Finn'),
      match('PUNCTUATION', ','),
      match('CONFUSED_WORDS', 'seid'),
    ]);
    expect(j).toEqual({ grammar: 3, typos: 1, examples: ['dem Hase', 'schritt', 'seid'], typoWords: ['Finn'] });
  });
});

const row = (r: Partial<ResultRow>): ResultRow => ({
  model: 'm', topic: 't', target: 30, repeat: 0, set: 'heldout', hit: false, ...r,
});

describe('summarize', () => {
  it('computes hit rate, MAE, medians and the gate with errors as misses', () => {
    const rows = [
      row({ target: 25, lix: 25.3, hit: true, calls: 20, secs: 10, ltGrammar: 0, ltTypos: 1 }),
      row({ target: 35, lix: 35, hit: true, calls: 30, secs: 30, ltGrammar: 2, ltTypos: 0 }),
      row({ target: 45, lix: 47, hit: false, calls: 40, secs: 20, ltGrammar: 0 }),
      row({ target: 45, error: 'Model call timed out after 120 s' }),
    ];
    const s = summarize(rows);
    expect(s.runs).toBe(4);
    expect(s.hits).toBe(2);
    expect(s.hitRate).toBe(0.5);
    expect(s.mae).toBeCloseTo((0.3 + 0 + 2) / 3, 10);
    expect(s.flagged).toBe(1);
    expect(s.typoTexts).toBe(1);
    expect(s.flagRate).toBe(0.5);
    expect(s.callsMedian).toBe(30);
    expect(s.secsMedian).toBe(20);
    expect(s.errors).toBe(1);
    expect(s.pass).toBe(false);
  });

  it('passes at exactly 90% hits and 10% flagged', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ lix: 30, hit: i < 9, calls: 1, secs: 1, ltGrammar: i === 0 ? 1 : 0 }),
    );
    expect(summarize(rows)).toMatchObject({ hitRate: 0.9, flagRate: 0.1, pass: true });
  });

  it('fails an empty run', () => {
    expect(summarize([])).toMatchObject({ runs: 0, pass: false, mae: undefined, callsMedian: undefined });
  });

  it('renders the summary table', () => {
    const args = parseArgs(['--set', 'heldout', '--repeats', '2', '--model', 'm', '--out', 'o']);
    const md = summaryMarkdown(args, summarize([row({ lix: 30.2, hit: true, calls: 5, secs: 7, ltGrammar: 0 })]));
    expect(md).toContain('sentences: 10 (title counted in LIX)');
    expect(md).toContain('Not 1:1 comparable with the Python runs (8 sentences, no title)');
    expect(md).toContain('| m | 1 | 1/1 (100%) | 0.20 | 0/1 | 0/1 | 5 | 7 | 0 | PASS |');
  });
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
