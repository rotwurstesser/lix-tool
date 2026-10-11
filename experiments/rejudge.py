"""Re-judge saved texts with a stricter prompt: each flag needs a correction and a rule.

Usage: python3 -I rejudge.py <run-dir> <judge-model>
Drops flags where the correction equals the original or the original is not in the text.
Writes rejudge.jsonl and REJUDGE.md in the run dir.
"""
import json
import pathlib
import sys
import urllib.request

RUN = pathlib.Path(sys.argv[1])
JUDGE = sys.argv[2]
PROMPT = ("Du bist ein strenger Deutschlehrer. Finde nur echte Grammatik- oder Rechtschreibfehler in diesem Kindertext: "
          "falsche Endung, falscher Fall, falsche Verbform, falsche Gross-/Kleinschreibung, erfundenes Wort, fehlendes Wort. "
          "Stil, Wortwahl und Geschmack sind KEINE Fehler. Wenn du unsicher bist, ist es kein Fehler. "
          'Antworte nur mit JSON: {"fehler": [{"falsch": "<exakter Textausschnitt>", "richtig": "<Korrektur>", "regel": "<kurz>"}]}. '
          "Leere Liste, wenn alles korrekt ist.\n\n")


def judge(text):
    body = {"model": JUDGE, "stream": False, "format": "json", "options": {"temperature": 0, "num_ctx": 8192},
            "prompt": PROMPT + text}
    req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    raw = json.load(urllib.request.urlopen(req, timeout=900))["response"]
    try:
        items = json.loads(raw).get("fehler", [])
    except (json.JSONDecodeError, AttributeError):
        return None, raw
    real = [f for f in items if isinstance(f, dict) and f.get("falsch") and f.get("falsch") in text
            and f.get("falsch", "").strip() != f.get("richtig", "").strip()]
    return real, raw


rows = [json.loads(l) for l in open(RUN / "results.jsonl")]
with open(RUN / "rejudge.jsonl", "w") as out:
    for r in rows:
        if "text" not in r:
            continue
        real, raw = judge(r["text"])
        out.write(json.dumps({"model": r["model"], "target": r["target"], "topic": r["topic"], "repeat": r["repeat"],
                              "hit": r["hit"], "flags": real, "raw": raw}, ensure_ascii=False) + "\n")
        out.flush()

res = [json.loads(l) for l in open(RUN / "rejudge.jsonl")]
lines = [f"Strict re-judge, judge {JUDGE}. Flag counts only with a real correction found in the text.", "",
         "| Model | Texts | Hit | Flagged (strict) | Judge parse fails |", "|---|---|---|---|---|"]
for m in dict.fromkeys(r["model"] for r in res):
    mine = [r for r in res if r["model"] == m]
    lines.append(f"| {m} | {len(mine)} | {sum(r['hit'] for r in mine)} | {sum(1 for r in mine if r['flags'])} | "
                 f"{sum(1 for r in mine if r['flags'] is None)} |")
(RUN / "REJUDGE.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
