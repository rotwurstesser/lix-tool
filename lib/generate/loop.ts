// Draft a German children's story, then reach the LIX target with small sentence edits.
// Port of experiments/draft_then_fix.py (v3). The model writes whole sentences only; code computes LIX,
// ranks the edits and keeps the candidate that lands closest to the target.
import { countWords, lix, round1, splitSentences, swissSpelling, targetTimeSeconds, words } from '../lix.ts';
import type { LlmClient } from './client.ts';
import { bandPenalty, cleanEdit, editOptions, SENTENCE_BAND } from './edits.ts';
import { type GrammarChecker, type GrammarIssue, ModelGrammarChecker } from './grammar.ts';
import { parseTitle, parseVariants } from './parse.ts';
import { draftPrompt, editPrompt, grammarFixPrompt, grammarRepairPrompt, titlePrompt } from './prompts.ts';
import { CachedSpellChecker, NoopSpellChecker, type SpellChecker } from './spell.ts';

export const MAX_DRAFTS = 3;
export const DEFAULT_TOLERANCE = 0.5;
// Edit budget per fix loop: scales with the gap after the draft, because one edit moves LIX by about 0.7.
export const MIN_EDITS = 12;
export const MAX_EDITS = 24;
export function editBudget(gap: number): number {
  return Math.min(MAX_EDITS, Math.max(MIN_EDITS, Math.ceil(Math.abs(gap) / 0.7) + 4));
}
// Grammar check: how many improving candidates to try before the fix loop stops.
export const GRAMMAR_TRIES = 3;
// Final grammar check (LanguageTool): rounds of repair calls plus LIX repair.
export const REPAIR_ROUNDS = 2;

interface Candidate {
  score: number;
  start: number;
  count: number;
  next: string[];
}

export interface GenerateParams {
  topic: string;
  targetLix: number;
  sentences: number;
  tolerance?: number;
  // Default: editBudget() of the gap after the draft and title.
  maxEdits?: number;
}

export interface LoopDeps {
  client: LlmClient;
  spell?: SpellChecker;
  // Default: the model's own JA/NEIN check.
  grammar?: GrammarChecker;
  // Rounds of the final grammar check and repair. Default: REPAIR_ROUNDS with an own grammar
  // checker (LanguageTool), 0 with the model check.
  repairRounds?: number;
  now?: () => number;
}

export interface LoopEvent {
  type: 'draft' | 'title' | 'edit' | 'grammar' | 'repair' | 'done';
  lix?: number;
  n?: number;
  elapsedMs: number;
}

export interface GenerateResult {
  title: string;
  sentences: string[];
  // LIX the teacher's way (title counted), one decimal.
  lix: number;
  hit: boolean;
  // Sentence count is within the requested count ±2.
  sentenceCountOk: boolean;
  words: number;
  targetTimeSeconds: number;
  lixPath: number[];
  calls: number;
  rejected: number;
  grammarRejected: number;
  // Repair calls of the final grammar check.
  repairs: number;
  // Findings of the final grammar check that remain (for underlines). Empty without a final check.
  grammarIssues: GrammarIssue[];
  secs: number;
  unknownWords: string[];
}

