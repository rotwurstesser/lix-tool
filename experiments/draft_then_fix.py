"""Draft a German children's story, then reach the LIX target with small sentence edits.

The model writes whole sentences only. Code computes LIX, ranks the edits,
and keeps the candidate that lands closest to the target.

Usage: python3 -I draft_then_fix.py <ollama-model> <target-lix> [sentences] [topic]
Prints one JSON object. A missed target is not an error (see "hit").
"""
import json
import os
import re
import sys
import time
import urllib.request

from AppKit import NSSpellChecker

MODEL = sys.argv[1]
TARGET = float(sys.argv[2])
N = int(sys.argv[3]) if len(sys.argv) > 3 else 8
TOPIC = sys.argv[4] if len(sys.argv) > 4 else "ein Fuchs, der im Wald einen verlorenen Schlüssel findet"
MAX_EDITS = 12
MAX_OPTIONS = 6
TOLERANCE = 0.5
OLLAMA = os.environ.get("LIX_OLLAMA", "http://127.0.0.1:11434")  # generator server; the judge stays on the default one
SPELL = NSSpellChecker.sharedSpellChecker()
stats = {"calls": 0, "rejected": 0, "drafts": 0, "grammar_rejected": 0}


def post(path, body):
    req = urllib.request.Request(OLLAMA + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=600))


def think_setting():
    """gpt-oss needs a think level. Other thinking models get thinking off: it is slow and uses up the token budget."""
    caps = post("/api/show", {"model": MODEL}).get("capabilities", [])
    if "thinking" not in caps:
        return None
    return "low" if "gpt-oss" in MODEL else False


THINK = think_setting()


def ask(prompt):
    stats["calls"] += 1
    body = {"model": MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.8, "num_predict": 3000, "num_ctx": 8192}}
    if THINK is not None:
        body["think"] = THINK
    return post("/api/generate", body)["response"].strip()


# Abbreviations and decimals must not end a sentence.
ABBREV = re.compile(r"\b(z\.\s?B|d\.\s?h|u\.\s?a|usw|bzw|ca|Dr|Hr|Fr|Nr|St)\.")
DOT = "․"


def split_sentences(text):
    text = re.sub(r"[*#_`]+", "", text)
    # Drop title lines: non-empty lines without end punctuation.
    text = "\n".join(l for l in text.splitlines() if not l.strip() or re.search(r"[.!?][\"“”«»]?\s*$", l.strip()))
    text = ABBREV.sub(lambda m: m.group(0).replace(".", DOT), text)
    text = re.sub(r"(\d)\.(\d)", "\\1" + DOT + "\\2", text)
    # A sentence ends at .!? (plus closing quote) only when a new sentence starts, so "„Hilfe!“, rief er" stays one.
    parts = re.split(r"(?<=[.!?][\"“”«»])\s+(?=[A-ZÄÖÜ„\"«])|(?<=[.!?])\s+(?=[A-ZÄÖÜ„\"«])", " ".join(text.split()))
    return [p.replace(DOT, ".").strip() for p in parts if re.search(r"\w", p)]


def words(text):
    return re.findall(r"[^\W\d_]+(?:-[^\W\d_]+)*", text)


def lix(sents):
    ws = words(" ".join(sents))
    if not ws or not sents:
        return 0.0
    return len(ws) / len(sents) + 100 * sum(len(w) > 6 for w in ws) / len(ws)


def known_word(w):
    rng, _ = SPELL.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount_(w, 0, "de", False, 0, None)
    return rng.length == 0


def unknown_words(sents):
    return [w for w in words(" ".join(sents)) if not known_word(w)]


def lines(raw):
    out = []
    for line in raw.splitlines():
        line = re.sub(r"^\s*(\d+[.)]|[-*])\s*", "", line).strip().strip("\"„“”«»*")
        if line and re.search(r"[.!?][\"“”«»]?$", line):
            out.append(line)
    return out


def clean_edit(old_text, new_sents):
    """Reject candidates that cheat: invented words, or long words cut short (verlorenen -> verlor)."""
    old = words(old_text)
    new = words(" ".join(new_sents))
    removed = [w.lower() for w in old if w not in new]
    for w in new:
        if w in old:
            continue
        if not known_word(w):
            return False
        if any(r != w.lower() and r.startswith(w.lower()) and len(w) >= 3 for r in removed):
            return False
    return True


def grammar_ok(sentence):
    answer = ask("Ist dieser deutsche Satz grammatisch korrekt (Wortformen, Endungen, Zeitform)? "
                 f"Antworte nur mit JA oder NEIN.\nSatz: {sentence}")
    return answer.strip().upper().startswith("JA")


