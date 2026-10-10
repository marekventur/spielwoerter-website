#!/usr/bin/env python3
"""
Ground truth for the per-word judgements in REGELN.md that a model would be
asked about:

  steigerbar.tsv    adjective: may it be compared?       (REGELN "Adjektive")
  deklinierbar.tsv  adjective: may it be declined?       (indeclinables: clean, sexy, ...)
  transitiv.tsv     verb: transitive? (Gerundiv allowed)
  partizip.tsv      verb: may the Partizip II be declined? (transitive, sein-perfect,
                    or reflexive with a sein-state)

e-Tilgung is deliberately absent: it is grammar applied by rule
(lib/conjugate.ts), not a judgement per word.

Each row combines independent evidence and says how far to trust it:

  moderator   decisions on prod (suggestions with status moderator_*): forms
              added/kept vs. removed. Removals are noisy (typos, invalid
              words), so a "nein" needs every such form of the word gone
              while the base word itself is still accepted.
  wiktionary  kaikki.org dewiktionary dump: comparative present/absent,
              declined forms present/absent, sense tags, passive forms,
              auxiliary.
  liste       what the list holds today, mostly DeepSeek's opinion. Shown for
              comparison, never counted as truth.

  confidence  gold     moderator evidence, not contradicted
              silver   no moderator evidence, Wiktionary signals agree
              conflict sources disagree -> candidates for moderators
              weak     a single weak signal only

Inputs (all read-only):
  --lists DIR       wordlist_{accepted,uncertain,rejected}.jsonl (spielwoerter repo)
  --history FILE    word -> last known {description, base}, built once from the
                    list's git history with --build-history REPO (takes ~3 min)
  --decisions FILE  moderator decisions exported from prod, one JSON per line:
                      ssh vps3 'sudo python3 -I -' < scripts/groundtruth/export_decisions.py > decisions.jsonl
  --kaikki FILE     raw-wiktextract-data.jsonl.gz
  --out DIR
"""
import argparse
import collections
import csv
import gzip
import json
import random
import re
import subprocess
import sys
from pathlib import Path

COMP = re.compile(r"Komp|Superl", re.I)
GERUNDIV = re.compile(r"Gerundiv|zu-Partizip", re.I)
DECL_P2 = re.compile(r"(dekl|Deklin)[^—]*Part(\.|izips?)\s*II|Part(\.|izip)\s*II[^—]*(dekl|Deklin)", re.I)
DECL_ADJ = re.compile(r"^(Dekl\.|Deklinierte Form|dekl\. Form)(?![^—]*(Part|Komp|Superl))", re.I)
VON = re.compile(r"\bvon\s+([A-Za-zÄÖÜäöüß-]+)")


def lemma_of(word, info):
    if info.get("base"):
        return info["base"].lower()
    m = VON.search(info.get("description") or "")
    return m.group(1).lower() if m else None


def kind_of(description):
    d = description or ""
    if GERUNDIV.search(d):
        return "gerundiv"
    if DECL_P2.search(d):
        return "dekl_p2"
    if COMP.search(d) and "Part" not in d:
        return "komp"
    if DECL_ADJ.search(d):
        return "dekl_adj"
    return None


def build_history(repo, out):
    """Newest-first diff of the list files: the first time a word appears is its last state."""
    seen = {}
    proc = subprocess.Popen(
        ["git", "-C", repo, "log", "origin/main", "-p", "-U0", "--format=%H", "--",
         "wordlist_accepted.jsonl", "wordlist_uncertain.jsonl"],
        stdout=subprocess.PIPE, text=True)
    for line in proc.stdout:
        if line[:2] in ("-{", "+{"):
            try:
                e = json.loads(line[1:])
            except ValueError:
                continue
            seen.setdefault(e["word"], {"description": e.get("description"), "base": e.get("base")})
    Path(out).write_text(json.dumps(seen, ensure_ascii=False))
    print(f"history: {len(seen)} words -> {out}", file=sys.stderr)


def load_list(path):
    with open(path, encoding="utf-8") as fh:
        return {e["word"]: e for e in map(json.loads, fh)}


