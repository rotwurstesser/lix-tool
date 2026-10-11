# LIX tool: revival notes

## What LIX is

LIX (Läsbarhetsindex, Björnsson 1968) = words / sentences + 100 × long words / words.
Long word = more than 6 letters. Rough bands: <30 very easy (children), 30-40 easy, 40-50 medium, 50-60 hard, >60 very hard.
It is pure counting, so code can compute it exactly. No model is needed to *measure* it.

## Why the old app struggled

- Old design: the model writes the whole text and must hit exact sentence and long-word counts in one go, then retry up to 5 times.
- LLMs see tokens, not letters. Counting letters per word and planning counts across a whole text is their weak spot.
- The app needed a 70B reasoning model on OpenRouter plus long `<thinking>` blocks: slow and costly.

## Live probe (local gpt-oss:20b, 6 sentences, German)

Throwaway probe script, not kept (one-shot vs sentence by sentence; code holds the budget).

| Target | One-shot | Sentence by sentence (code budget, ≤4 retries per sentence) |
|---|---|---|
| 40 | 49.2 (off by 9) | 40.0 exact, 14 calls, 130 s |
| 25 | (not captured) | 25.9, 15 calls, 86 s |

- Control: solved. Code plans the budget, the model writes one short sentence at a time, code checks and retries.
- New problem: quality. The 20B model broke German grammar to hit word lengths ("ein glänzt Schlüssel") and repeated the opening in every sentence (no plot plan in the probe prompt).
- 2 runs only; not a benchmark.

## Better designs (ranked)

1. **Plan, write, then fix (recommended):** model writes a good story near the level (plot outline first). Code computes LIX per sentence. Code picks the cheapest edits (split or merge a sentence, swap a long word for a short synonym or the other way round) and asks the model for only that one edit. Small, local edits keep grammar intact.
2. **Sentence by sentence with budget (probed above):** exact, but needs a plot outline and a stronger model for clean German.
3. **Constrained decoding (local only):** llama.cpp grammars (GBNF) can force word lengths during generation (e.g. a "short words only" sentence). Exact by construction, but German compounds make it hard to keep it natural. `llama-server` is available locally.
4. **Overgenerate and pick:** write 5-10 candidate sentences locally, code picks the best fit. Cheap with a small model.

## Cost

- Fully local on the dev Mac: 0 API cost (Ollama models present: gpt-oss 20B, qwen3-coder 30B, qwen3-coder-next, minimax-m2.5, glm-5).
- Hosted: designs 1 and 2 need only short calls, so a cheap small model works. No 70B reasoning model needed.

## Jev?

No. Jev writes no text, and LIX is exact math, so no classifier is needed. At most: a readability "does this text suit a 2nd grader?" check beyond LIX. Not worth it.

## Small bugs in `lib/lix-calculator.ts`

- Sentence split on `.` breaks on abbreviations ("z.B.", "Dr.") and numbers ("3.5").
- Hyphenated and numeric tokens count as words; check against the target definition.

## Research (published designs)

V = source read, I = inferred. No paper or tool targets an exact LIX score.

