import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../lib/generate/client.ts';
import type { GrammarChecker, GrammarIssue } from '../lib/generate/grammar.ts';
import { generateText, REPAIR_ROUNDS, type LoopEvent } from '../lib/generate/loop.ts';
import { isLongWord, words } from '../lib/lix.ts';
import { STORY, TITLE } from './fixture.ts';

// The fixture story with one agreement error in sentence 3.
const BAD = 'Plötzlich rennt der Hund los und bellt dem Hase laut hinterher.';
const HASE_STORY = STORY.map((s, i) => (i === 2 ? BAD : s));

// Fake LanguageTool: flags "dem Hase" like DE_AGREEMENT. Counts its calls.
function fakeChecker(): GrammarChecker & { calls: number } {
  const checker = {
    calls: 0,
    async check(sentences: string[], opts: { firstOnly?: boolean } = {}): Promise<GrammarIssue[]> {
      checker.calls++;
      const issues: GrammarIssue[] = [];
      for (const [index, s] of sentences.entries()) {
        const at = s.indexOf('dem Hase ');
        if (at < 0) continue;
        issues.push({ index, message: 'Kongruenzfehler', snippet: 'dem Hase', offset: at, length: 8, ruleId: 'DE_AGREEMENT', replacements: ['dem Hasen'] });
        if (opts.firstOnly) break;
      }
      return issues;
    },
  };
  return checker;
}

type Repair = (sentence: string) => string;

function fakeClient(repairWith: Repair): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async generate(prompt) {
      prompts.push(prompt);
      if (prompt.startsWith('Schreibe eine Kindergeschichte')) return HASE_STORY.join(' ');
      if (prompt.startsWith('Gib dieser Kindergeschichte')) return TITLE;
      if (prompt.startsWith('Korrigiere nur')) return HASE_STORY.join(' ');
      if (prompt.startsWith('Im folgenden Satz')) return repairWith(/\nSatz: (.*)\n/.exec(prompt)?.[1] ?? '');
      const text = /\nText: (.*)\n/.exec(prompt)?.[1] ?? '';
      const long = words(text).find(isLongWord) ?? '';
      return `1. ${text.replace(long, 'Ast')}\n2. ${text}`;
    },
  };
}

const params = { topic: 'einen Hund im Park', targetLix: 25, sentences: 10 };
const repairPrompts = (c: { prompts: string[] }) => c.prompts.filter((p) => p.startsWith('Im folgenden Satz'));

describe('final grammar check and repair', () => {
  it('repairs a flagged sentence with the LanguageTool message and keeps LIX on target', async () => {
    const client = fakeClient((s) => s.replace('dem Hase', 'dem Hasen'));
    const events: LoopEvent[] = [];
    const res = await generateText(params, { client, grammar: fakeChecker() }, (e) => events.push(e));
    expect(res.grammarIssues).toEqual([]);
    expect(res.repairs).toBe(1);
    expect(res.hit).toBe(true);
    expect(res.sentences.join(' ')).toContain('dem Hasen');
    const [prompt] = repairPrompts(client);
    expect(prompt).toContain('Kongruenzfehler');
    expect(prompt).toContain('Vorschlag: „dem Hasen“');
    expect(events.map((e) => e.type)).toContain('repair');
    expect(res.lixPath.at(-1)).toBe(res.lix);
  });

  it('stops after REPAIR_ROUNDS and returns the remaining findings', async () => {
    const client = fakeClient((s) => s); // the model answers the same sentence
    const stubborn = fakeClient((s) => s.replace('laut', 'sehr laut'));
    const res = await generateText(params, { client, grammar: fakeChecker() });
    // An unchanged answer is no repair: the loop stops at once.
    expect(res.repairs).toBe(1);
    expect(res.grammarIssues).toHaveLength(1);
    const res2 = await generateText(params, { client: stubborn, grammar: fakeChecker() });
    expect(REPAIR_ROUNDS).toBe(2);
    expect(res2.repairs).toBe(REPAIR_ROUNDS);
    expect(res2.grammarIssues).toHaveLength(1);
    expect(res2.grammarIssues[0]).toMatchObject({ ruleId: 'DE_AGREEMENT', snippet: 'dem Hase' });
  });

  it('honours repairRounds and keeps the model check without its own checker', async () => {
    const stubborn = fakeClient((s) => s.replace('laut', 'sehr laut'));
    const one = await generateText(params, { client: stubborn, grammar: fakeChecker(), repairRounds: 1 });
    expect(one.repairs).toBe(1);
    const model = fakeClient((s) => s);
    const res = await generateText(params, {
      client: { generate: (p, o) => (p.startsWith('Ist dieser') ? Promise.resolve('JA') : model.generate(p, o)) },
    });
    expect(repairPrompts(model)).toHaveLength(0);
    expect(res.repairs).toBe(0);
    expect(res.grammarIssues).toEqual([]);
  });

  it('rejects a repair with an invented word and keeps the old sentence', async () => {
    const client = fakeClient((s) => s.replace('dem Hase', 'dem Hasenx'));
    const res = await generateText(params, {
      client,
      grammar: fakeChecker(),
      spell: { unknown: async (ws) => new Set(ws.filter((w) => w.endsWith('x'))) },
    });
    expect(res.sentences.join(' ')).not.toContain('Hasenx');
    expect(res.grammarIssues).toHaveLength(1);
  });

  it('never trades grammar for LIX: the grammatical text wins over a closer LIX', async () => {
    // The repair adds a long word and nothing can bring LIX back (edits answer nothing usable).
    const client = fakeClient((s) => s.replace('dem Hase', 'dem Hasen').replace('laut', 'unglaublich'));
    const noEdits: LlmClient = {
      generate: (p, o) => (p.startsWith('Geschichte:') ? Promise.resolve('') : client.generate(p, o)),
    };
    const res = await generateText(params, { client: noEdits, grammar: fakeChecker() });
    expect(res.grammarIssues).toEqual([]);
    expect(res.sentences.join(' ')).toContain('unglaublich');
  });
});
