// Headless eval of the TypeScript generation loop. Same protocol as experiments/batch_eval.py.
// Usage: node experiments/eval/run.ts --set heldout|dev --repeats N --targets 25,35,45 --sentences 10
//          --ollama URL --model TAG --out DIR [--grammar model|languagetool] [--lt URL] [--lt-loop URL]
// --lt is the judge (de-DE); --lt-loop the server the loop checks with (de-CH), default the judge server.
// Writes one JSON line per story to DIR/results.jsonl and DIR/SUMMARY.md. DIR must not hold an earlier run.
// Exit code 1 on gate FAIL, 2 on a setup error.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OllamaClient } from '../../lib/generate/client.ts';
import { HttpLanguageTool, LanguageToolChecker } from '../../lib/generate/languagetool.ts';
import { generateText } from '../../lib/generate/loop.ts';
import { MacSpellChecker } from '../../lib/generate/spell-node.ts';
import {
  judgeMatches,
  LanguageTool,
  parseArgs,
  type ResultRow,
  summarize,
  summaryMarkdown,
  TOPICS,
} from './eval.ts';

// Same per-story limit as batch_eval.py.
const STORY_TIMEOUT_MS = 1_800_000;

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

const lt = new LanguageTool(args.lt);
try {
  await lt.ping();
  if (args.grammar === 'languagetool') await new LanguageTool(args.ltLoop).ping();
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

mkdirSync(args.out, { recursive: true });
const log = join(args.out, 'results.jsonl');
if (existsSync(log)) {
  // SUMMARY.md describes one run only, so results of two runs must not mix.
  console.error(`${log} already exists. Use a new --out directory.`);
  process.exit(2);
}
const client = new OllamaClient(args.ollama, args.model);
const spell = new MacSpellChecker();
const grammar = args.grammar === 'languagetool' ? new LanguageToolChecker(new HttpLanguageTool(args.ltLoop)) : undefined;
const topics = TOPICS[args.set];
const total = args.repeats * topics.length * args.targets.length;
const rows: ResultRow[] = [];

for (let repeat = 0; repeat < args.repeats; repeat++) {
  for (const topic of topics) {
    for (const target of args.targets) {
      const base = { model: args.model, topic, target, repeat, set: args.set, sentences: args.sentences };
      let row: ResultRow & Record<string, unknown>;
      try {
        const res = await generateText(
          { topic, targetLix: target, sentences: args.sentences },
          { client, spell, grammar },
          undefined,
          AbortSignal.timeout(STORY_TIMEOUT_MS),
        );
        const text = res.sentences.join(' ');
        row = {
          ...base,
          hit: res.hit,
          lix: res.lix,
          calls: res.calls,
          secs: res.secs,
          sentenceCount: res.sentences.length,
          sentenceCountOk: res.sentenceCountOk,
          rejected: res.rejected,
          grammarRejected: res.grammarRejected,
          repairs: res.repairs,
          loopGrammarIssues: res.grammarIssues.map((i) => `${i.ruleId ?? ''}: ${i.snippet}`),
          lixPath: res.lixPath,
          unknownWords: res.unknownWords,
          title: res.title,
          text,
        };
        if (!res.sentences.length) row.error = 'no usable draft';
      } catch (err) {
        row = { ...base, hit: false, error: String((err as Error).message ?? err).slice(-300) };
      }
      // The judge is part of the measurement: a LanguageTool failure stops the run instead of counting as a miss.
      let judgeError: unknown;
      if (!row.error) {
        try {
          const j = judgeMatches(await lt.check(`${row.title}\n\n${row.text}`));
          Object.assign(row, { ltGrammar: j.grammar, ltTypos: j.typos, ltExamples: j.examples, ltTypoWords: j.typoWords });
        } catch (err) {
          judgeError = err;
          row.judgeError = String((err as Error).message ?? err).slice(-300);
        }
      }
      rows.push(row);
      appendFileSync(log, JSON.stringify(row) + '\n');
      if (judgeError) {
        // Save the story first, then stop the run: a missing judgement must not count as a pass or a miss.
        await client.unload().catch(() => {});
        throw judgeError;
      }
      console.log(
        `[${rows.length}/${total}] target ${target} rep ${repeat} ` +
          (row.error ? `ERROR ${row.error}` : `lix ${row.lix} hit ${row.hit} lt ${row.ltGrammar} secs ${row.secs}`),
      );
    }
  }
}

try {
  await client.unload();
} catch (err) {
  console.error(`Unload failed: ${(err as Error).message}`);
}
const summary = summarize(rows);
const md = summaryMarkdown(args, summary);
writeFileSync(join(args.out, 'SUMMARY.md'), md);
console.log(md);
process.exitCode = summary.pass ? 0 : 1;
