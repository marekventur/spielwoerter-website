// Asks a model the per-word yes/no questions from REGELN.md and scores the
// answers against scripts/groundtruth/data/testset_<frage>.tsv.
//
//   node scripts/groundtruth/classify.mjs --frage steigerbar --model claude-haiku-5-5 --prompt regeln
//   node scripts/groundtruth/classify.mjs --summary
//
// --frage   steigerbar | deklinierbar | partizip | transitiv
// --prompt  nackt  (question + the word's description only)
//           regeln (plus the relevant REGELN.md text, which carries its own examples;
//                   nothing from the test sets, or the score would flatter the model)
// --model   claude-* (ANTHROPIC_API_KEY) or deepseek-* (DEEPSEEK_API_KEY_SUGGESTIONS)
//
// Results go to scripts/groundtruth/runs/<frage>/<model>__<prompt>.jsonl; words
// already answered there are skipped, so an interrupted run resumes.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRICES = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "deepseek-flash": { in: 0.3, out: 1.2 },
};

const FRAGEN = {
  steigerbar: {
    frage: (w) => `Ist das Adjektiv „${w}“ steigerbar, d.h. sind Komparativ und Superlativ zulässig?`,
    regeln: `Regeln der Wortliste (REGELN.md):
- Adjektive: Alle Deklinationsformen zulässig. Steigerung nur, wenn sinngemäß vergleichbar.
- Nicht steigerbar: Adjektive mit absolutem Grad (einzig, minimal), Endzustände (eisfrei, final), nur attributiv (obig), nur prädikativ (quitt, baff), oder mit verstärkendem Bestimmungswort (sauteuer).
- un-/-los-Adjektive: Steigerbar bei übertragener Bedeutung (z.B. lieblosere gültig, aber nicht obdachlosere).
- Fremdwörtliche Adjektive: Grundsätzlich deklinier- und steigerbar, AUSSER als indeklinabel gekennzeichnet (z.B. clean, crazy, halal, haram).
- trendy, happy, sexy, unsexy: Steigerung erlaubt (trendyer, sexysten), aber KEINE Deklination in keiner Stufe.
- Farbadjektive: Nur blau, blond, braun, gelb, grau, grün, rot, schwarz, weiß dürfen gesteigert werden. Fremdwörtliche und zusammengesetzte Farbadjektive nicht.
- Steigerung von Partizipien: Nur wenn adjektivisch verwendbar und sinngemäß steigerbar.`,
  },
  deklinierbar: {
    frage: (w) => `Ist das Adjektiv „${w}“ deklinierbar, d.h. darf es mit Endung vor einem Substantiv stehen (z.B. „ein ${w}er Tag“, „die ${w}en Tage“)?`,
    regeln: `Regeln der Wortliste (REGELN.md):
- Adjektive: Alle Deklinationsformen zulässig.
- Fremdwörtliche Adjektive: Grundsätzlich deklinier- und steigerbar, AUSSER als indeklinabel gekennzeichnet (z.B. clean, crazy, halal, haram).
- trendy, happy, sexy, unsexy: Steigerung erlaubt (trendyer, sexysten), aber KEINE Deklination in keiner Stufe.
- Nur prädikativ gebrauchte Adjektive (quitt, baff) stehen nicht attributiv vor einem Substantiv.`,
  },
  partizip: {
    frage: (w) => `Darf das Partizip II von „${w}“ dekliniert vor einem Substantiv stehen (so wie „der gegessene Apfel“, „die gegangenen Gäste“)?`,
    regeln: `Regeln der Wortliste (REGELN.md):
- Partizip II: Adjektivisch deklinierbar bei (a) transitiven Verben, (b) intransitiven Verben mit Perfekt auf „sein“, (c) reflexiven Verben mit „sein“-Zustandskonstruktion.
Nicht deklinierbar ist es also bei intransitiven Verben mit Perfekt auf „haben“ (geschlafen: „der geschlafene Mann“ ist ungültig).`,
  },
  transitiv: {
    frage: (w) => `Ist das Verb „${w}“ transitiv, d.h. kann es (in mindestens einer gebräuchlichen Bedeutung) ein Akkusativobjekt haben, sodass ein persönliches Passiv möglich ist („der/die/das … wird ge…t“)?`,
    regeln: `Regeln der Wortliste (REGELN.md):
- Partizip II: Adjektivisch deklinierbar bei (a) transitiven Verben, (b) intransitiven Verben mit Perfekt auf „sein“, (c) reflexiven Verben mit „sein“-Zustandskonstruktion.
- Gerundiv (zu-Partizip): Nur von transitiven Verben, nur attributiv mit Adjektivendung (z.B. abzugebende, anzusäende).
Transitiv heißt hier: ein echtes Akkusativobjekt. Ein Reflexivpronomen allein (sich beeilen) zählt nicht, ebenso wenig ein Dativ- oder Präpositionalobjekt.`,
  },
};

