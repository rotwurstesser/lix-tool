// Shared parts of the TypeScript eval runner: arguments, topic sets, LanguageTool judge, summary math.
// Same protocol as experiments/batch_eval.py, with LanguageTool (experiments/ltcheck.py) as the judge.

// Copied verbatim from batch_eval.py.
export const TOPICS = {
  dev: [
    'ein Fuchs, der im Wald einen verlorenen Schlüssel findet',
    'ein Mädchen, das zum ersten Mal Zug fährt',
    'ein Roboter, der Fussball lernen will',
    'zwei Freunde, die im Garten einen Igel retten',
    'ein Junge, der Angst vor dem Gewitter hat',
  ],
  // Written before tuning; do not change after the first heldout run.
  heldout: [
    'eine Katze, die auf dem Dach festsitzt',
    'ein Kind, das seinen ersten Zahn verliert',
    'ein Ausflug mit der Klasse in den Zoo',
    'ein Drache, der nicht Feuer speien kann',
    'eine Oma, die das Handy nicht versteht',
    'ein Hund, der beim Bäcker wartet',
    'ein Schneemann, der im Frühling schmilzt',
    'zwei Geschwister, die ein Zelt aufbauen',
    'ein Mädchen, das ein Baumhaus baut',
    'ein Pinguin, der zum ersten Mal schwimmt',
  ],
} as const;

export type TopicSet = keyof typeof TOPICS;
export type GrammarMode = 'model' | 'languagetool';

export interface EvalArgs {
  set: TopicSet;
  repeats: number;
  targets: number[];
  sentences: number;
  ollama: string;
  model: string;
  out: string;
  grammar: GrammarMode;
  // Judge server (de-DE).
  lt: string;
  // Server for the in-loop checker with --grammar languagetool (de-CH). Default: the judge server.
  ltLoop: string;
}

export const DEFAULT_LT = 'http://127.0.0.1:8081';
// LanguageTool categories that count as a grammar error. TYPOS is reported apart: names trigger the speller.
export const LT_GRAMMAR = new Set(['GRAMMAR', 'CASING', 'CONFUSED_WORDS']);
export const GATE_HIT = 0.9;
export const GATE_FLAGGED = 0.1;

function positiveInt(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} needs a positive integer, got "${value}"`);
  return n;
}

export function parseArgs(argv: string[]): EvalArgs {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument "${key}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} needs a value`);
    raw[key.slice(2)] = value;
    i++;
  }
  const known = ['set', 'repeats', 'targets', 'sentences', 'ollama', 'model', 'out', 'grammar', 'lt', 'lt-loop'];
  for (const k of Object.keys(raw)) if (!known.includes(k)) throw new Error(`Unknown option --${k}`);
  for (const k of ['set', 'model', 'out']) if (!raw[k]) throw new Error(`--${k} is required`);
  if (!(raw.set in TOPICS)) throw new Error(`--set must be heldout or dev, got "${raw.set}"`);
  const grammar = raw.grammar ?? 'model';
  if (grammar !== 'model' && grammar !== 'languagetool') {
    throw new Error(`--grammar must be model or languagetool, got "${grammar}"`);
  }
  return {
    set: raw.set as TopicSet,
    repeats: positiveInt('repeats', raw.repeats ?? '1'),
    targets: (raw.targets ?? '25,35,45').split(',').map((t) => positiveInt('targets', t.trim())),
    sentences: positiveInt('sentences', raw.sentences ?? '10'),
    ollama: raw.ollama ?? 'http://127.0.0.1:11434',
    model: raw.model,
    out: raw.out,
    grammar,
    lt: raw.lt ?? DEFAULT_LT,
    ltLoop: raw['lt-loop'] ?? raw.lt ?? DEFAULT_LT,
  };
}

export interface LtMatch {
  message: string;
  rule: { id: string; category: { id: string } };
  context: { text: string; offset: number; length: number };
}

export class LanguageTool {
  readonly url: string;

  constructor(url: string) {
    this.url = url.replace(/\/+$/, '');
  }