- **Prompting alone misses.** Lexile targets: GPT-3.5 / LLaMA-2-70B / Mixtral within ±50 only 11-22% of the time, skewed too hard (V) https://arxiv.org/html/2406.12787v1 . Zero-shot level control worst at the lowest levels (V) https://arxiv.org/abs/2409.20246
- **Fine-tune + RL works.** CaLM (LLaMA2-7B, SFT + PPO, reward = -(CEFR - target)^2) matched GPT-4 control error 0.39, 0.15 with top-3 sampling, ≥25× cheaper (V) https://arxiv.org/html/2406.03030v1 . ReadCtrl (Mistral-7B) beat GPT-4 in human eval (V) https://arxiv.org/abs/2406.09205
- **Reward hacking:** readability-only reward collapsed to one-sentence texts or junk trailers; needs word-frequency + sentence-length + KL (V) https://arxiv.org/html/2410.17088v2
- **Steered decoding (closest to our need):** FK-steered logits processor, steps in only when running grade error > tolerance; grade MAE 1.945 → 0.649 (best 0.233, 24B), GPT-5.4 1.83, MagicSchool 2.55; 2.5-6× slower; 30 prompts, no code (V) https://questionwell.org/hubfs/Papers/reading-level-paper-llncs-main.pdf . Background: FUDGE https://arxiv.org/pdf/2104.05218 , NeuroLogic A*esque https://aclanthology.org/2022.naacl-main.57
- **Grammars:** llama.cpp GBNF can cap word length (V) https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md ; cannot hit a ratio, and banning long words wrecks German (I).
- **Iterate with metric feedback:** GPT-4o reached FRE ≥ 90 within ≤4 attempts (V) https://arxiv.org/abs/2602.22524 ; Self-Refine ~+20%, needs a strong base model (V) https://arxiv.org/abs/2303.17651v1
- **Overgenerate + rerank per sentence:** TSAR 2025 systems (I) https://preview.aclanthology.org/ingest-emnlp/2025.tsar-1.18.pdf
- **RL with verifiable rewards:** GRPO > DPO for constraints, Tülu-3-8B IFEval 82.4 → 92.2 (V/I) https://arxiv.org/html/2507.02833v1 ; LARFT length following +20.9 (V) https://arxiv.org/abs/2603.19255
- **German:** LIX bands <40 children/youth, 40-50 fiction, 50-60 non-fiction (V) https://www.psychometrica.de/lix.html ; Wiener Sachtextformel WSTF 4 maps to school grade; compounds limit word-length formulas (V) https://de.wikipedia.org/wiki/Lesbarkeitsindex ; libs: `readsight`, `textstat.wiener_sachtextformel` (I). No study of LLM German children's texts scored with LIX (gap).
- **Products:** Diffit "2nd grade" measured as grade 4 (I) https://blog.tcea.org/leveled-texts-diffit/ ; open repo: bio-nlp/ReadCtrl.

### Ranked designs after research

1. Draft, then LIX-guided local edits (split/merge sentence, swap long/short word; model proposes options, code picks). 3-6 calls, cheap. Grammar stays intact. **Prototype first.**
2. LIX-steered logits processor (port of FK-steered), local, one pass, 2.5-6× slower, expect ±1-2 LIX. Combine with 1 for the exact hit.
3. GRPO fine-tune of a 3-8B model, reward -|LIX - target| + fluency/KL + anti-trailer guard. Best unit cost at scale, high setup. Only after 1 and 2 give data.

Open: compound handling (rephrase vs "Haus·tür"), human comprehension check (LIX is a surface metric), no code for FK-steered.

## Prototype: design 1 (`experiments/draft_then_fix.py`)

Local gpt-oss 20B via Ollama, German, 8 sentences, tolerance ±0.5. Cost 0.

| Version | Target 25 | Target 35 | Target 45 |
|---|---|---|---|
| v1 (no filter) | 24.5 hit, 21 calls, 107 s | 37.6 miss, 73 calls, 366 s (draft started at 48.5) | 44.9 hit, 8 calls, 25 s |
| v2 (cheat filter + up to 3 drafts) | 25.1 hit, 28 calls, 92 s | 35.3 hit, 13 calls, 64 s | 44.7 hit, 8 calls, 20 s |

- v1 problem: the model cheated on "use a shorter word" by cutting endings ("verlorenen" → "verlor", "silbernen" → "silber", "rannt").
- v2 fix: reject an edit when a new word fails the macOS German spell checker (`NSSpellChecker`, built in, no install) or is a cut-short removed word. Redraft when the draft starts more than 6 off.
- v2 quality: stories are coherent and readable. About 1 grammar slip per text remains ("ein Freundschaftsband knüpft", "Der kleinen Fuchs", markdown `**`). The spell checker cannot catch wrong word forms.
- 1 run per cell (6 runs total). Not a benchmark.

