#!/usr/bin/env node
// Runner scaffold for the build-eval / hillclimb loop. Copy this into the
// user's repo and fill in loadCases / runCase / gradeCase below - the I/O
// shape, file naming, resume, and CLI surface are already hillclimb-ready
// so adding v2, v3, ... is `--variant v3`, not a refactor.
//
//   node run-eval.mjs --flow .claude/hillclimb/<name> --variant baseline --reps 2
//
// Structural properties this encodes (so you don't have to remember them):
//   - parameterized by --variant / --model / --reps (no hardcoded A/B pair)
//   - rep-aware filenames + resume (traces/<id>_rep<k>.json)
//   - reads _state.json, never writes it (loop state belongs to the orchestrator) - 
//     the ONE exception is --approve-harness recording `harness_sha` (see below)
//   - refuses to run when the harness (this file + _state.json.harness_paths) has
//     changed since the sha a human last approved with --approve-harness, so a
//     round that edits the runner cannot execute unreviewed under a standing
//     session allowlist
//   - pairwise graders judge against frozen baseline/ref/<id>.* on disk
//   - writes rows as cases complete (crash-safe)
//   - jittered exponential backoff on transient 429/overloaded/5xx errors
//   - hard per-case wall-clock ceiling (--timeout-s; stream keepalives don't reset it)
//   - served-model assertion (response model must match --model; documented alias->snapshot
//     shapes tolerated: 'foo-latest'/'foo-0'/'foo' -> 'foo-20250101' / 'foo@20250101' / 'foo-2025-01-01')
//   - failed attempts land in errors.jsonl with a failure class and, when the call
//     completed, the billed model/usage (never in results.jsonl)
//   - row ids, trace filenames, and frozen refs share one path-safe id
//     (original id kept in meta.original_id when sanitization changed it)

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- spielwoerter: the LLM suggestion step behind /api/word-enrich ----------
//
// Evaluates lib/enrich.ts llmSuggest() - the real prompt, request and parsing
// code - against scripts/eval-enrich-cases.json. Each variant is one model:
//
//   node --import tsx scripts/eval-enrich.mjs --flow .claude/hillclimb/enrich \
//     --variant baseline --model deepseek-flash --reps 2
//
// Provider is derived from the model id: claude-* -> Anthropic SDK
// (ANTHROPIC_API_KEY), kimi-* -> Moonshot's OpenAI-compatible API
// (MOONSHOT_API_KEY), anything else -> DeepSeek (DEEPSEEK_API_KEY_SUGGESTIONS).
// Grading is programmatic; gold comes from REGELN.md and moderator decisions.

import { DEEPSEEK_NO_THINKING, DEEPSEEK_SYSTEM_PROMPT, llmSuggest } from '../lib/enrich.js';

// USD per 1M tokens, used only for the cost_usd perf column. DeepSeek is
// quoted at its peak rate (off-peak is half). Update when vendors change.
const PRICES = [
  [/^deepseek-flash/, { in: 0.30, out: 1.20 }],
  [/^deepseek-v4-pro/, { in: 1.32, out: 3.96 }],
  [/^kimi-k3/, { in: 3.00, out: 15.00 }],
  [/^kimi-k2/, { in: 0.95, out: 4.00 }],
  [/^claude-haiku-4-5/, { in: 1.00, out: 5.00 }],
  [/^claude-sonnet-5/, { in: 2.00, out: 10.00 }],
  [/^claude-opus-5/, { in: 5.00, out: 25.00 }],
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { const e = new Error(`${name} is not set`); e.failure_class = 'config'; throw e; }
  return v;
}

function llmOptionsFor(model) {
  if (model.startsWith('claude-')) {
    // EVAL_EFFORT=low|medium|high|xhigh|max sets Anthropic's reasoning effort for the variant.
    const effort = process.env.EVAL_EFFORT;
    return { provider: 'anthropic', model, apiKey: requireEnv('ANTHROPIC_API_KEY'), ...(effort ? { effort } : {}) };
  }
  if (model.startsWith('kimi-')) {
    return { provider: 'openai', model, apiKey: requireEnv('MOONSHOT_API_KEY'),
             baseUrl: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1' };
  }
  // Production parity: the site runs DeepSeek in non-thinking mode (see DEEPSEEK_NO_THINKING).
  return { provider: 'openai', model, apiKey: requireEnv('DEEPSEEK_API_KEY_SUGGESTIONS'),
           baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
           extraBody: DEEPSEEK_NO_THINKING };
}

async function loadCases() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const { cases } = JSON.parse(readFileSync(join(here, 'eval-enrich-cases.json'), 'utf8'));
  return cases;
}