def edit_options(sents):
    """Edits that move LIX toward the target, ranked. Each: (instruction, start, count, predicted gap after the edit)."""
    total = len(words(" ".join(sents)))
    n = len(sents)
    gap = lix(sents) - TARGET
    wps = total / n
    swap = 100 / total                                    # LIX change of one long/short word swap
    flagged = {i for i, s in enumerate(sents) if unknown_words([s])}
    opts = []
    for i, s in enumerate(sents):
        ws = words(s)
        n_long = sum(len(w) > 6 for w in ws)
        if gap > 0:
            if n_long:
                opts.append(("Schreibe den Satz um. Gleiche Bedeutung, aber ersetze ein langes Wort (mehr als 6 Buchstaben) "
                             "durch ein kurzes, echtes Wort (höchstens 6 Buchstaben). Kürze keine Wörter ab.", i, 1, gap - swap))
            if len(ws) >= 8:
                opts.append(("Teile den Satz in zwei kurze, natürliche Sätze. Gleiche Bedeutung.", i, 1, gap - (wps - total / (n + 1))))
        else:
            if len(ws) > n_long:
                opts.append(("Schreibe den Satz um. Gleiche Bedeutung, aber ersetze ein kurzes Wort durch ein passendes "
                             "längeres Wort (mindestens 7 Buchstaben).", i, 1, gap + swap))
            if i + 1 < n and n > 2:
                opts.append(("Verbinde die zwei Sätze zu einem natürlichen Satz. Gleiche Bedeutung.", i, 2, gap + (total / (n - 1) - wps)))
    # Sentences with unknown words first, then the best predicted gap. Swaps on long sentences first among equals.
    opts.sort(key=lambda o: (o[1] not in flagged, round(abs(o[3]), 1), -len(words(sents[o[1]]))))
    return opts[:MAX_OPTIONS]


def fix_loop(sents, check_grammar):
    path = []
    for _ in range(MAX_EDITS):
        if abs(lix(sents) - TARGET) <= TOLERANCE and not unknown_words(sents):
            break
        best = None
        for instr, i, k, _ in edit_options(sents):
            target_text = " ".join(sents[i:i + k])
            raw = ask(f"Geschichte:\n{' '.join(sents)}\n\nAufgabe: {instr}\nText: {target_text}\n\n"
                      "Gib 3 Varianten aus, jede auf einer eigenen Zeile, nummeriert. Korrekte deutsche Grammatik. Nur die Varianten.")
            for cand in lines(raw):
                new = split_sentences(cand) or [cand]
                if not clean_edit(target_text, new):
                    stats["rejected"] += 1
                    continue
                trial = sents[:i] + new + sents[i + k:]
                score = abs(lix(trial) - TARGET) + 2 * len(unknown_words(trial))
                if best is None or score < best[0]:
                    best = (score, i, k, new)
            if best and best[0] <= TOLERANCE:
                break
        current = abs(lix(sents) - TARGET) + 2 * len(unknown_words(sents))
        if best is None or best[0] >= current:
            break  # no candidate is better than the current text
        _, i, k, new = best
        if check_grammar and not all(grammar_ok(s) for s in new):
            stats["grammar_rejected"] += 1
            break
        sents = sents[:i] + new + sents[i + k:]
        path.append(round(lix(sents), 1))
    return sents, path


def draft():
    wps = round(TARGET / 2)
    best = None
    for _ in range(3):
        stats["drafts"] += 1
        sents = split_sentences(ask(
            f"Schreibe eine Kindergeschichte auf Deutsch über {TOPIC}. Genau {N} Sätze, im Schnitt etwa {wps} "
            "Wörter pro Satz. Einfache, klare, korrekte Sprache, eine richtige kleine Handlung mit Anfang und Ende. "
            "Kein Titel, keine Formatierung. Gib nur die Geschichte aus."))
        if len(sents) < 2:
            continue  # empty or unusable output
        score = abs(lix(sents) - TARGET) + 3 * len(unknown_words(sents))
        if best is None or score < best[0]:
            best = (score, sents)
        if abs(lix(sents) - TARGET) <= 6 and not unknown_words(sents):
            break
    return best[1] if best else []


def main():
    t0 = time.time()
    sents = draft()
    if not sents:
        print(json.dumps({"model": MODEL, "target": TARGET, "error": "no usable draft", **stats}))
        return
    path = [round(lix(sents), 1)]
    sents, p = fix_loop(sents, check_grammar=False)
    path += p
    # Grammar pass, then repair LIX again with a grammar check on every accepted edit.
    fixed = split_sentences(ask("Korrigiere nur Grammatikfehler (Wortformen, Endungen, Zeitform) in dieser Geschichte. "
                                f"Ändere sonst nichts. Gib nur die Geschichte aus.\n\n{' '.join(sents)}"))
    if len(fixed) >= len(sents) - 1:
        sents = fixed
        path.append(round(lix(sents), 1))
    sents, p = fix_loop(sents, check_grammar=True)
    path += p
    final = lix(sents)
    print(json.dumps({"model": MODEL, "target": TARGET, "final_lix": round(final, 1), "hit": abs(final - TARGET) <= TOLERANCE,
                      "lix_path": path, **stats, "secs": round(time.time() - t0), "sentences": len(sents),
                      "unknown_words": unknown_words(sents), "text": " ".join(sents)}, ensure_ascii=False))


main()