export async function generateText(
  params: GenerateParams,
  deps: LoopDeps,
  onEvent: (e: LoopEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const { topic, targetLix: target, sentences: count } = params;
  const tolerance = params.tolerance ?? DEFAULT_TOLERANCE;
  let maxEdits = MIN_EDITS; // set after the title
  const now = deps.now ?? Date.now;
  const t0 = now();
  const spell = new CachedSpellChecker(deps.spell ?? new NoopSpellChecker());
  const stats = { calls: 0, rejected: 0, grammarRejected: 0, edits: 0, repairs: 0 };
  let title = '';

  const emit = (type: LoopEvent['type'], extra: Omit<LoopEvent, 'type' | 'elapsedMs'> = {}) =>
    onEvent({ type, ...extra, elapsedMs: now() - t0 });

  // All model output gets Swiss spelling before any count: ß -> ss changes word lengths.
  const ask = async (prompt: string): Promise<string> => {
    signal?.throwIfAborted();
    stats.calls++;
    const raw = await deps.client.generate(prompt, { signal });
    signal?.throwIfAborted();
    return swissSpelling(raw);
  };
  const grammar = deps.grammar ?? new ModelGrammarChecker({ generate: (p) => ask(p) });

  const unknownWords = async (sents: string[]): Promise<string[]> => {
    const ws = words(sents.join(' '));
    await spell.prime(ws);
    return ws.filter((w) => !spell.isKnown(w));
  };
  const gapOf = (sents: string[]) => Math.abs(lix(sents, { title }) - target);
  // Same score as the prototype, plus one point per sentence outside the allowed band.
  const scoreOf = async (sents: string[]) =>
    gapOf(sents) + 2 * (await unknownWords(sents)).length + bandPenalty(sents.length, count);

  const draft = async (): Promise<string[]> => {
    let best: { score: number; sents: string[] } | undefined;
    for (let d = 1; d <= MAX_DRAFTS; d++) {
      const sents = splitSentences(await ask(draftPrompt(topic, count, target)));
      emit('draft', { n: d, lix: round1(lix(sents)) });
      if (sents.length < 2) continue; // empty or unusable output
      const unknown = (await unknownWords(sents)).length;
      const score = Math.abs(lix(sents) - target) + 3 * unknown + bandPenalty(sents.length, count);
      if (!best || score < best.score) best = { score, sents };
      if (Math.abs(lix(sents) - target) <= 6 && !unknown) break;
    }
    return best?.sents ?? [];
  };

  const fixLoop = async (start: string[], checkGrammar: boolean, path: number[]): Promise<string[]> => {
    let sents = start;
    for (let e = 0; e < maxEdits; e++) {
      if (gapOf(sents) <= tolerance && !(await unknownWords(sents)).length) break;
      const flagged = new Set<number>();
      for (const [i, s] of sents.entries()) if ((await unknownWords([s])).length) flagged.add(i);
      // Candidates in the order found; sorted by score below (stable, so the first found wins ties).
      const cands: Candidate[] = [];
      for (const opt of editOptions(sents, { target, title, flagged, requested: count })) {
        const targetText = sents.slice(opt.start, opt.start + opt.count).join(' ');
        const raw = await ask(editPrompt(sents.join(' '), opt.instruction, targetText));
        for (const cand of parseVariants(raw)) {
          const split = splitSentences(cand);
          const next = split.length ? split : [cand];
          await spell.prime(words(next.join(' ')));
          if (!cleanEdit(targetText, next, (w) => spell.isKnown(w))) {
            stats.rejected++;
            continue;
          }
          const trial = [...sents.slice(0, opt.start), ...next, ...sents.slice(opt.start + opt.count)];
          cands.push({ score: await scoreOf(trial), start: opt.start, count: opt.count, next });
        }
        if (cands.some((c) => c.score <= tolerance)) break;
      }
      const current = await scoreOf(sents);
      const better = cands.filter((c) => c.score < current).sort((x, y) => x.score - y.score);
      if (!better.length) break; // no candidate is better than the current text
      let best: Candidate | undefined = better[0];
      if (checkGrammar) {
        // Try the best few candidates in order; take the first that passes the grammar check.
        best = undefined;
        for (const c of better.slice(0, GRAMMAR_TRIES)) {
          if (!(await grammar.check(c.next, { signal, firstOnly: true })).length) {
            best = c;
            break;
          }
        }
        if (!best) {
          stats.grammarRejected++;
          break;
        }
      }
      sents = [...sents.slice(0, best.start), ...best.next, ...sents.slice(best.start + best.count)];
      path.push(round1(lix(sents, { title })));
      emit('edit', { n: ++stats.edits, lix: path[path.length - 1] });
    }
    return sents;
  };

  // One repair call per flagged sentence. A repair with unknown or cut words keeps the old sentence.
  // Returns null when no sentence changed.
  const repair = async (sents: string[], issues: GrammarIssue[]): Promise<string[] | null> => {
    const out: string[][] = sents.map((s) => [s]);
    let changed = false;
    for (const index of [...new Set(issues.map((i) => i.index))]) {
      const old = sents[index];
      stats.repairs++;
      const fixed = parseVariants(await ask(grammarRepairPrompt(old, issues.filter((i) => i.index === index))))[0];
      if (!fixed || fixed === old) continue;
      const split = splitSentences(fixed);
      const next = split.length ? split : [fixed];
      await spell.prime(words(next.join(' ')));
      if (next.length > 2 || !cleanEdit(old, next, (w) => spell.isKnown(w), { allowInflection: true })) {
        stats.rejected++;
        continue;
      }
      out[index] = next;
      changed = true;
    }
    return changed ? out.flat() : null;
  };

  // Fewer grammar findings first, then the closer LIX: never trade grammar for LIX.
  const better = (a: { sents: string[]; issues: GrammarIssue[] }, b: { sents: string[]; issues: GrammarIssue[] }) =>
    a.issues.length !== b.issues.length ? a.issues.length < b.issues.length : gapOf(a.sents) < gapOf(b.sents);

  const result = (sents: string[], lixPath: number[], unknown: string[], grammarIssues: GrammarIssue[] = []): GenerateResult => {
    const final = sents.length ? lix(sents, { title }) : 0;
    const wordCount = sents.length ? countWords(sents, { title }) : 0;
    return {
      title,
      sentences: sents,
      lix: round1(final),
      hit: sents.length > 0 && Math.abs(final - target) <= tolerance,
      sentenceCountOk: sents.length > 0 && Math.abs(sents.length - count) <= SENTENCE_BAND,
      words: wordCount,
      targetTimeSeconds: targetTimeSeconds(wordCount),
      lixPath,
      calls: stats.calls,
      rejected: stats.rejected,
      grammarRejected: stats.grammarRejected,
      repairs: stats.repairs,
      grammarIssues,
      secs: Math.round((now() - t0) / 1000),
      unknownWords: unknown,
    };
  };

  let sents = await draft();
  if (!sents.length) {
    emit('done', { lix: 0 });
    return result([], [], []);
  }

  title = parseTitle(await ask(titlePrompt(sents.join(' '))));
  const path = [round1(lix(sents, { title }))];
  maxEdits = params.maxEdits ?? editBudget(gapOf(sents));
  emit('title', { lix: path[0] });

  sents = await fixLoop(sents, false, path);
  // Grammar pass, then repair LIX again with a grammar check on every accepted edit.
  const fixed = splitSentences(await ask(grammarFixPrompt(sents.join(' '))));
  if (fixed.length >= sents.length - 1) {
    sents = fixed;
    path.push(round1(lix(sents, { title })));
  }
  emit('grammar', { lix: round1(lix(sents, { title })) });
  sents = await fixLoop(sents, true, path);

  // Final grammar check: repair flagged sentences, re-check, repair LIX with the grammar rule.
  const rounds = deps.repairRounds ?? (deps.grammar ? REPAIR_ROUNDS : 0);
  let issues: GrammarIssue[] = [];
  if (rounds > 0) {
    let best = { sents, issues: await grammar.check(sents, { signal }) };
    let current = best;
    for (let round = 1; round <= rounds && current.issues.length; round++) {
      const repaired = await repair(current.sents, current.issues);
      if (!repaired) break;
      current = { sents: repaired, issues: await grammar.check(repaired, { signal }) };
      path.push(round1(lix(current.sents, { title })));
      emit('repair', { n: round, lix: path[path.length - 1] });
      if (better(current, best)) best = current;
      if (gapOf(current.sents) > tolerance) {
        const relixed = await fixLoop(current.sents, true, path);
        if (relixed !== current.sents) {
          current = { sents: relixed, issues: await grammar.check(relixed, { signal }) };
          if (better(current, best)) best = current;
        }
      }
    }
    sents = best.sents;
    issues = best.issues;
    const final = round1(lix(sents, { title }));
    if (path[path.length - 1] !== final) path.push(final);
  }

  const out = result(sents, path, await unknownWords(sents), issues);
  emit('done', { lix: out.lix });
  return out;
}
