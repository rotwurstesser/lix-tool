// Live smoke test of the TypeScript generation loop against a local Ollama.
// Usage: LIX_OLLAMA=http://127.0.0.1:11435 node experiments/eval/smoke.ts [model]
// Prints one JSON line per topic and a summary. Exit code 1 when fewer than 2 of 3 topics hit the target.
import { OllamaClient } from '../../lib/generate/client.ts';
import { generateText } from '../../lib/generate/loop.ts';
import { MacSpellChecker } from '../../lib/generate/spell-node.ts';

const OLLAMA = process.env.LIX_OLLAMA ?? 'http://127.0.0.1:11434';
const MODEL = process.argv[2] ?? 'gemma4:e2b-it-qat';
const TARGET = 30;
const TOPICS = [
  'eine Katze, die auf einen hohen Baum klettert und nicht mehr herunterkommt',
  'zwei Kinder, die am See ein altes Boot finden',
  'einen Igel, der im Herbst ein warmes Haus für den Winter sucht',
];

const client = new OllamaClient(OLLAMA, MODEL);
const spell = new MacSpellChecker();
let hits = 0;
for (const topic of TOPICS) {
  const res = await generateText({ topic, targetLix: TARGET, sentences: 10 }, { client, spell });
  if (res.hit) hits++;
  console.log(
    JSON.stringify({
      topic,
      hit: res.hit,
      lix: res.lix,
      secs: res.secs,
      sentences: res.sentences.length,
      sentenceCountOk: res.sentenceCountOk,
      calls: res.calls,
      path: res.lixPath,
      title: res.title,
      unknown: res.unknownWords,
      text: res.sentences.join(' '),
    }),
  );
}
await client.unload();
console.log(JSON.stringify({ model: MODEL, server: OLLAMA, target: TARGET, hits, of: TOPICS.length }));
process.exitCode = hits >= 2 ? 0 : 1;
