"""Grammar recheck of saved eval texts with a local LanguageTool server (rule-based, same result every run).

Usage: python3 -I ltcheck.py <run-dir> [<run-dir> ...]
Needs languagetool-server on 127.0.0.1:8081. Writes LTCHECK.md next to this script.
Grammar = categories GRAMMAR, CASING, CONFUSED_WORDS. Typos are counted apart: names trigger the speller.
"""
import collections
import json
import pathlib
import sys
import urllib.parse
import urllib.request

GRAMMAR = {"GRAMMAR", "CASING", "CONFUSED_WORDS"}


def check(text):
    data = urllib.parse.urlencode({"text": text, "language": "de-DE"}).encode()
    return json.load(urllib.request.urlopen("http://127.0.0.1:8081/v2/check", data=data, timeout=60))["matches"]


def snippet(m):
    c = m["context"]
    return c["text"][c["offset"]:c["offset"] + c["length"]]


lines = ["LanguageTool recheck (de-DE). Grammar = GRAMMAR, CASING, CONFUSED_WORDS.", "",
         "| Model | Texts | Hit | Texts with grammar error | Grammar errors | Texts with typo | Examples |",
         "|---|---|---|---|---|---|---|"]
for run in map(pathlib.Path, sys.argv[1:]):
    rows = [json.loads(l) for l in open(run / "results.jsonl") if "text" in json.loads(l)]
    by_model = collections.defaultdict(list)
    for r in rows:
        by_model[r["model"]].append(r)
    for model, mine in by_model.items():
        g_texts = g_errs = t_texts = 0
        examples = []
        for r in mine:
            ms = check(r["text"])
            g = [m for m in ms if m["rule"]["category"]["id"] in GRAMMAR]
            t = [m for m in ms if m["rule"]["category"]["id"] == "TYPOS"]
            g_texts += bool(g)
            g_errs += len(g)
            t_texts += bool(t)
            examples += [snippet(m) for m in g]
        lines.append(f"| {model} | {len(mine)} | {sum(r['hit'] for r in mine)} | {g_texts}/{len(mine)} | {g_errs} | "
                     f"{t_texts}/{len(mine)} | {'; '.join(examples[:4])} |")
out = pathlib.Path(__file__).with_name("LTCHECK.md")
out.write_text("\n".join(lines) + "\n")
print("\n".join(lines))