// Two synthetic "models" for auditing the harness without an API call:
// `oracle` answers with the gold (must score ~100%), `null-model` always
// answers null (must score ~0% except on the expect-null cases).
function syntheticSuggest(word, expected, model) {
  if (model === 'null-model' || expected.base === null) {
    return { suggestion: null, raw: 'null', model, usage: { input_tokens: 0, output_tokens: 0 }, stopReason: 'stop' };
  }
  const descriptions = { [word]: `Form von ${expected.base[0]}`, [expected.base[0]]: 'Grundform' };
  for (const alts of expected.required) descriptions[alts[0]] = `Form von ${expected.base[0]}`;
  const suggestion = { base: expected.base[0], descriptions };
  return { suggestion, raw: JSON.stringify(suggestion), model, usage: { input_tokens: 0, output_tokens: 0 }, stopReason: 'stop' };
}

async function runCase(input, ctx) {
  if (!ctx.model) { const e = new Error('--model is required (one model per variant)'); e.failure_class = 'config'; throw e; }
  const res = ctx.model === 'oracle' || ctx.model === 'null-model'
    ? syntheticSuggest(input.prompt, input.expected, ctx.model)
    : await llmSuggest(input.prompt, llmOptionsFor(ctx.model));
  return {
    output: res.suggestion ? JSON.stringify(res.suggestion) : 'null',
    suggestion: res.suggestion,
    raw: res.raw,
    transcript: [
      { role: 'system', content: DEEPSEEK_SYSTEM_PROMPT },
      { role: 'user', content: input.prompt },
      { role: 'assistant', content: res.raw },
    ],
    model: res.model,
    usage: res.usage,
    stop_reason: res.stopReason,
  };
}

const norm = (w) => String(w).trim().toLowerCase();

// Same rule as adjacentTranspositions() in lib/enrich.ts: a swap counts as a
// typo only when both letters are vowels or both consonants. A vowel/consonant
// swap is ordinary German morphology (dunkel/dunkle, birken/birkne, rumset/rumste).
const VOWELS = /[aeiouäöüy]/;
function isAdjacentSwap(a, b) {
  if (a.length !== b.length || a === b) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i + 1 >= a.length) return false;
  if (VOWELS.test(a[i]) !== VOWELS.test(a[i + 1])) return false;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

async function gradeCase(input, run) {
  const exp = input.expected;
  const s = run.suggestion;
  const forms = s ? Object.keys(s.descriptions).map(norm) : [];
  const has = (w) => forms.includes(norm(w));

  const base_ok = exp.base === null ? s === null : (s !== null && exp.base.map(norm).includes(norm(s.base)));
  const hit = exp.forbidden.filter(has);
  const no_invalid = hit.length === 0;
  const missing = exp.required.filter((alts) => !alts.some(has));
  const required_ok = missing.length === 0;

  let typo_free = forms.every((w) => /^[a-zäöüß]{2,}$/.test(w));
  const swaps = [];
  for (let i = 0; i < forms.length; i++)
    for (let j = i + 1; j < forms.length; j++)
      if (isAdjacentSwap(forms[i], forms[j])) swaps.push(`${forms[i]}/${forms[j]}`);
  if (swaps.length) typo_free = false;

  const rawIsNull = run.raw.trim().replace(/^```(json)?|```$/g, '').trim() === 'null';
  let format_ok;
  if (s === null) format_ok = rawIsNull;
  else format_ok = has(s.base) && has(input.prompt);

  const pass = base_ok && no_invalid && required_ok && typo_free;
  const why = [];
  if (!base_ok) why.push(`base=${s ? JSON.stringify(s.base) : 'null'}, expected ${exp.base === null ? 'null' : exp.base.join('|')}`);
  if (hit.length) why.push(`forbidden present: ${hit.join(', ')}`);
  if (missing.length) why.push(`missing: ${missing.map((a) => a.join('|')).join(', ')}`);
  if (swaps.length) why.push(`letter-swap twins: ${swaps.join(', ')}`);
  if (!typo_free && !swaps.length) why.push('malformed form(s)');
  if (!format_ok) why.push(s === null ? 'unparseable (not JSON, not null)' : 'base or input word missing from descriptions');
  return {
    grade: { pass: +pass, base_ok: +base_ok, no_invalid: +no_invalid, required_ok: +required_ok, typo_free: +typo_free, format_ok: +format_ok },
    explanation: { pass: why.length ? why.join('; ') : 'ok' },
  };
}

