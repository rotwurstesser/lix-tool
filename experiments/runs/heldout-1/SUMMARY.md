Set: heldout, repeats: 2, judge: qwen2.5:72b-instruct-q4_K_M. Errors count as misses. Gate: hit ≥ 90% and judge-flagged ≤ 10%.

| Model | Runs | Hit rate | Mean abs error | Judge-flagged texts | Calls (median) | Secs (median) | Errors | Gate |
|---|---|---|---|---|---|---|---|---|
| qwen3:4b-instruct-2507-q4_K_M | 60 | 57/60 (95%) | 0.25 | 42/60 | 18.5 | 20.5 | 0 | FAIL |
| gpt-oss:20b-32k | 60 | 53/60 (88%) | 0.32 | 29/60 | 13.0 | 31.5 | 0 | FAIL |