  // Throws with a clear message when the server does not answer.
  async ping(): Promise<void> {
    try {
      const res = await fetch(`${this.url}/v2/languages`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      throw new Error(
        `LanguageTool is not reachable at ${this.url} (${(err as Error).message}). ` +
          'Start it: languagetool-server --port 8081',
      );
    }
  }

  async check(text: string, signal?: AbortSignal): Promise<LtMatch[]> {
    const res = await fetch(`${this.url}/v2/check`, {
      method: 'POST',
      body: new URLSearchParams({ text, language: 'de-DE' }),
      // Keep the per-request timeout also when the caller passes its own signal.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LanguageTool check failed (${res.status})`);
    return ((await res.json()) as { matches: LtMatch[] }).matches;
  }
}

export function snippet(m: LtMatch): string {
  return m.context.text.slice(m.context.offset, m.context.offset + m.context.length);
}

export function judgeMatches(matches: LtMatch[]) {
  const grammar = matches.filter((m) => LT_GRAMMAR.has(m.rule.category.id));
  const typos = matches.filter((m) => m.rule.category.id === 'TYPOS');
  return { grammar: grammar.length, typos: typos.length, examples: grammar.map(snippet), typoWords: typos.map(snippet) };
}

export interface ResultRow {
  model: string;
  topic: string;
  target: number;
  repeat: number;
  set: string;
  hit: boolean;
  lix?: number;
  calls?: number;
  secs?: number;
  ltGrammar?: number;
  ltTypos?: number;
  error?: string;
}

export interface Summary {
  runs: number;
  hits: number;
  hitRate: number;
  mae: number | undefined;
  flagged: number;
  typoTexts: number;
  flagRate: number;
  callsMedian: number | undefined;
  secsMedian: number | undefined;
  errors: number;
  pass: boolean;
}

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Same math as batch_eval.py: errors count as misses and as flagged texts in the gate.
export function summarize(rows: ResultRow[]): Summary {
  const ok = rows.filter((r) => !r.error && r.lix !== undefined);
  const hits = ok.filter((r) => r.hit).length;
  const flagged = ok.filter((r) => (r.ltGrammar ?? 0) > 0).length;
  const errors = rows.length - ok.length;
  const hitRate = rows.length ? hits / rows.length : 0;
  const flagRate = rows.length ? (flagged + errors) / rows.length : 1;
  const mae = ok.length ? ok.reduce((sum, r) => sum + Math.abs(r.lix! - r.target), 0) / ok.length : undefined;
  return {
    runs: rows.length,
    hits,
    hitRate,
    mae,
    flagged,
    typoTexts: ok.filter((r) => (r.ltTypos ?? 0) > 0).length,
    flagRate,
    callsMedian: median(ok.map((r) => r.calls!)),
    secsMedian: median(ok.map((r) => r.secs!)),
    errors,
    pass: hitRate >= GATE_HIT && flagRate <= GATE_FLAGGED,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const opt = (x: number | undefined, digits?: number) =>
  x === undefined ? '-' : digits === undefined ? String(x) : x.toFixed(digits);

export function summaryMarkdown(args: EvalArgs, s: Summary): string {
  return [
    `Set: ${args.set}, repeats: ${args.repeats}, targets: ${args.targets.join(',')}, sentences: ${args.sentences} ` +
      `(title counted in LIX), grammar in loop: ${args.grammar === 'languagetool' ? 'languagetool (de-CH, final check + repair)' : 'model'}, judge: LanguageTool de-DE ` +
      `(GRAMMAR, CASING, CONFUSED_WORDS; typos apart; title + text judged). Errors count as misses. ` +
      `Gate: hit ≥ 90% and LT-flagged ≤ 10%.`,
    'Runner: TypeScript loop (lib/generate). Not 1:1 comparable with the Python runs (8 sentences, no title).',
    '',
    '| Model | Runs | Hit rate | Mean abs error | LT-flagged texts | Texts with typo | Calls (median) | Secs (median) | Errors | Gate |',
    '|---|---|---|---|---|---|---|---|---|---|',
    `| ${args.model} | ${s.runs} | ${s.hits}/${s.runs} (${pct(s.hitRate)}) | ${opt(s.mae, 2)} | ${s.flagged}/${s.runs} | ` +
      `${s.typoTexts}/${s.runs} | ${opt(s.callsMedian)} | ${opt(s.secsMedian)} | ${s.errors} | ${s.pass ? 'PASS' : 'FAIL'} |`,
    '',
  ].join('\n');
}