function perfFrom(run) {
  const price = PRICES.find(([re]) => re.test(String(run.model)))?.[1];
  const inTok = run.usage?.input_tokens ?? 0, outTok = run.usage?.output_tokens ?? 0;
  return {
    in_tokens: inTok,
    out_tokens: outTok,
    cost_usd: price ? (inTok * price.in + outTok * price.out) / 1e6 : undefined,
    forms: run.suggestion ? Object.keys(run.suggestion.descriptions).length : 0,
  };
}

// --- harness (you usually won't need to touch below this line) --------------

function parseArgs(argv) {
  const a = { flow: '.claude/hillclimb/flow', variant: 'baseline',
              model: undefined, reps: 1, concurrency: 4, timeoutS: 1800,
              approveHarness: false };
  // A flag at the end of argv would otherwise consume undefined - which for
  // --model equals the default and silently disables the served-model check.
  const val = (i) => { if (argv[i] === undefined) { console.error(`missing value for ${argv[i - 1]}`); usage(); process.exit(2); } return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--flow') a.flow = val(++i);
    else if (k === '--variant') a.variant = val(++i);
    else if (k === '--model') a.model = val(++i);
    else if (k === '--reps') a.reps = +val(++i);
    else if (k === '--concurrency') a.concurrency = +val(++i);
    else if (k === '--timeout-s') a.timeoutS = +val(++i);
    else if (k === '--approve-harness') a.approveHarness = true;
    else if (k === '-h' || k === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown argument: ${k}`); usage(); process.exit(2); }
  }
  if (!/^(baseline|v[1-9]\d*)$/.test(a.variant)) {
    // The report only reads directories named 'baseline' or 'v<N>' - any other
    // name runs to completion but spends the pass into a directory the Summary,
    // trajectory, and budget arithmetic never see.
    console.error(`--variant must be 'baseline' or 'v<N>', got '${a.variant}'`);
    usage(); process.exit(2);
  }
  if (!Number.isFinite(a.timeoutS) || a.timeoutS < 0
      || a.timeoutS * 1000 > 2147483647 // setTimeout clamps >2^31-1 ms to 1 ms - the ceiling would fire instantly
      || !Number.isInteger(a.reps) || a.reps < 1
      || !Number.isInteger(a.concurrency) || a.concurrency < 1) { usage(); process.exit(2); }
  return a;
}
function usage() {
  console.error('usage: node run-eval.mjs --flow DIR --variant ID [--model ID] [--reps N] [--concurrency N] [--timeout-s N (0 = no ceiling)] [--approve-harness]');
}

// Harness integrity gate. The hillclimb loop gets this runner command
// allowlisted for the session and then runs rounds unattended, while the
// per-round change (proposed by an analyzer fed untrusted transcripts) may
// legitimately edit harness code. Without this gate a round that rewrites the
// runner would execute attacker-chosen code on the next unattended run under
// the user's one-time approval. So: sha256 over this file plus every path in
// `_state.json.harness_paths` (relative to the directory the runner is invoked
// from, i.e. the repo root); compare to `_state.json.harness_sha`; refuse on
// absent/mismatch unless a human passes --approve-harness, which records the
// new sha. That write is the one sanctioned exception to "never write
// _state.json".
function checkHarness(statePath, st, approve) {
  const self = fileURLToPath(import.meta.url);
  const listed = Array.isArray(st.harness_paths) ? st.harness_paths.map(String) : [];
  const paths = [...new Set([self, ...listed.map(p => resolve(p))])].sort();
  const h = createHash('sha256');
  const hashed = [];
  for (const p of paths) {
    let buf;
    try { buf = readFileSync(p); }
    catch (e) {
      if (p === self) throw e;
      console.error(`warning: harness path '${relative(process.cwd(), p)}' not readable (${e?.code || 'error'}) - skipped`);
      continue;
    }
    h.update(relative(process.cwd(), p)).update('\0').update(buf).update('\0');
    hashed.push(relative(process.cwd(), p));
  }
  const sha = h.digest('hex');
  if (st.harness_sha === sha) return;
  if (approve) {
    st.harness_sha = sha;
    writeFileSync(statePath, JSON.stringify(st, null, 2) + '\n');
    console.error(`harness approved: sha256 ${sha.slice(0, 12)} over ${hashed.length} file(s) recorded in ${statePath}`);
    return;
  }
  if (st.harness_sha == null) {
    console.error(`no approved harness sha in ${statePath} (computed ${sha.slice(0, 12)} over: ${hashed.join(', ')}).`);
    console.error('Review the harness, then run once with --approve-harness to record it.');
  } else {
    console.error(`harness changed since last approved run (files: ${hashed.join(', ')}); `
      + `approved ${String(st.harness_sha).slice(0, 12)}, now ${sha.slice(0, 12)}.`);
    console.error('Re-run with --approve-harness after reviewing the diff.');
  }
  process.exit(2);
}

// Transient provider errors (429 / overloaded / 5xx) retry with jittered
// exponential backoff - a zero-delay retry loop multiplies cost invisibly
// under rate limits and can turn one transient 429 into a torn-down batch.
// The attempt count lands in the row's meta (or the errors sidecar) so retry
// churn is visible in the data, not just the bill.
async function withBackoff(fn, retry, deadline = Infinity, tries = 5) {
  for (let attempt = 0; ; attempt++) {
    // Checked before every attempt, not just before sleeps: once the case's
    // ceiling has passed, an abandoned chain must not issue another call
    // (e.g. a judge call after the app call consumed the whole ceiling).
    if (Date.now() >= deadline) {
      const e = new Error('wall-clock ceiling exceeded before attempt');
      e.failure_class = 'timeout';
      throw e;
    }
    try { return await fn(); } catch (e) {
      const status = e?.status ?? e?.response?.status;
      const transient = status === 429 || status === 529 || (status >= 500 && status < 600)
        || /overloaded|rate.?limit/i.test(String(e?.message ?? ''));
      if (!transient || attempt >= tries - 1) throw e;
      const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random());
      // Never start a retry that would outlive the case's wall-clock ceiling - 
      // otherwise an abandoned chain keeps issuing API calls after the case failed.
      if (Date.now() + delay >= deadline) throw e;
      retry.count++;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Hard per-case wall-clock ceiling, independent of stream liveness - a hung
// SSE stream can emit keepalives forever, defeating inactivity-based timers.
// The underlying call may keep running; the case fails and the slot is freed.
function withTimeout(promise, seconds, label) {
  if (!(seconds > 0)) return promise;
  let timer;
  const ceiling = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label}: exceeded ${seconds}s wall-clock ceiling`);
      e.failure_class = 'timeout';
      reject(e);
    }, seconds * 1000);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