Next options:
1. Final grammar pass: one call to a stronger model ("fix grammar only, keep words"), then re-check LIX; or LanguageTool locally (needs Java + install: ask first).
2. Strip markdown from drafts.
3. Plug into the app: replace the one-shot loop in `app/api/generate/route.ts` with this flow (OpenRouter cheap model or local Ollama).
4. Batch eval: 20 topics × 5 targets to get a hit rate and a calls/time average.

## Batch eval 1 (`experiments/batch_eval.py`, automated)

5 topics × 3 targets (25/35/45), German, 8 sentences. Results: `experiments/runs/batch-1/`.

| Model | Hit rate (±0.5) | Mean abs error | Calls (median) | Secs (median) | Texts with unknown words |
|---|---|---|---|---|---|
| gpt-oss 20B (13 GB) | 15/15 | 0.31 | 9 | 25 | 4 ("Klap‑Klap", "Bahnhofstation", "trifften", "Schmerzlinderungstropfen") |
| qwopus 9B coder (5.6 GB) | not run: Ollama cannot load the model file ("unable to load model"); also a coder model, poor test subject | | | | |

Small-model test still open: needs a download (e.g. Gemma 3 4B/12B or Qwen3 8B, 3-8 GB). Apple on-device model: German supported, but Apple Intelligence is off on the dev Mac.

## Standalone Mac app (plan at the time)

- Pattern from Handy (cjpais/Handy, Tauri + Rust): model downloaded on first use into the app data folder, sha256 check, resumable download (`src-tauri/src/managers/model.rs`); optional Apple Intelligence backend via Swift FFI (`apple_intelligence.rs`).
- For us: Tauri shell around the existing UI, bundled `llama-server` sidecar (health check, free port, kill on exit), GGUF download on first run; Apple on-device model as zero-download option.
- Unsigned app = Gatekeeper warning on first open; signing needs a paid Apple developer account.

## Held-out eval 1 (2026-10-11)

Run: `experiments/runs/heldout-1/` — 10 held-out topics × targets 25/35/45 × 2 repeats = 60 per model. Judge qwen2.5:72b-instruct-q4_K_M. Errors count as misses (0 errors).

| Model | Hit rate | Mean abs error | Judge-flagged | Calls (median) | Secs (median) | Gate |
|---|---|---|---|---|---|---|
| qwen3:4b-instruct-2507-q4_K_M (2.5 GB) | 57/60 (95%) | 0.25 | 42/60 | 18.5 | 20.5 | FAIL (grammar) |
| gpt-oss:20b-32k (= gpt-oss:20b weights) | 53/60 (88%) | 0.32 | 29/60 | 13 | 31.5 | FAIL (hit + grammar) |

Findings:
- LIX control works for both: every miss within 2.9 of target, most within 1.7.
- Grammar gate fails for both. Judge is noisy: sampled flags include false positives ("Lieblingscouch", "im warmen Haus", correct sentences) and real errors ("schritt für Schritt", "wohlwärmer", "dachte er sich an").
- Next: strict re-judge (`experiments/rejudge.py`: each flag needs correction + rule, drop no-op flags) to separate judge noise from real errors.
- gemma3:4b still untested: needs a newer Ollama than 0.15.6.

### Strict re-judge (2026-10-11)

`experiments/rejudge.py`, same 120 texts, judge must give falsch/richtig/regel. Result: worse, not better. qwen3 4B 50/60 flagged (109 flags), gpt-oss 48/60 (115 flags). Sampled flags are mostly style edits or wrong ("Oma wählte" -> "die Oma wählte", "bot sie ihm" -> "bot ihr ihm", "Schneemann" -> "Schneemanns"). A few are real ("könne" -> "könnte" context, "Klappschaft").
Conclusion: an LLM judge (qwen2.5 72B) is not a usable automated grammar gate. Grammar quality of both models is still unmeasured. Candidate replacement: LanguageTool (rule-based, open source, German, runs locally), as eval judge and possibly in-app checker. Needs install approval.

