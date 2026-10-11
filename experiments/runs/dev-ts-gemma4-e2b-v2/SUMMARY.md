Set: dev, repeats: 1, targets: 25,35,45, sentences: 10 (title counted in LIX), grammar in loop: model, judge: LanguageTool de-DE (GRAMMAR, CASING, CONFUSED_WORDS; typos apart; title + text judged). Errors count as misses. Gate: hit ≥ 90% and LT-flagged ≤ 10%.
Runner: TypeScript loop (lib/generate). Not 1:1 comparable with the Python runs (8 sentences, no title).

| Model | Runs | Hit rate | Mean abs error | LT-flagged texts | Texts with typo | Calls (median) | Secs (median) | Errors | Gate |
|---|---|---|---|---|---|---|---|---|---|
| gemma4:e2b-it-qat | 15 | 13/15 (87%) | 0.31 | 3/15 | 13/15 | 22 | 13 | 0 | FAIL |
