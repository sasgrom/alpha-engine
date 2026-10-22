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
  evalCount: number; // tokens generated
  evalPerSec: number;
}

/** Raw generate call (non-streaming). Throws on daemon errors. */
export async function generate(prompt: string, opts: { model?: string; timeoutMs?: number; numPredict?: number; temperature?: number } = {}): Promise<GenerateResult> {
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
        // Qwen3.x supports a "thinking" mode; disable it so the reply is
        // pure JSON and extractScore never has to dig through chain-of-thought.
        think: false,
        options: { temperature: opts.temperature ?? 0, num_predict: opts.numPredict ?? 512, num_ctx: NUM_CTX },
      }),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as any;
    const totalMs = Math.round((j.total_duration ?? 0) / 1e6);
    const evalCount = j.eval_count ?? 0;
    const evalPerSec = j.eval_duration ? Math.round((evalCount / (j.eval_duration / 1e9)) * 10) / 10 : 0;
    return { text: j.response ?? "", model, totalMs, evalCount, evalPerSec };
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
 * A scored verdict: score {-1..1} plus a one-line human-facing rationale.
 * 5c: the "why" doubles as validation (we can SEE what the model concluded)
 * and as UI content for the signals stream.
 */
export interface Verdict { score: number; why: string | null }

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
      ? j.why.replace(/[\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 480)
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

/** Prompt for financial-text tone scoring (filing section or paragraph). */
export function tonePrompt(text: string): string {
  return `You are a financial sentiment rater. Rate the tone of the text below about the company it mentions, from the perspective of a long-term investor.

Reply with ONLY a JSON object, no other text:
{"score": <number from -1.0 to 1.0>, "why": "<3-4 short sentences for a human reader: what the company reported or announced, the key numbers/facts, and why it matters to investors>"}
-1.0 = very negative, 0 = neutral or mixed, +1.0 = very positive.
Judge the facts and outlook, not the writing style.
Rules for "why": start with the fact itself — NEVER begin with "The text", "The filing", "This document"; name concrete figures and events; if the content carries no substance (cover page, table of contents), write "no substantive content" as the whole why.

TEXT:
"""
${text.slice(0, MAX_INPUT_CHARS)}
"""`;
}