def load_kaikki(path, adjectives, verbs):
    adj, verb = {}, {}
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            if '"lang_code": "de"' not in line and '"lang_code":"de"' not in line:
                continue
            e = json.loads(line)
            w, pos = (e.get("word") or "").lower(), e.get("pos")
            forms = e.get("forms") or []
            if pos == "adj" and w in adjectives:
                tags = [set(f.get("tags") or []) for f in forms]
                a = adj.setdefault(w, {"positive": False, "comparative": False, "declined": False,
                                       "table": False, "no_comparison": False, "indeclinable": False})
                notes = " ".join(e.get("notes") or [])
                # A full table (~50 forms) is an editorial choice; a stub of a few forms is not.
                a["table"] |= len(forms) >= 40
                a["no_comparison"] |= bool(re.search(r"nicht steigerbar|Steigerung[^.]*unüblich|keine Steigerung", notes))
                a["indeclinable"] |= "indeclinable" in (e.get("tags") or []) or "indeklinabel" in notes
                a["positive"] |= any("positive" in t for t in tags)
                a["comparative"] |= any("comparative" in t or "superlative" in t for t in tags)
                a["declined"] |= any("positive" in t and ({"nominative", "genitive", "dative", "accusative"} & t) for t in tags)
            elif pos == "verb" and w in verbs:
                v = verb.setdefault(w, {"aux": set(), "trans": 0, "intrans": 0, "passive": False,
                                        "reflexive": False, "p2": set()})
                for f in forms:
                    t = set(f.get("tags") or [])
                    if "participle-2" in t and f.get("form"):
                        v["p2"].add(f["form"].lower())
                    if "auxiliary" in t and "perfect" in t and f.get("form") in ("haben", "sein"):
                        v["aux"].add(f["form"])
                    if "processual-passive" in t:
                        v["passive"] = True
                    if (f.get("form") or "").startswith("sich "):
                        v["reflexive"] = True
                for s in e.get("senses") or []:
                    st = set(s.get("tags") or [])
                    v["trans"] += "transitive" in st
                    v["intrans"] += "intransitive" in st
                    v["reflexive"] |= "reflexive" in st
    return adj, verb


ENDINGS = ("e", "em", "en", "er", "es")
UMLAUT = {"a": "ä", "o": "ö", "u": "ü"}
P2_PLAIN = re.compile(r"^\s*(Part\.|Partizip)\s*II\b(?![^—]*dekl)", re.I)


def adjective_stems(lemma):
    """The stem plus its regular variants: final e dropped, -el/-er/-en e-Tilgung, umlaut."""
    stems = {lemma}
    if lemma.endswith("e"):
        stems.add(lemma[:-1])
    if re.search(r"[^aeiouäöü](el|er|en)$", lemma):
        stems.add(lemma[:-2] + lemma[-1])
    m = re.search(r"(au|[aou])([^aeiouäöü]*)$", lemma)
    if m:
        v = "äu" if m.group(1) == "au" else UMLAUT[m.group(1)]
        stems.add(lemma[: m.start()] + v + m.group(2))
    return stems


def regular_forms(lemma, kind, p2s):
    """The forms a correct paradigm has. Strikes of anything else (typos, wrong
    e-Tilgung, garbage) say nothing about the grammatical question."""
    out = set()
    if kind == "komp":
        for st in adjective_stems(lemma):
            out |= {st + "er" + e for e in ("",) + ENDINGS}
            out |= {st + s + e for s in ("st", "est") for e in ("",) + ENDINGS}
    elif kind == "dekl_adj":
        for st in adjective_stems(lemma) - {lemma[:-1] + "ä"}:
            out |= {st + e for e in ENDINGS}
            if st.endswith("e"):
                out |= {st + e for e in ("m", "n", "r", "s")}
    elif kind == "dekl_p2":
        out |= {p + e for p in p2s for e in ENDINGS}
    return out


def is_gerundiv_of(form, lemma):
    i = form.find("zu")
    while i >= 0:
        if (form[:i] + form[i + 2:]) in {lemma + "d" + e for e in ENDINGS}:
            return True
        i = form.find("zu", i + 1)
    return False


def participles(accepted, history, kai_verb):
    p2 = collections.defaultdict(set)
    for w, v in kai_verb.items():
        p2[w] |= {f for f in v["p2"] if " " not in f}
    from_wiktionary = {w for w, forms in p2.items() if forms}
    for source in (history, accepted):
        for w, e in source.items():
            if P2_PLAIN.search(e.get("description") or ""):
                lemma = lemma_of(w, e)
                if lemma and lemma not in from_wiktionary:
                    p2[lemma].add(w)
    return p2


