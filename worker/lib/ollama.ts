/**
 * Ollama client for the home worker (4p→5a lineage) — pure HTTP, no deps.
 * Talks to the local Ollama daemon (default http://127.0.0.1:11434).
 *
 * Honesty rules for LLM-scored rows (D49+): provenance is carried in the
 * payloadKey prefix ("llm:<model>:") so model-scored sentiment NEVER mixes
 * with human labels or GDELT's own tone in downstream analytics.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const BASE = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
// Default: qwen3.5:9b (Feb 2026 gen, ~6.6GB Q4, 256K ctx, fits 16GB VRAM
// with KV-cache headroom). Override via OLLAMA_MODEL env.
export const LLM_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";

/**
 * Effective context window. The MODEL advertises 256K, but Ollama silently
 * defaults num_ctx to 4096 — long prompts would be truncated without this.
 * 32K tokens ≈ 128K chars covers any MD&A section whole; the KV cache still
 * fits a 16GB card alongside the 6.6GB weights. Raise via OLLAMA_NUM_CTX if
 * needed (watch `ollama ps` for the CPU/GPU split).
 */
export const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 32768);
/** ~80% of NUM_CTX in chars (English ≈ 4 chars/token), minus the template. */
export const MAX_INPUT_CHARS = Math.floor(NUM_CTX * 0.8 * 4); // 32768 → ~104k

export interface GenerateResult {
  text: string;
  model: string;
  totalMs: number;
  loadMs: number;
  promptEvalCount: number;
  promptEvalMs: number;
  evalCount: number; // tokens generated
  evalMs: number;
  evalPerSec: number;
}

/** Raw generate call (non-streaming). Throws on daemon errors. */
export async function generate(prompt: string, opts: { model?: string; timeoutMs?: number; numPredict?: number; temperature?: number; jsonMode?: boolean; keepAlive?: string | number } = {}): Promise<GenerateResult> {
  const model = opts.model ?? LLM_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model, prompt, stream: false,
        keep_alive: opts.keepAlive ?? process.env.OLLAMA_KEEP_ALIVE ?? "30m",
        // Qwen3.x supports a "thinking" mode; disable it so the reply is
        // pure JSON and extractScore never has to dig through chain-of-thought.
        think: false,
        ...(opts.jsonMode ? { format: {
          type: "object",
          properties: { score: { type: "number" }, why: { type: "string" } },
          required: ["score", "why"],
        } } : {}),
        options: { temperature: opts.temperature ?? 0, num_predict: opts.numPredict ?? 512, num_ctx: NUM_CTX },
      }),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as any;
    const totalMs = Math.round((j.total_duration ?? 0) / 1e6);
    const loadMs = Math.round((j.load_duration ?? 0) / 1e6);
    const promptEvalCount = j.prompt_eval_count ?? 0;
    const promptEvalMs = Math.round((j.prompt_eval_duration ?? 0) / 1e6);
    const evalCount = j.eval_count ?? 0;
    const evalMs = Math.round((j.eval_duration ?? 0) / 1e6);
    const evalPerSec = j.eval_duration ? Math.round((evalCount / (j.eval_duration / 1e9)) * 10) / 10 : 0;
    return { text: j.response ?? "", model, totalMs, loadMs, promptEvalCount, promptEvalMs, evalCount, evalMs, evalPerSec };
  } finally {
    clearTimeout(timer);
  }
}

/** Daemon liveness + which models are pulled. */
export async function status(): Promise<{ ok: boolean; models: string[] }> {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, models: [] };
    const j = (await res.json()) as any;
    return { ok: true, models: (j.models ?? []).map((m: any) => m.name) };
  } catch {
    return { ok: false, models: [] };
  }
}

/**
 * Human-facing cleanup of the model's "why": models keep opening with
 * "The text is/contains…" despite the prompt ban — strip the template
 * opener and re-capitalize. The substance that follows is kept verbatim.
 */
export function sanitizeWhy(why: string): string {
  let s = why.trim();
  s = s.replace(/^(the|this)\s+(text|filing|document|current report|report|form\s+\S+)\s+(is|contains|reports?|presents?|details?|merely|only|consists?\s+of|outlines?|describes?)\s+/i, "");
  s = s.replace(/^(the|this)\s+(text|filing|document|current report|report)\s+/i, "");
  return s ? s[0].toUpperCase() + s.slice(1) : why;
}

