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
export const LLM_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:14b-instruct-q4_k_m";

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
        options: { temperature: opts.temperature ?? 0, num_predict: opts.numPredict ?? 256 },
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
 * Extract a {-1..1} sentiment score from the model's reply. The prompt
 * demands strict JSON {"score": x}; we parse defensively: first JSON object
 * anywhere in the reply, score clamped. Returns null when unparsable —
 * the caller SKIPS the row rather than storing a guess (honesty).
 */
export function extractScore(reply: string): number | null {
  const m = reply.match(/\{[^{}]*"score"[^{}]*\}/s) ?? reply.match(/\{[^{}]*\}/s);
  if (!m) return null;
  try {
    const v = Number(JSON.parse(m[0]).score);
    if (!Number.isFinite(v)) return null;
    return Math.max(-1, Math.min(1, Math.round(v * 1000) / 1000));
  } catch {
    return null;
  }
}

/** Prompt for financial-text tone scoring (headline or short paragraph). */
export function tonePrompt(text: string): string {
  return `You are a financial sentiment rater. Rate the tone of the text below about the company it mentions, from the perspective of a long-term investor.

Reply with ONLY a JSON object, no other text: {"score": <number from -1.0 to 1.0>}
-1.0 = very negative, 0 = neutral or mixed, +1.0 = very positive.
Judge the facts and outlook, not the writing style.

TEXT:
"""
${text.slice(0, 3000)}
"""`;
}