def collect_moderator(decisions, history, accepted, p2):
    """Per (lemma, kind): regular forms moderators confirmed vs. struck."""
    yes = collections.defaultdict(set)
    no = collections.defaultdict(set)

    def regular(word, lemma, kind):
        if kind == "gerundiv":
            return is_gerundiv_of(word, lemma)
        return word in regular_forms(lemma, kind, p2.get(lemma, ()))

    for d in decisions:
        if d["action"] == "remove":
            info = history.get(d["word"]) or {}
        elif d["action"] == "add":
            info = json.loads(d["payload"] or "{}")
        else:
            continue
        kind = kind_of(info.get("description"))
        lemma = lemma_of(d["word"], info)
        if not kind or not lemma or not regular(d["word"], lemma, kind):
            continue
        confirmed = (d["action"] == "add") == (d["status"] == "moderator_approved")
        (yes if confirmed else no)[(lemma, kind)].add(d["word"])
    # Accepted forms a moderator put there directly count as confirmed too.
    for w, e in accepted.items():
        if e.get("verified_by") == "moderator":
            kind, lemma = kind_of(e.get("description")), lemma_of(w, e)
            if kind and lemma and regular(w, lemma, kind):
                yes[(lemma, kind)].add(w)
    return yes, no


_GERUNDIV_INDEX = {}


def gerundiv_index(accepted):
    """lemma -> Gerundiv-shaped words in the list (zu removed, then lemma + d + ending)."""
    if not _GERUNDIV_INDEX:
        for w in accepted:
            for e in ENDINGS:
                if not w.endswith("d" + e):
                    continue
                stem = w[: -len(e) - 1]
                i = stem.find("zu")
                while i >= 0:
                    _GERUNDIV_INDEX.setdefault(stem[:i] + stem[i + 2:], set()).add(w)
                    i = stem.find("zu", i + 1)
    return _GERUNDIV_INDEX


def surviving(lemma, kind, accepted, p2):
    """Regular forms of this kind still in the list, whatever their description says."""
    if kind == "gerundiv":
        return gerundiv_index(accepted).get(lemma, set())
    return regular_forms(lemma, kind, p2.get(lemma, ())) & accepted.keys()


def moderator_verdict(lemma, kind, yes, no, accepted, p2):
    """'ja' / 'nein' / 'widerspruch' / None, with the deciding forms. A strike is
    only a 'nein' when no regular form of that kind survived: otherwise the
    moderator struck one wrong spelling (-est vs -st, missing umlaut), not the
    grammar."""
    y, n = yes.get((lemma, kind), set()), no.get((lemma, kind), set())
    if n and not y and surviving(lemma, kind, accepted, p2):
        return None, []
    if y and n:
        return "widerspruch", sorted(y) + ["/"] + sorted(n)
    if y:
        return "ja", sorted(y)
    if n:
        return "nein", sorted(n)
    return None, []


def combine(mod, wik, strong_wik):
    if mod == "widerspruch":
        return "", "conflict"
    if mod:
        if wik and wik != mod and strong_wik:
            return mod, "conflict"
        return mod, "gold"
    if wik and strong_wik:
        return wik, "silver"
    if wik:
        return wik, "weak"
    return "", "none"


