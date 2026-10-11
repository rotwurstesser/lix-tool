Set: heldout, repeats: 2, targets: 25,35,45, sentences: 10 (title counted in LIX), grammar in loop: model, judge: LanguageTool de-DE (GRAMMAR, CASING, CONFUSED_WORDS; typos apart; title + text judged). Errors count as misses. Gate: hit ≥ 90% and LT-flagged ≤ 10%.
Runner: TypeScript loop (lib/generate). Not 1:1 comparable with the Python runs (8 sentences, no title).

| Model | Runs | Hit rate | Mean abs error | LT-flagged texts | Texts with typo | Calls (median) | Secs (median) | Errors | Gate |
|---|---|---|---|---|---|---|---|---|---|
| gemma4:e2b-it-qat | 60 | 49/60 (82%) | 0.78 | 6/60 | 60/60 | 35 | 30 | 0 | FAIL |