/**
 * A scored verdict: score {-1..1} plus a one-line human-facing rationale.
 * 5c: the "why" doubles as validation (we can SEE what the model concluded)
 * and as UI content for the signals stream.
 */
export interface Verdict { score: number; why: string | null }

const HARD_VACUUM_RE = /no substantive|zero substantive|no financial (data|results)|no operational (updates?|data)|empty (procedural )?document|cannot assess|can't assess|rather than substantive|only (a )?(table of contents|administrative|xbrl|cover)|without (including|containing) (the )?(actual|key|financial)|does not (include|contain) (the )?(actual|key|financial)/i;
const VACUUM_CONTEXT_RE = /procedural|sworn statements?|under oath|sarbanes|compliance (filing|certification)|cover page|boilerplate|standard legal disclaimers/i;
const INVESTMENT_SUBSTANCE_RE = /\b(?:acquisition|agreement|backlog|bankruptcy|buyback|cash flow|ceo|cfo|debt|default|director|dividend|earnings|guidance|layoffs?|loss|margin|merger|officer|orders|production|profit|repurchase|resign(?:ed|ation)|revenue|sales|shipments)\b/i;

/** Drop only explicit vacuum classifications. A mere word like "procedural"
 * must not erase a window that also contains an investment-relevant event. */
export function isBoilerplateRationale(why: string): boolean {
  const s = why.trim();
  if (!s) return false;
  if (HARD_VACUUM_RE.test(s)) return true;
  return VACUUM_CONTEXT_RE.test(s) && !INVESTMENT_SUBSTANCE_RE.test(s);
}

/**
 * Extract a verdict from the model's reply. The prompt demands strict JSON
 * {"score": x, "why": "…"}; we parse defensively: first JSON object anywhere
 * in the reply, score clamped, why sanitized (single line, ≤400 chars).
 * Returns null when unparsable — the caller SKIPS the row rather than
 * storing a guess (honesty).
 */
