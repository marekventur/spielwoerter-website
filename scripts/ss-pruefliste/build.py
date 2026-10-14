#!/usr/bin/env python3
"""
ss/ß (and ae/oe/ue) duplicates in the accepted list, sorted for moderator
review on /pruefliste/ss. A duplicate is an ASCII spelling ("abgiessen") whose
umlaut/ß sibling ("abgießen") is also accepted.

Each pair gets a group (`g`) with the suggested decision for the ASCII form:

  schweiz   Wiktionary lists the ss form as the Swiss/Liechtenstein spelling -> streichen
  diphthong ß follows ai/au/äu/ei/eu in the sibling (moderators' rule; French
            loans like Hausse/Baisse excepted)                               -> streichen
  lang      the sibling's pronunciation (IPA) has a long vowel before the s  -> streichen
  eigen     the ASCII form is a standard word or form of its own (Masse next
            to Maße, Ablass next to the old spelling Ablaß, goss)            -> behalten
  umlaut    ae/oe/ue stand-in for an umlaut, no word of its own              -> streichen
  unklar    no evidence either way                                           -> prüfen

  python3 scripts/ss-pruefliste/build.py --accepted wordlist_accepted.jsonl \
      --kaikki raw-wiktextract-data.jsonl.gz --out lib/pruefliste-ss-2026-10.json
"""
import argparse
import collections
import gzip
import json
import re

DIPHTHONGS = ("ai", "au", "äu", "ei", "eu")
# French loans where ss follows a written diphthong (moderators' forum, 2026-10-13).
DIPHTHONG_EXCEPTIONS = ("hausse", "haussier", "baisse", "baissier", "bouillabaisse")
UMLAUTS = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}


def ascii_spelling(w):
    for k, v in UMLAUTS.items():
        w = w.replace(k, v)
    return w


def load_wiktionary(path, wanted):
    """For the words we care about: standard (non-Swiss) word/form status,
    Swiss alternatives, lemmas, and IPA."""
    standard = set()                       # headword (not a name) or a standard form of one
    swiss = set()                          # spelled this way only in Switzerland/Liechtenstein
    lemmas = collections.defaultdict(set)  # form -> lemmas
    ipa = {}                               # lemma -> first IPA
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if '"lang_code": "de"' not in line:
                continue
            e = json.loads(line)
            if e.get("pos") == "name":
                continue
            lemma = (e.get("word") or "").lower()
            forms = e.get("forms") or []
            relevant = lemma in wanted or any((f.get("form") or "").lower() in wanted for f in forms)
            if not relevant:
                continue
            if lemma in wanted and "form-of" not in (e.get("tags") or []):
                standard.add(lemma)
                lemmas[lemma].add(lemma)
            elif lemma in wanted:
                standard.add(lemma)
            for s in e.get("sounds") or []:
                if s.get("ipa") and lemma not in ipa:
                    ipa[lemma] = s["ipa"]
            for f in forms:
                form = (f.get("form") or "").lower()
                if form not in wanted or " " in form:
                    continue
                tags = set(f.get("tags") or [])
                if "Switzerland" in tags:
                    swiss.add(form)
                elif not tags & {"obsolete", "alternative", "archaic"}:
                    standard.add(form)
                lemmas[form].add(lemma)
    return standard, swiss, lemmas, ipa


def long_before_s(word, lemma, ipa):
    """True when the lemma's IPA has a long vowel or diphthong before an s and
    the form keeps the lemma's vowel before ß (no ablaut: gießen -> goss)."""
    if not ipa or "ß" not in lemma:
        return False
    i, j = word.find("ß"), lemma.find("ß")
    if i < 1 or j < 1 or word[i - 1] != lemma[j - 1]:
        return False
    return bool(re.search(r"(ː|̯)s", ipa))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--accepted", required=True)
    ap.add_argument("--kaikki", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    acc = {}
    with open(a.accepted, encoding="utf-8") as fh:
        for line in fh:
            e = json.loads(line)
            acc[e["word"]] = e
    by_ascii = collections.defaultdict(list)
    for w in acc:
        by_ascii[ascii_spelling(w)].append(w)
    pairs = []
    for ws in by_ascii.values():
        real = [w for w in ws if re.search("[äöüß]", w)]
        plain = [w for w in ws if not re.search("[äöüß]", w)]
        pairs += [(p, r) for p in plain for r in real]

    wanted = {w for pair in pairs for w in pair}
    standard, swiss, lemmas, ipa = load_wiktionary(a.kaikki, wanted)

    out = []
    for s, b in sorted(pairs):
        lem = sorted(lemmas.get(b, ()))
        lemma_ipa = next((ipa[l] for l in lem if l in ipa), "")
        is_ss = "ß" in b and not re.search("[äöü]", b.replace("ß", ""))
        k = b.find("ß")
        # A standard word of its own wins over a Swiss label: Masse is also the
        # Swiss spelling of Maße, but stays as a word in its own right.
        if s in standard:
            g, why = "eigen", "eigenes Wort oder Form laut Wiktionary"
        elif s in swiss:
            g, why = "schweiz", "Schweizer Schreibweise laut Wiktionary"
        elif not is_ss:
            g, why = "umlaut", "Ersatzschreibweise für Umlaut"
        elif k >= 2 and b[k - 2:k] in DIPHTHONGS and not s.startswith(DIPHTHONG_EXCEPTIONS):
            g, why = "diphthong", f"ß nach Diphthong „{b[k - 2:k]}“"
        elif any(long_before_s(b, l, ipa.get(l)) for l in lem):
            g, why = "lang", f"langer Vokal vor ß ({lemma_ipa})"
        else:
            g, why = "unklar", "keine Angaben gefunden"
        out.append({
            "s": s, "b": b, "g": g, "why": why,
            "d": (acc[s].get("description") or acc[b].get("description") or "")[:120],
        })
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=0)
    print(len(out), dict(collections.Counter(o["g"] for o in out)))


if __name__ == "__main__":
    main()