def write(path, header, rows):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\t".join(header) + "\n")
        for r in rows:
            fh.write("\t".join(str(x) for x in r) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-history", metavar="REPO")
    ap.add_argument("--lists")
    ap.add_argument("--history")
    ap.add_argument("--decisions")
    ap.add_argument("--kaikki")
    ap.add_argument("--out")
    ap.add_argument("--per-label", type=int, default=100, help="silver rows per label in each test set")
    ap.add_argument("--review", type=int, default=60, help="rows per moderator review sheet")
    a = ap.parse_args()
    if a.build_history:
        build_history(a.build_history, a.history)
        return

    accepted = load_list(Path(a.lists) / "wordlist_accepted.jsonl")
    history = json.loads(Path(a.history).read_text())
    decisions = [json.loads(l) for l in open(a.decisions, encoding="utf-8")]

    base_words = {w: e for w, e in accepted.items() if not e.get("base")}
    adjectives = {w: e for w, e in base_words.items() if re.match(r"(Adj\.|Adjektiv)", e.get("description") or "")}
    verbs = {w: e for w, e in base_words.items() if re.match(r"Verb\b", e.get("description") or "")}
    kai_adj, kai_verb = load_kaikki(a.kaikki, set(adjectives), set(verbs))
    p2 = participles(accepted, history, kai_verb)
    yes, no = collect_moderator(decisions, history, accepted, p2)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = {}

    # --- steigerbar ----------------------------------------------------------
    rows = []
    for w in sorted(adjectives):
        mod, ev = moderator_verdict(w, "komp", yes, no, accepted, p2)
        k = kai_adj.get(w)
        wik = None
        if k and (k["no_comparison"] or (k["table"] and not k["comparative"])):
            wik = "nein"
        elif k and k["comparative"]:
            wik = "ja"
        # Wiktionary lists comparatives generously (toter), so only its "nein"
        # (an explicit note, or a full table without comparison) is strong.
        label, conf = combine(mod, wik, strong_wik=(wik == "nein"))
        if conf == "none":
            continue
        liste = "ja" if surviving(w, "komp", accepted, p2) else "nein"
        rows.append((w, label, conf, mod or "", ",".join(ev[:5]), wik or "", liste,
                     adjectives[w].get("description", "")[:90]))
    write(out / "steigerbar.tsv",
          ["wort", "label", "vertrauen", "moderation", "belegformen", "wiktionary", "liste", "beschreibung"], rows)
    summary["steigerbar"] = collections.Counter((r[2], r[1]) for r in rows)

    # --- deklinierbar --------------------------------------------------------
    rows = []
    for w in sorted(adjectives):
        mod, ev = moderator_verdict(w, "dekl_adj", yes, no, accepted, p2)
        k = kai_adj.get(w)
        wik = None
        if k and k["indeclinable"]:
            wik = "nein"  # only explicit markers: spelling variants often just lack a table
        elif k and k["declined"]:
            wik = "ja"
        label, conf = combine(mod, wik, strong_wik=(wik == "nein"))
        if conf in ("none", "weak"):
            continue  # "ja" is the default for nearly every adjective; keep the informative rows
        liste = "ja" if surviving(w, "dekl_adj", accepted, p2) else "nein"
        rows.append((w, label, conf, mod or "", ",".join(ev[:5]), wik or "", liste,
                     adjectives[w].get("description", "")[:90]))
    write(out / "deklinierbar.tsv",
          ["wort", "label", "vertrauen", "moderation", "belegformen", "wiktionary", "liste", "beschreibung"], rows)
    summary["deklinierbar"] = collections.Counter((r[2], r[1]) for r in rows)

    # --- transitiv -----------------------------------------------------------
    rows = []
    for w in sorted(verbs):
        k = kai_verb.get(w)
        aux = "+".join(sorted(k["aux"])) if k and k["aux"] else ""
        # Gerundiv: transitive only. Declined Partizip II: transitive, or sein-perfect,
        # so it only speaks to transitivity for haben-only verbs.
        g_mod, g_ev = moderator_verdict(w, "gerundiv", yes, no, accepted, p2)
        p_mod, p_ev = moderator_verdict(w, "dekl_p2", yes, no, accepted, p2)
        if p_mod == "ja":
            # A kept declined Part. II says nothing about transitivity: sein-verbs and
            # reflexive verbs with a sein-state (abgeregt) qualify too. A struck one
            # still says "not transitive". That question is partizip.tsv.
            p_mod = None
        mods = {m for m in (g_mod, p_mod) if m}
        mod = mods.pop() if len(mods) == 1 else None
        mod_conflict = len({m for m in (g_mod, p_mod) if m}) > 1
        wik_signals = []
        if k:
            if k["passive"]:
                wik_signals.append("ja")
            if k["trans"]:
                wik_signals.append("ja")
            if k["intrans"] and not k["trans"] and not k["passive"]:
                wik_signals.append("nein")
        wik = None
        if wik_signals:
            wik = "ja" if "ja" in wik_signals else "nein"
        # Two agreeing Wiktionary signals (passive forms + transitive sense) are strong;
        # an "intransitive"-only sense with no passive is strong for "nein".
        strong = (wik == "ja" and k["passive"] and k["trans"] > 0) or (wik == "nein")
        if mod_conflict:
            label, conf = "", "conflict"
        else:
            label, conf = combine(mod, wik, strong)
        if conf == "none":
            continue
        liste = "ja" if surviving(w, "gerundiv", accepted, p2) else "nein"
        # Declined Part. II in the list implies "transitive" only for haben-verbs.
        liste_p2 = ("ja" if surviving(w, "dekl_p2", accepted, p2) else "nein") if aux == "haben" else ""
        ev = (g_ev + p_ev)[:5]
        rows.append((w, label, conf, mod or ("widerspruch" if mod_conflict else ""), ",".join(ev),
                     wik or "", "passiv" if k and k["passive"] else "", aux,
                     "reflexiv" if k and k["reflexive"] else "", liste, liste_p2,
                     verbs[w].get("description", "")[:90]))
    write(out / "transitiv.tsv",
          ["wort", "label", "vertrauen", "moderation", "belegformen", "wiktionary", "wikt_passiv",
           "hilfsverb", "reflexiv", "liste_gerundiv", "liste_dekl_p2", "beschreibung"], rows)
    summary["transitiv"] = collections.Counter((r[2], r[1]) for r in rows)

    # --- partizip: may the Partizip II be declined? ---------------------------
    rows = []
    for w in sorted(verbs):
        k = kai_verb.get(w)
        aux = "+".join(sorted(k["aux"])) if k and k["aux"] else ""
        mod, ev = moderator_verdict(w, "dekl_p2", yes, no, accepted, p2)
        wik, strong = None, False
        if k:
            transitive = k["passive"] and k["trans"] > 0
            if "sein" in k["aux"] or transitive:
                wik, strong = "ja", True
            elif k["aux"] == {"haben"} and k["intrans"] and not k["trans"] and not k["passive"] \
                    and not k["reflexive"]:
                wik, strong = "nein", True
        label, conf = combine(mod, wik, strong)
        if conf == "none":
            continue
        liste = "ja" if surviving(w, "dekl_p2", accepted, p2) else "nein"
        rows.append((w, label, conf, mod or "", ",".join(ev[:5]), wik or "", aux,
                     "reflexiv" if k and k["reflexive"] else "", liste,
                     verbs[w].get("description", "")[:90]))
    write(out / "partizip.tsv",
          ["wort", "label", "vertrauen", "moderation", "belegformen", "wiktionary", "hilfsverb",
           "reflexiv", "liste", "beschreibung"], rows)
    summary["partizip"] = collections.Counter((r[2], r[1]) for r in rows)

    for name, c in summary.items():
        print(name, dict(sorted(c.items())), file=sys.stderr)
    sample_sets(out, a.per_label, a.review)


LIST_COLUMN = {"steigerbar": "liste", "deklinierbar": "liste", "transitiv": "liste_dekl_p2",
               "partizip": "liste"}


def sample_sets(out, per_label, review):
    """testset_<q>.tsv: all gold rows plus up to `per_label` silver rows per label,
    for scoring models. pruefung_<q>.tsv: every conflict plus a sample of the
    silver rows the current list contradicts, for moderators to settle."""
    rng = random.Random(20261010)
    for q, list_col in LIST_COLUMN.items():
        with open(out / f"{q}.tsv", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh, delimiter="\t"))
        header = list(rows[0].keys()) if rows else []
        test = [r for r in rows if r["vertrauen"] == "gold"]
        for label in ("ja", "nein"):
            silver = [r for r in rows if r["vertrauen"] == "silver" and r["label"] == label]
            test += rng.sample(silver, min(per_label, len(silver)))
        conflicts = [r for r in rows if r["vertrauen"] == "conflict"]
        disputed = [r for r in rows if r["vertrauen"] == "silver" and r[list_col]
                    and r[list_col] != r["label"]]
        # Hard cases first: a "nein" the list contradicts, and reflexive verbs
        # (sich auswirken) whose transitivity is easy to misjudge; random fill after.
        nein = [r for r in disputed if r["label"] == "nein"]
        reflexive = [r for r in disputed if r["label"] != "nein" and r.get("reflexiv")]
        rest = [r for r in disputed if r["label"] != "nein" and not r.get("reflexiv")]
        rng.shuffle(nein)
        rng.shuffle(reflexive)
        pick = (conflicts + nein + reflexive[: review // 3])[:review]
        pick += rng.sample(rest, max(0, min(review - len(pick), len(rest))))
        for name, sel in ((f"testset_{q}.tsv", test), (f"pruefung_{q}.tsv", pick)):
            write(out / name, header, [[r[h] for h in header] for r in sorted(sel, key=lambda r: r["wort"])])
        print(f"{q}: testset {len(test)} ({sum(r['label'] == 'nein' for r in test)} nein), "
              f"pruefung {len(pick)} ({len(conflicts)} conflicts)", file=sys.stderr)


if __name__ == "__main__":
    main()
