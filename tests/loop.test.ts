import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../lib/generate/client.ts';
import { generateText, type LoopEvent } from '../lib/generate/loop.ts';
import { isLongWord, words } from '../lib/lix.ts';
import { STORY, TITLE } from './fixture.ts';

type Script = (prompt: string, call: number) => string;

function fakeClient(script: Script): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async generate(prompt) {
      prompts.push(prompt);
      return script(prompt, prompts.length);
    },
  };
}

// Answers like a cooperative model: swaps the first long word of the edit target for a short one.
const cooperative: Script = (prompt) => {
  if (prompt.startsWith('Schreibe eine Kindergeschichte')) return STORY.join(' ');
  if (prompt.startsWith('Gib dieser Kindergeschichte')) return TITLE;
  if (prompt.startsWith('Korrigiere nur')) return STORY.join(' ');
  if (prompt.startsWith('Ist dieser')) return 'JA';
  const text = /\nText: (.*)\n/.exec(prompt)?.[1] ?? '';
  const long = words(text).find(isLongWord) ?? '';
  return `1. ${text.replace(long, 'Ast')}\n2. ${text}\n3. Kaputt`;
};

const params = { topic: 'einen Hund im Park', targetLix: 25, sentences: 10 };

describe('generateText', () => {
  it('reaches the target with a scripted model', async () => {
    const events: LoopEvent[] = [];
    const client = fakeClient(cooperative);
    const res = await generateText(params, { client }, (e) => events.push(e));
    expect(res.hit).toBe(true);
    expect(res.title).toBe(TITLE);
    expect(Math.abs(res.lix - 25)).toBeLessThanOrEqual(0.5);
    expect(res.lixPath[0]).toBe(26.3);
    expect(res.words).toBe(112);
    expect(res.targetTimeSeconds).toBe(67);
    expect(res.calls).toBe(client.prompts.length);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['draft', 'title', 'edit', 'grammar', 'done']));
    expect(events.at(-1)?.type).toBe('done');
  });

  it('reports whether the sentence count is within the requested count ±2', async () => {
    expect((await generateText(params, { client: fakeClient(cooperative) })).sentenceCountOk).toBe(true);
    const few = await generateText({ ...params, sentences: 5 }, { client: fakeClient(cooperative) });
    expect(few.sentences).toHaveLength(10);
    expect(few.sentenceCountOk).toBe(false);
  });

  it('tries the next candidate when the best one fails the grammar check', async () => {
    // Variant 1 uses "Hut" (grammar NEIN), variant 2 "Ast" (JA); both have the same score.
    // The grammar pass returns the original story, so the second fix loop must edit again.
    const client = fakeClient((p, n) => {
      if (p.startsWith('Ist dieser')) return p.includes('Hut') ? 'NEIN' : 'JA';
      if (p.startsWith('Geschichte:')) {
        const text = /\nText: (.*)\n/.exec(p)?.[1] ?? '';
        const long = words(text).find(isLongWord) ?? '';
        return `1. ${text.replace(long, 'Hut')}\n2. ${text.replace(long, 'Ast')}`;
      }
      return cooperative(p, n);
    });
    const res = await generateText(params, { client });
    expect(res.hit).toBe(true);
    expect(res.grammarRejected).toBe(0);
    expect(res.sentences.join(' ')).toContain('Ast');
    expect(res.sentences.join(' ')).not.toContain('Hut');
  });

  it('applies Swiss spelling to model output before counting', async () => {
    const client = fakeClient((p, n) => (n === 1 ? STORY.join(' ').replace('grossen', 'großen') : cooperative(p, n)));
    const res = await generateText(params, { client });
    expect(res.sentences.join(' ')).not.toContain('ß');
  });

  it('survives an empty first draft', async () => {
    const client = fakeClient((p, n) => (n === 1 ? '' : cooperative(p, n)));
    const res = await generateText(params, { client });
    expect(res.hit).toBe(true);
    expect(client.prompts.filter((p) => p.startsWith('Schreibe eine')).length).toBe(2);
  });

  it('returns a miss, not a crash, when every answer is garbage', async () => {
    const client = fakeClient(() => '###');
    const res = await generateText(params, { client });
    expect(res).toMatchObject({ hit: false, sentences: [], lix: 0, calls: 3 });
  });

  it('keeps the closest text when no edit helps', async () => {
    const client = fakeClient((p, n) => (p.startsWith('Geschichte:') ? '' : cooperative(p, n)));
    const res = await generateText(params, { client });
    expect(res.hit).toBe(false);
    expect(res.lix).toBe(26.3);
    expect(res.sentences).toEqual(STORY);
  });

  it('stops when the caller aborts', async () => {
    const ctrl = new AbortController();
    const client = fakeClient(cooperative);
    const run = generateText(params, { client }, (e) => e.type === 'title' && ctrl.abort(), ctrl.signal);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    const callsAtAbort = client.prompts.length;
    await new Promise((r) => setTimeout(r, 10));
    expect(client.prompts.length).toBe(callsAtAbort);
    expect(client.prompts.some((p) => p.startsWith('Geschichte:'))).toBe(false);
  });
});