// Case ids appear in file paths AND as the row/file join key the report uses,
// so rows, trace filenames, and frozen refs all carry the same path-safe id.
// When sanitization changes the id, a short content hash keeps distinct ids
// distinct ('case/1' vs 'case_1'); the original rides in meta.original_id.
function pathSafeId(id) {
  const raw = String(id);
  const cleaned = raw.replace(/[^\w.-]/g, '_');
  // Idempotent by construction: anything already path-safe and within the
  // length bound - including this function's own truncated+suffixed output - 
  // passes through unchanged. Long ids (URLs, prompt text as id) truncate to
  // 120 chars plus an 8-hex hash of the full original, so they fail here, not
  // at the trace write after the spend, and distinct ids stay distinct.
  if (cleaned === raw && raw.length <= 129) return raw;
  return `${cleaned.slice(0, 120)}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vdir = join(args.flow, args.variant);
  mkdirSync(join(vdir, 'traces'), { recursive: true });
  // _state.json is READ-ONLY here. The orchestrator owns it. Absent is fine
  // (a baseline-only run has no loop state yet), but present-and-unparsable
  // must not let the id-space gate below pass vacuously over a corrupt file.
  const statePath = join(args.flow, '_state.json');
  let st = {};
  if (existsSync(statePath)) {
    try { st = JSON.parse(readFileSync(statePath, 'utf8')) || {}; }
    catch (e) { console.error(`${statePath} exists but is not valid JSON (${e?.message || e}) - fix it before spending a pass`); process.exit(2); }
  }
  checkHarness(statePath, st, args.approveHarness);
  const ctx = { ...args, state: st };

  // Resume: which (id, rep) pairs already have a row?
  const resultsPath = join(vdir, 'results.jsonl');
  const done = new Set();
  if (existsSync(resultsPath))
    for (const ln of readFileSync(resultsPath, 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      try { const r = JSON.parse(ln); done.add(`${r.prompt_id}\0${r.rep}`); } catch {}
    }
  // Rows key on the path-safe id (see pathSafeId), so resume must too.

  const cases = await loadCases();
  // Validate the id space before spending anything: duplicate path-safe ids - 
  // including case-insensitive twins, which macOS/Windows filesystems collapse - 
  // would silently overwrite traces and frozen refs; and a _state.json split id
  // that matches no case would silently shrink the scored denominator.
  const seen = new Map();
  for (const c of cases) {
    const k = pathSafeId(c.id).toLowerCase();
    if (seen.has(k)) {
      console.error(`duplicate case id after sanitization: '${c.id}' collides with '${seen.get(k)}'`);
      process.exit(2);
    }
    seen.set(k, c.id);
  }
  const safeIds = new Set(cases.map(c => pathSafeId(c.id)));
  for (const sid of [...(st.train_ids ?? []), ...(st.val_ids ?? []), ...(st.test_ids ?? [])]) {
    const s = String(sid); // the adapter joins with String() on both sides - numeric ids are fine
    if (safeIds.has(s)) continue; // matches a loaded case - definitionally valid
    if (s !== pathSafeId(s)) {
      // Can never match a row: rows key on path-safe ids. This is the silent
      // shrunken-denominator bug - fail before anything is spent.
      console.error(`_state.json split id '${s}' is not a path-safe id - record split ids exactly as they appear in results.jsonl's prompt_id`);
      process.exit(2);
    }
    // Well-formed but absent is legitimate (a trimmed top-K subset run) - note it, don't fail.
    console.error(`note: split id '${s}' matches no loaded case (expected for a trimmed subset run)`);
  }
  const refDir = join(args.flow, 'baseline', 'ref');
  const tasks = [];
  for (const c of cases) for (let rep = 0; rep < args.reps; rep++) {
    if (done.has(`${pathSafeId(c.id)}\0${rep}`)) continue;
    tasks.push({ c, rep });
  }
  console.error(`[${args.variant}] ${tasks.length} of ${cases.length * args.reps} (id,rep) to run`);

  let i = 0, ok = 0, fail = 0;
  const errorsPath = join(vdir, 'errors.jsonl');
  // A hard crash (power loss, ENOSPC) can leave a torn final line with no
  // trailing newline; the next append would merge two rows into one permanently
  // unparseable line. Isolate any fragment before appending anything.
  for (const p of [resultsPath, errorsPath]) {
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    if (buf.length && buf[buf.length - 1] !== 0x0a) appendFileSync(p, '\n');
  }
  async function worker() {
    while (i < tasks.length) {
      const { c, rep } = tasks[i++];
      const safeId = pathSafeId(c.id);
      const t0 = Date.now();
      let lastRun = null;    // survives into the catch - billed spend on a failed attempt
      let rowWritten = false; // set once the results row lands - the attempt is scored
      const deadline = args.timeoutS > 0 ? t0 + args.timeoutS * 1000 : Infinity;
      const appRetry = { count: 0 }, judgeRetry = { count: 0 };
      try {
        // One ceiling over the whole case - app call, identity check, and grading - 
        // so a hung judge stream can't hold the slot either.
        const { run, g, latency_s } = await withTimeout((async () => {
          let tAttempt = t0;
          const run = await withBackoff(() => { tAttempt = Date.now(); return runCase(c, ctx); },
            appRetry, deadline);
          lastRun = run;
          // latency_s = the final app attempt only; backoff sleeps, failed
          // attempts, and judge time are excluded (retry counts are in meta).
          const latency_s = (Date.now() - tAttempt) / 1000;
          // Serving identity: fail loudly when the response was served by a model
          // other than the one requested. Accept exact match or a documented
          // alias->snapshot resolution - 'foo-latest'/'foo-0'/'foo' served as
          // 'foo-20250101', 'foo@20250101', or 'foo-2025-01-01'. Anything else - 
          // another snapshot of the requested pin, a sibling model, or the bare
          // base id ('foo-latest' served as 'foo', an unversioned echo that can
          // hide snapshot drift across rounds) - fails the attempt. Non-Anthropic
          // id schemes (e.g. Bedrock's 'anthropic.claude-...-v1:0') need their own
          // rule here.
          if (ctx.model && run.model && run.model !== ctx.model) {
            const base = ctx.model.replace(/-latest$|-0$/, '');
            const rest = String(run.model).startsWith(base)
              ? String(run.model).slice(base.length) : null;
            if (!(rest != null && /^[-@](\d{8}|\d{4}-\d{2}-\d{2})$/.test(rest))) {
              const e = new Error(`served model ${run.model} != requested ${ctx.model}`);
              e.failure_class = 'serving_substitution';
              throw e;
            }
          }
          // Frozen pairwise reference (never regenerated): baseline/ref/<id>.*
          let ref = null;
          if (args.variant !== 'baseline') {
            const p = join(refDir, safeId);
            for (const ext of ['', '.html', '.txt', '.json'])
              if (existsSync(p + ext)) { ref = readFileSync(p + ext, 'utf8'); break; }
          }
          const g = await withBackoff(() => gradeCase(c, run, ref, ctx), judgeRetry, deadline);
          return { run, g, latency_s };
        })(), args.timeoutS, `${c.id} rep${rep}`);
        const row = {
          prompt_id: safeId, rep, prompt: c.prompt ?? c.input ?? c.id,
          tags: c.tags, attachments: c.attachments,
          meta: safeId !== String(c.id) || appRetry.count || judgeRetry.count
            ? { ...(c.meta ?? {}),
                ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
                ...(appRetry.count ? { retries: appRetry.count } : {}),
                ...(judgeRetry.count ? { judge_retries: judgeRetry.count } : {}) }
            : c.meta,
          model: run.model, usage: run.usage, stop_reason: run.stop_reason,
          judge_model: g.judge_model ?? run.judge_model,
          judge_usage: g.judge_usage ?? run.judge_usage,
          latency_s, ...perfFrom(run),
          grade: g.grade, explanation: g.explanation,
        };
        appendFileSync(resultsPath, JSON.stringify(row) + '\n');
        rowWritten = true; // past this point the attempt is scored - a later throw (trace write, ref freeze) must not also append an error row
        if (run.transcript)
          writeFileSync(join(vdir, 'traces', `${safeId}_rep${rep}.json`),
            JSON.stringify(run.transcript, null, 2));
        // For pairwise: on the baseline run, freeze the reference output once.
        if (args.variant === 'baseline' && run.output != null && !existsSync(join(refDir, safeId))) {
          mkdirSync(refDir, { recursive: true });
          writeFileSync(join(refDir, safeId),
            typeof run.output === 'string' ? run.output : JSON.stringify(run.output));
        }
        ok++;
      } catch (e) {
        fail++;
        if (rowWritten) {
          // The attempt scored; only a post-row write (trace, ref) failed. An error
          // row here would double-count the billed usage under the budget rule.
          console.error(`  [${args.variant}] ${c.id} rep${rep} scored, but a post-row write failed: ${e?.message || e}`);
          continue;
        }
        // Failed attempts are data too - but they must not occupy the (case, rep)
        // slot in results.jsonl, or resume would never re-run them.
        appendFileSync(errorsPath, JSON.stringify({
          prompt_id: safeId, rep,
          ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
          failure_class: e?.failure_class ?? 'error',
          error: String(e?.message || e),
          retries: appRetry.count, judge_retries: judgeRetry.count,
          // Billed-but-failed spend stays countable: when the app call completed
          // before the failure (e.g. a served-model mismatch, a judge-stage
          // ceiling), carry its identity and usage on the error row.
          model: lastRun?.model, usage: lastRun?.usage,
          judge_model: e?.judge_model ?? lastRun?.judge_model,
          judge_usage: e?.judge_usage ?? lastRun?.judge_usage,
          latency_s: (Date.now() - t0) / 1000,
        }) + '\n');
        console.error(`  [${args.variant}] ${c.id} rep${rep} FAILED: ${e?.message || e}`);
      }
    }
  }
  // One progress line every 30s (and to <vdir>/progress.txt) so "how far along
  // is it?" is answerable from the background shell's output or one file read,
  // without the orchestrator parsing results.jsonl mid-write. ETA is a plain
  // rate extrapolation from this pass.
  const t0 = Date.now();
  const progress = () => {
    const done = ok + fail, total = tasks.length;
    const el = (Date.now() - t0) / 1000;
    const eta = done ? Math.round((el / done) * (total - done)) : null;
    const line = `[${args.variant}] ${done}/${total} done (${ok} ok, ${fail} failed), `
      + `${Math.round(el)}s elapsed` + (eta != null ? `, ~${eta}s left` : '');
    console.error(line);
    try { writeFileSync(join(vdir, 'progress.txt'), line + '\n'); } catch {}
  };
  const tick = setInterval(progress, 30_000);
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  clearInterval(tick); progress();
  console.error(`[${args.variant}] done - ${ok} ok, ${fail} failed -> ${resultsPath}`);
  process.exit(fail ? 1 : 0);
}

main();