### Model research (2026-10-11)

No public benchmark measures German grammar in text that small local models generate, so our own eval decides. Evidence:
- EuroEval German (Bielik report, arxiv 2505.02410): Mistral-Small-24B and Gemma-3-27B are top.
- German correction study (arxiv 2505.06004): LLMs over-correct. This explains the false flags from the 72B judge.
- Community, May 2026: Qwen 3.x weak on German grammar; Gemma 4 and Mistral Small 3.2 recommended.

Shortlist (Ollama tags verified on ollama.com 2026-10-11, all Apache 2.0, need an Ollama upgrade from 0.15.6):
- Light: gemma4:e4b-it-qat (6.1 GB), gemma4:e2b-it-qat (4.3 GB), ministral-3:8b (6.0 GB) / :3b (3.0 GB).
- Full: gemma4:26b-a4b-it-qat (16 GB, MoE, fast), mistral-small3.2:24b (15 GB), gemma4:31b-it-qat (19 GB, tight on 32 GB).
- Grammar gate: LanguageTool (brew 6.8, needs OpenJDK 17) first; LLM JA/NEIN only on sentences that LanguageTool flags. Not verified: whether it catches weak masculine nouns ("dem Hase").

### Gemma 4 run paused (2026-10-11)

Setup: separate Ollama 0.40.0 on an external disk (`$LIX_OLLAMA_DIR`, checksum verified), models in `$LIX_OLLAMA_DIR/models`, port 11435. Main brew Ollama 0.15.6 untouched. Generator URL via env `LIX_OLLAMA`.
Smoke test gemma4:e2b-it-qat: LIX 29.9 (target 30), hit, 37 calls, 30 s; German slips ("das vielleicht Finn sein Geräusch war").
gemma4:e2b full run finished before the pause: 59/60 hit (98%), MAE 0.43, judge-flagged 36/60 (noisy judge), median 24 calls / 21 s, 0 errors (`runs/heldout-gemma4-e2b/`). gemma4:e4b is pulled; its run was paused (fan noise), partial in `runs/heldout-gemma4-e4b-partial/`. Resume tomorrow:
1. `OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=$LIX_OLLAMA_DIR/models $LIX_OLLAMA_DIR/bin/ollama serve`
2. `LIX_OLLAMA=http://127.0.0.1:11435 python3 -I batch_eval.py runs/heldout-gemma4-e4b qwen2.5:72b-instruct-q4_K_M heldout 2 gemma4:e4b-it-qat`
Pending: LanguageTool install approval (grammar recheck).

### LanguageTool recheck (2026-10-11)

LanguageTool 6.8 (brew), local server on port 8081, `experiments/ltcheck.py`, results in `experiments/LTCHECK.md`.
Sanity: catches "dem Hase", "schritt für Schritt", "wohlwärmer", "habe ... gegangen"; no flag on a correct sentence.

| Model | Hit | Texts with grammar error (LT) | Invented words (typo flags minus names) |
|---|---|---|---|
| gemma4:e2b-it-qat | 59/60 | 3/60 | none ("weisse" = Swiss spelling) |
| qwen3:4b-instruct-2507 | 57/60 | 5/60 | Wärmestraung, dichtwürdigen, minutenklein, wohlwärmer, schnuffelte |
| gpt-oss:20b-32k | 53/60 | 4/60 | verlangsam |

Conclusion: real grammar rate is about 5-8% of texts, not 50-80% as the LLM judge said. gemma4:e2b passes the gate (hit >= 90%, grammar-flagged <= 10%) with LanguageTool as judge. LT recall is not measured (it can miss errors), so this is a lower bound.