export function extractVerdict(reply: string): Verdict | null {
  const m = reply.match(/\{[^{}]*"score"[^{}]*\}/s) ?? reply.match(/\{[^{}]*\}/s);
  if (!m) return null;
  try {
    // models sometimes emit literal newlines inside string values — that is
    // invalid JSON; collapsing control whitespace makes the blob parseable
    // (and single-lines the note content as a side effect, which we want)
    const j = JSON.parse(m[0].replace(/[\r\n\t]+/g, " "));
    const v = Number(j.score);
    if (!Number.isFinite(v)) return null;
    const score = Math.max(-1, Math.min(1, Math.round(v * 1000) / 1000));
    const why = typeof j.why === "string" && j.why.trim()
      ? sanitizeWhy(j.why.replace(/[\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim()).slice(0, 480)
      : null;
    return { score, why: why ? why.slice(0, 480) : why };
  } catch {
    return null;
  }
}

/** Back-compat wrapper: score only. */
export function extractScore(reply: string): number | null {
  return extractVerdict(reply)?.score ?? null;
}

export interface TonePromptContext { ticker?: string; form?: string }

/** Prompt v2 for benchmark evaluation: materiality-first rubric and evidence discipline. */
export function tonePromptV2(text: string, context: TonePromptContext = {}): string {
  const company = context.ticker ? `Company ticker: ${context.ticker}\n` : "";
  const form = context.form ? `Filing form: ${context.form}\n` : "";
  return `You are a financial sentiment rater. Rate the tone of the text below about the company it mentions, from the perspective of a long-term investor.

${company}${form}Reply with ONLY a JSON object, no other text:
{"score": <number from -1.0 to 1.0>, "why": "<2 short factual sentences for a human reader, maximum 60 words: what the company reported and why it matters to investors>"}

Evaluate investor materiality, not writing style or the number of positive statements. Use these anchors as guidance, not a forced grid:
-1.0 = severe operational, financial or liquidity deterioration.
-0.5 = material negative information.
 0.0 = mixed information, procedural content, or no investment signal.
+0.5 = material positive information.
+1.0 = exceptional broad improvement in operations, cash flow, balance sheet or guidance.

Evidence discipline:
- Weigh operating results and guidance first, then cash flow, liquidity, debt and reserves, then capital allocation, and finally procedural material.
- Dividends and buybacks do not offset deteriorating earnings, liquidity, underwriting performance or guidance by themselves.
- Never infer fines, fraud, investigations, governance failures, future distress or causal consequences not explicitly stated in the source.
- Use only the company, fiscal period and figures stated in the source. Do not invent dates, periods, companies or current performance.
- Do not use causal clichés such as "signals robust financial health" or "threatens long-term value" unless the causal link is explicit in the text.
- Cover pages, reference-only exhibits, glossaries and procedural text are not negative: score exactly 0 and write "no substantive content".
- When material positive and negative facts coexist, state both and weigh their importance rather than counting them.

Rules for "why": start with the fact itself — NEVER begin with "The text", "The filing", "This document"; name concrete figures and events; describe ONLY what the document states — never infer investigations, fraud, or admissions it does not explicitly make.

TEXT:
"""
${text.slice(0, MAX_INPUT_CHARS)}
"""`;
}

/** Prompt v3: v2 evidence discipline plus anti-pessimism calibration. */
export function tonePromptV3(text: string, context: TonePromptContext = {}): string {
  const company = context.ticker ? `Company ticker: ${context.ticker}\n` : "";
  const form = context.form ? `Filing form: ${context.form}\n` : "";
  return `You are a financial sentiment rater. Rate the tone of the text below about the company it mentions, from the perspective of a long-term investor.

${company}${form}Reply with ONLY a JSON object, no other text:
{"score": <number from -1.0 to 1.0>, "why": "<2 short factual sentences for a human reader, maximum 60 words: what the company reported and why it matters to investors>"}

Evaluate investor materiality, not writing style or the number of positive or negative statements. Use these anchors as guidance, not a forced grid:
-1.0 = severe operational, financial or liquidity deterioration.
-0.5 = material negative information.
 0.0 = mixed information, procedural content, or no investment signal.
+0.5 = material positive information.
+1.0 = exceptional broad improvement in operations, cash flow, balance sheet or guidance.

Evidence discipline:
- Weigh operating results and guidance first, then cash flow, liquidity, debt and reserves, then capital allocation, and finally procedural material.
- Separate one-off charges, impairments, litigation or reserve remeasurements from recurring operating trends. A one-off negative item is not automatically a long-term bearish signal.
- Do not flip the score negative solely because the document contains risk factors, conservative language, reserve strengthening or impairment charges. A negative sign requires dominant deterioration in core operations, liquidity, balance sheet or forward guidance.
- Positive operating improvements and direct shareholder benefits must not be erased by procedural presentation or unrelated risks. Higher acquisition consideration is a direct benefit for target shareholders. Buybacks and dividends count only when supported by sustainable cash generation.
- Historical events must not dominate current operating results unless they create a clear ongoing liability.
- Never infer fines, fraud, investigations, governance failures, future distress or causal consequences not explicitly stated in the source.
- Use only the company, fiscal period and figures stated in the source. Do not invent dates, periods, companies or current performance.
- Do not use causal clichés such as "signals robust financial health" or "threatens long-term value" unless the causal link is explicit in the text.
- Cover pages, reference-only exhibits, glossaries and procedural text are not negative: score exactly 0 and write "no substantive content".
- When material positive and negative facts coexist, state both and weigh their importance rather than counting them.

Rules for "why": start with the fact itself — NEVER begin with "The text", "The filing", "This document"; name concrete figures and events; describe ONLY what the document states — never infer investigations, fraud, or admissions it does not explicitly make.

TEXT:
"""
${text.slice(0, MAX_INPUT_CHARS)}
"""`;
}

/** Prompt v4: full-section net investor effect, turnaround semantics and coverage discipline. */
export function tonePromptV4(text: string, context: TonePromptContext = {}): string {
  const company = context.ticker ? `Company ticker: ${context.ticker}\n` : "";
  const form = context.form ? `Filing form: ${context.form}\n` : "";
  return `You are a financial sentiment rater. Rate the tone of the text below about the company it mentions, from the perspective of a long-term investor.

${company}${form}Reply with ONLY a JSON object, no other text:
{"score": <number from -1.0 to 1.0>, "why": "<2 short factual sentences for a human reader, maximum 60 words: what the company reported and why it matters to investors>"}

Evaluate the NET investor effect over the full section, not isolated positive or negative paragraphs. Use these anchors as guidance, not a forced grid:
-1.0 = severe operational, financial or liquidity deterioration.
-0.5 = material negative information.
 0.0 = mixed information, procedural content, or no investment signal.
+0.5 = material positive information.
+1.0 = exceptional broad improvement in operations, cash flow, balance sheet or guidance.

Materiality and calibration:
- Weigh operating results and guidance first, then cash flow, liquidity, debt and reserves, then capital allocation, and finally procedural material.
- Separate one-off charges, impairments, litigation or reserve remeasurements from recurring operating trends. A one-off negative item is not automatically a long-term bearish signal.
- Do not flip the score negative solely because the document contains risk factors, conservative language, reserve strengthening or impairment charges. A negative sign requires dominant deterioration in core operations, liquidity, balance sheet or forward guidance.
- Turnarounds, restructurings and asset sales require separate treatment of durable improvement/risk reduction versus remaining legacy exposure. Do not score the remaining exposure alone as if the turnaround failed.
- Acquisition consideration and other direct shareholder benefits must not be erased: higher consideration benefits target shareholders; strategic acquisitions may benefit the acquirer when they strengthen control, earnings or strategic fit.
- Buybacks and dividends count only when supported by sustainable cash generation.
- Historical events must not dominate current operating results unless they create a clear ongoing liability.
- When material positive and negative facts coexist, state both and explain which effect dominates, rather than counting facts or defaulting to the negative side.

Evidence discipline:
- Score only when there is concrete investment-relevant substance: operating results, guidance, cash flow, balance-sheet changes, risks with direct economic impact, or transaction terms with direct economic impact. Definitions, glossary-only content, generic risk-factor boilerplate and procedural text have no investment signal: score exactly 0 and write "no substantive content".
- Never infer fines, fraud, investigations, governance failures, future distress or causal consequences not explicitly stated in the source.
- Use only the company, fiscal period and figures stated in the source. Do not invent dates, periods, companies or current performance.
- Do not use causal clichés such as "signals robust financial health" or "threatens long-term value" unless the causal link is explicit in the text.

Rules for "why": start with the fact itself — NEVER begin with "The text", "The filing", "This document"; name concrete figures and events; describe ONLY what the document states — never infer investigations, fraud, or admissions it does not explicitly make.

TEXT:
"""
${text.slice(0, MAX_INPUT_CHARS)}
"""`;
}

/** Prompt for financial-text tone scoring (filing section or paragraph). */
export function tonePrompt(text: string): string {
  return `You are a financial sentiment rater. Rate the tone of the text below about the company it mentions, from the perspective of a long-term investor.

Reply with ONLY a JSON object, no other text:
{"score": <number from -1.0 to 1.0>, "why": "<2 short factual sentences for a human reader, maximum 60 words: what the company reported and why it matters to investors>"}
-1.0 = very negative, 0 = neutral or mixed, +1.0 = very positive.
Judge the facts and outlook, not the writing style.
Rules for "why": start with the fact itself — NEVER begin with "The text", "The filing", "This document"; name concrete figures and events; describe ONLY what the document states — never infer investigations, fraud, or admissions it does not explicitly make.
ROUTINE PROCEDURAL CONTENT IS NOT NEGATIVE: sworn statements/certifications, exhibit-only filings, cover pages, tables of contents carry no investment signal — score exactly 0 and write "no substantive content" as the whole why. Absence of content is not bad news.
A document that merely REFERENCES other documents ("see the attached press release", "as described in the exhibit") without containing their substance is also "no substantive content" — never score the absence of data.

TEXT:
"""
${text.slice(0, MAX_INPUT_CHARS)}
"""`;
}
