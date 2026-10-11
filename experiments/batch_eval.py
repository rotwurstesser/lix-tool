"""Catalog eval for draft_then_fix.py: held-out topics, repeats, independent grammar judge.

Usage: python3 -I batch_eval.py <out-dir> <judge-model> <set: dev|heldout> <repeats> <model> [<model> ...]
Writes results.jsonl (appends) and SUMMARY.md. Errors count as misses.
Gate: hit rate >= 90% AND judge flags <= 10% of texts.
"""
import json
import pathlib
import statistics
import subprocess
import sys
import urllib.request

OUT = pathlib.Path(sys.argv[1])
JUDGE = sys.argv[2]
SET = sys.argv[3]
REPEATS = int(sys.argv[4])
MODELS = sys.argv[5:]
TARGETS = [25, 35, 45]
TOPICS = {
    "dev": [
        "ein Fuchs, der im Wald einen verlorenen Schlüssel findet",
        "ein Mädchen, das zum ersten Mal Zug fährt",
        "ein Roboter, der Fussball lernen will",
        "zwei Freunde, die im Garten einen Igel retten",
        "ein Junge, der Angst vor dem Gewitter hat",
    ],
    # Written before tuning; do not change after the first heldout run.
    "heldout": [
        "eine Katze, die auf dem Dach festsitzt",
        "ein Kind, das seinen ersten Zahn verliert",
        "ein Ausflug mit der Klasse in den Zoo",
        "ein Drache, der nicht Feuer speien kann",
        "eine Oma, die das Handy nicht versteht",
        "ein Hund, der beim Bäcker wartet",
        "ein Schneemann, der im Frühling schmilzt",
        "zwei Geschwister, die ein Zelt aufbauen",
        "ein Mädchen, das ein Baumhaus baut",
        "ein Pinguin, der zum ersten Mal schwimmt",
    ],
}[SET]
SCRIPT = pathlib.Path(__file__).with_name("draft_then_fix.py")


def judge(text):
    """Independent judge: count sentences with grammar errors. Returns (bad_count, raw)."""
    body = {"model": JUDGE, "stream": False, "options": {"temperature": 0, "num_ctx": 8192},
            "prompt": "Prüfe diesen deutschen Kindertext auf Grammatikfehler (falsche Wortformen, Endungen, Zeitformen, "
                      "fehlende Wörter, erfundene Wörter). Antworte nur mit JSON: "
                      '{"fehler": ["<fehlerhafter Satzteil>", ...]} . Leere Liste, wenn alles korrekt ist.\n\n' + text,
            "format": "json"}
    req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    raw = json.load(urllib.request.urlopen(req, timeout=900))["response"]
    try:
        return len(json.loads(raw).get("fehler", [])), raw
    except (json.JSONDecodeError, AttributeError):
        return -1, raw


OUT.mkdir(parents=True, exist_ok=True)
rows = []
with open(OUT / "results.jsonl", "a") as log:
    for model in MODELS:
        for rep in range(REPEATS):
            for topic in TOPICS:
                for target in TARGETS:
                    try:
                        proc = subprocess.run([sys.executable, "-I", str(SCRIPT), model, str(target), "8", topic],
                                              capture_output=True, text=True, timeout=1800)
                        row = json.loads(proc.stdout)
                    except (subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
                        row = {"model": model, "target": target, "error": str(exc)[-300:]}
                    if "error" in row and "stderr" not in row:
                        row.setdefault("hit", False)
                    if "text" in row:
                        row["judge_errors"], row["judge_raw"] = judge(row["text"])
                    row.update(topic=topic, repeat=rep, set=SET, judge=JUDGE)
                    rows.append(row)
                    log.write(json.dumps(row, ensure_ascii=False) + "\n")
                    log.flush()

lines = [f"Set: {SET}, repeats: {REPEATS}, judge: {JUDGE}. Errors count as misses. Gate: hit ≥ 90% and judge-flagged ≤ 10%.", "",
         "| Model | Runs | Hit rate | Mean abs error | Judge-flagged texts | Calls (median) | Secs (median) | Errors | Gate |",
         "|---|---|---|---|---|---|---|---|---|"]
for model in MODELS:
    mine = [r for r in rows if r["model"] == model]
    ok = [r for r in mine if "final_lix" in r]
    hits = sum(1 for r in ok if r["hit"])
    flagged = sum(1 for r in ok if r.get("judge_errors", 0) != 0)
    errors = len(mine) - len(ok)
    hit_rate = hits / len(mine) if mine else 0
    flag_rate = (flagged + errors) / len(mine) if mine else 1
    mae = f"{statistics.mean(abs(r['final_lix'] - r['target']) for r in ok):.2f}" if ok else "-"
    calls = statistics.median(r["calls"] for r in ok) if ok else "-"
    secs = statistics.median(r["secs"] for r in ok) if ok else "-"
    gate = "PASS" if hit_rate >= 0.9 and flag_rate <= 0.1 else "FAIL"
    lines.append(f"| {model} | {len(mine)} | {hits}/{len(mine)} ({hit_rate:.0%}) | {mae} | {flagged}/{len(mine)} | {calls} | {secs} | {errors} | {gate} |")
(OUT / "SUMMARY.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