### gemma4:e4b-it-qat (2026-10-11)

`runs/heldout-gemma4-e4b/`: 55/60 hit (92%), MAE 0.28, median 22.5 calls / 28.5 s, 0 errors. LanguageTool: 4/60 texts with grammar error. Invented words: Rauchstupser, Stolperereien, Zimtes, Keksbäcker-Backofen, schieferbedeckte (mix of real errors and valid rare compounds).
Verdict: e4b is not better than e2b (lower hit rate, slower, more invented words), so it brings no gain for its +1.8 GB. Light model = gemma4:e2b-it-qat.
Servers stopped after the run (separate Ollama, LanguageTool).

### TypeScript eval runner, held-out (2026-10-11)

`node experiments/eval/run.ts --set heldout --repeats 2 --targets 25,35,45 --sentences 10 --ollama http://127.0.0.1:11435 --model gemma4:e2b-it-qat --grammar model --out experiments/runs/heldout-ts-gemma4-e2b`. Judge: LanguageTool de-DE (GRAMMAR, CASING, CONFUSED_WORDS), title + text judged.
Note: the TS loop writes 10 sentences and counts the title in LIX. The Python runs above used 8 sentences and no title, so results are not 1:1 comparable.

| Model | Runs | Hit rate | Mean abs error | LT-flagged texts | Texts with typo | Calls (median) | Secs (median) | Errors | Gate |
|---|---|---|---|---|---|---|---|---|---|
| gemma4:e2b-it-qat | 60 | 49/60 (82%) | 0.78 | 6/60 | 60/60 | 35 | 30 | 0 | FAIL |

Verdict: gate FAIL on hit rate (82% < 90%); grammar passes (6/60 = 10%, at the limit). Misses sit at target 25 (10/20 hit; 35: 19/20, 45: 20/20), mostly LIX 26-28 with 11-12 sentences. Typos 60/60 = Swiss "ss" spelling (grossen, Spass) plus names under de-DE, not real errors. The app integration is on hold until this is resolved.

v2 fix (lib/generate, tuned on the dev set only):
- Draft prompt: words-per-sentence hint = max(5, round(target − 17)) below LIX 35 (target / 2 from 35, no jump at 35); below LIX 30 it also asks for short, simple words (mostly ≤ 6 letters). target − 20 was tried first: on dev, drafts for target 25 started too low (LIX 10-22) and 3/5 hit; target − 17 hit 10/10 at target 25 on dev.
- Edit budget per fix loop = clamp(ceil(|gap after draft| / 0.7) + 4, 12, 24), was a fixed 12.

| Run | Runs | Hit rate | Mean abs error | LT-flagged texts | Texts with typo | Calls (median) | Secs (median) | Errors | Gate |
|---|---|---|---|---|---|---|---|---|---|
| dev, target − 20 (25/35/45 × 1) | 15 | 13/15 (87%) | 0.31 | 3/15 | 13/15 | 22 | 13 | 0 | FAIL |
| dev, target − 17, target 25 only × 2 | 10 | 10/10 (100%) | 0.26 | 0/10 | 10/10 | 17 | 8 | 0 | PASS |
| held-out v2 (`runs/heldout-ts-gemma4-e2b-v2/`) | 60 | 56/60 (93%) | 0.30 | 5/60 | 57/60 | 19 | 14 | 0 | PASS |

Held-out per target, v1 → v2: 25: 10/20 → 19/20; 35: 19/20 → 17/20; 45: 20/20 → 20/20. Median calls 35 → 19, secs 30 → 14.
Verdict v2: gate PASS (93% hit, 5/60 = 8% LT-flagged). 3 of 4 misses are at target 35 with 12 sentences (band limit blocks more splits). The app integration can start.

### LanguageTool in the app (2026-10-11)