const SYSTEM = `Du beurteilst Wörter für eine deutsche Scrabble-Wortliste. Antworte ausschließlich mit einem JSON-Objekt:
{"begruendung": "<ein kurzer Satz>", "antwort": "ja" | "nein", "sicherheit": <0-100, wie sicher du dir bist>}`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function readTsv(path) {
  const [head, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const cols = head.split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
}

function userPrompt(frage, variant, row) {
  const f = FRAGEN[frage];
  const parts = [];
  if (variant === "regeln") parts.push(f.regeln, "");
  parts.push(`Wort: ${row.wort}`);
  if (row.beschreibung) parts.push(`Beschreibung: ${row.beschreibung}`);
  parts.push("", f.frage(row.wort));
  return parts.join("\n");
}

async function ask(model, prompt) {
  if (model.startsWith("claude-")) {
    const client = new Anthropic();
    const res = await client.messages.create({
      model, max_tokens: 2048, system: SYSTEM, messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, inTok: res.usage.input_tokens, outTok: res.usage.output_tokens, served: res.model };
  }
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY_SUGGESTIONS}` },
    body: JSON.stringify({
      model, max_tokens: 400, temperature: 0, thinking: { type: "disabled" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  const d = await r.json();
  return { text: d.choices?.[0]?.message?.content ?? "", inTok: d.usage?.prompt_tokens ?? 0,
           outTok: d.usage?.completion_tokens ?? 0, served: d.model };
}

function parse(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (o.antwort === "ja" || o.antwort === "nein") {
      return { antwort: o.antwort, sicherheit: Number(o.sicherheit) || 0, begruendung: o.begruendung ?? "" };
    }
  } catch { /* fall through: models sometimes break their own JSON with unescaped quotes */ }
  const a = m[0].match(/"antwort"\s*:\s*"(ja|nein)"/);
  const c = m[0].match(/"sicherheit"\s*:\s*(\d+)/);
  return a ? { antwort: a[1], sicherheit: c ? Number(c[1]) : 0, begruendung: m[0].slice(0, 200) } : null;
}

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      const transient = e.status === 429 || e.status === 529 || (e.status >= 500) || e.name === "TimeoutError";
      if (!transient || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt * (0.5 + Math.random())));
    }
  }
}

async function run() {
  const frage = arg("frage"), model = arg("model"), variant = arg("prompt", "regeln");
  const conc = Number(arg("concurrency", "8"));
  if (!FRAGEN[frage] || !model || !["nackt", "regeln"].includes(variant)) {
    console.error("usage: --frage steigerbar|deklinierbar|partizip|transitiv --model ID --prompt nackt|regeln"); process.exit(2);
  }
  const rows = readTsv(join(HERE, "data", `testset_${frage}.tsv`));
  const outDir = join(HERE, "runs", frage);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${model}__${variant}.jsonl`);
  const done = new Set(existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).wort) : []);
  const todo = rows.filter((r) => !done.has(r.wort));
  let i = 0, failed = 0;
  const t0 = Date.now();
  async function worker() {
    while (i < todo.length) {
      const row = todo[i++];
      try {
        const t = Date.now();
        const res = await withRetry(() => ask(model, userPrompt(frage, variant, row)));
        const p = parse(res.text);
        const price = PRICES[model] ?? { in: 0, out: 0 };
        appendFileSync(out, JSON.stringify({
          wort: row.wort, label: row.label, vertrauen: row.vertrauen,
          antwort: p?.antwort ?? null, sicherheit: p?.sicherheit ?? null, begruendung: p?.begruendung ?? res.text.slice(0, 200),
          served: res.served, sekunden: (Date.now() - t) / 1000,
          kosten: (res.inTok * price.in + res.outTok * price.out) / 1e6,
        }) + "\n");
      } catch (e) {
        failed++;
        console.error(`${row.wort}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  console.error(`${frage} ${model} ${variant}: ${todo.length - failed} answered, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

function summary() {
  const lines = [];
  const runsDir = join(HERE, "runs");
  for (const frage of Object.keys(FRAGEN)) {
    const dir = join(runsDir, frage);
    if (!existsSync(dir)) continue;
    lines.push(`\n${frage}`);
    lines.push("modell / prompt                    | richtig | ja-recall | nein-recall | gold   | ≥90 sicher: anteil, richtig | kosten | sek");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
      const rs = readFileSync(join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const ok = (r) => r.antwort === r.label;
      const pct = (xs) => xs.length ? `${Math.round((100 * xs.filter(ok).length) / xs.length)}%` : "-";
      const ja = rs.filter((r) => r.label === "ja"), nein = rs.filter((r) => r.label === "nein");
      const gold = rs.filter((r) => r.vertrauen === "gold");
      const sure = rs.filter((r) => r.sicherheit >= 90);
      // balanced accuracy: the sets are lopsided, so plain accuracy would reward always-"nein"
      const bal = (ja.length && nein.length)
        ? Math.round(50 * (ja.filter(ok).length / ja.length + nein.filter(ok).length / nein.length)) + "%" : pct(rs);
      const cost = rs.reduce((s, r) => s + (r.kosten || 0), 0);
      const sec = rs.map((r) => r.sekunden).sort((a, b) => a - b)[Math.floor(rs.length / 2)] ?? 0;
      lines.push(`${f.replace(".jsonl", "").replace("__", " / ").padEnd(34)} | ${bal.padStart(7)} | ${pct(ja).padStart(9)} | ${pct(nein).padStart(11)} | ${pct(gold).padStart(6)} | ${`${Math.round((100 * sure.length) / (rs.length || 1))}%, ${pct(sure)}`.padStart(27)} | $${cost.toFixed(2)} | ${sec.toFixed(1)}`);
    }
  }
  console.log(lines.join("\n"));
}

if (process.argv.includes("--summary")) summary();
else await run();