Bundle: LanguageTool 6.6 zip (252 MB, sha256 measured by us: languagetool.org publishes none) + Temurin JRE 21.0.12.1+1 aarch64 (48 MB, Adoptium sha256), pinned in `src-tauri/resources/grammar-manifest.json`. Downloaded on consent into `<app data>/grammar/`, sha256 checked while streaming, unpacked, archives deleted. Unpacked size about 560 MB (LanguageTool 405 MB with all languages, JRE 158 MB); the setup text says "about 300 MB" (the download).
Language: de-CH. Checked on LT 6.6: accepts "grossen" and "Spass", flags "Er gab dem Hase eine Karotte." as DE_AGREEMENT (GRAMMAR), same "habe ... gegangen" catch as de-DE. So no de-DE fallback is needed.
Server: `java -Xmx512m -cp languagetool-server.jar org.languagetool.server.HTTPServer --port <8181+>`, binds 127.0.0.1 only, started on the first check, stopped after the idle time (keep-alive setting, at least 30 s) and on app exit. The webview reaches it through the Rust command `grammar_check`, so no CORS origin is needed.

RAM (`cargo run --example grammar_cli`, `ps -o rss` sampled every 100 ms during 22 checks):

| Measure | Value |
|---|---|
| JVM RSS, peak during checks | 765 MB (second run 761 MB) |
| Start to ready | 1.7 s; first check 4.0-4.2 s (loads German) |
| Check of a 4-sentence text | about 550 ms |
| After idle (30 s floor, `--idle-test`) | process gone after 31 s, `pgrep` empty |
| After stop (what the app does on exit) | `pgrep -fl <bundled java>` empty |

Peak RAM with both: about 4.3 GB (model) + 0.77 GB (LanguageTool) ≈ 5.1 GB.

Held-out run with LanguageTool in the loop (`runs/heldout-ts-gemma4-e2b-lt/`):
`node experiments/eval/run.ts --set heldout --repeats 2 --targets 25,35,45 --sentences 10 --ollama http://127.0.0.1:11435 --model gemma4:e2b-it-qat --grammar languagetool --lt http://127.0.0.1:8081 --lt-loop http://127.0.0.1:8181 --out experiments/runs/heldout-ts-gemma4-e2b-lt`.
Loop checker: bundled LT 6.6 de-CH (`grammar_cli --serve`). Judge: brew LT 6.8 de-DE on 8081, same judge as the baseline.

| Run | Runs | Hit rate | Mean abs error | LT-flagged texts | Calls (median) | Secs (median) | Errors | Gate |
|---|---|---|---|---|---|---|---|---|
| held-out v2, model check (baseline) | 60 | 56/60 (93%) | 0.30 | 5/60 | 19 | 14 | 0 | PASS |
| held-out, LanguageTool in loop | 60 | 58/60 (97%) | 0.22 | 3/60 | 16.5 | 13 | 0 | PASS |

Per target: 25: 20/20, 35: 18/20, 45: 20/20. Both misses: target 35, LIX 36, 12 sentences (band limit, as in v2). Repair calls in 7 of 60 texts (9 calls). The loop left findings in 4 texts; the judge flagged 3 of them (NACHDEM_PRAETERITUM "fühlte", DE_AGREEMENT "Ein freundlicher Giraffe", DAS_BESTE "schönste"): the 2B model did not fix them in 2 rounds. These remain in the result as `grammarIssues` for underlines.

App live run (debug build, `LIX_APP_DATA` on an external disk, `LIX_AUTOTEST`): setup grammar step → Add → installed (from a local cache) → generator → one generation with LanguageTool (LIX 31.9, miss; second run 30.4 hit). With keep-alive 30s: LanguageTool gone 32 s after the last check, `/api/ps` empty. Quit while LanguageTool ran: no Ollama, llama-server or java process left. Second setup run without the cache: real download from GitHub and languagetool.org, sha256 checked, installed in about 70 s. Remove in the generator's grammar card deleted `<app data>/grammar`. JVM RSS in the app: 763 MB peak.
