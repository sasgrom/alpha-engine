import type { GenerateResult } from "./ollama";

const ROOT = (process.env.STRATA_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "").replace(/\/v1$/, "");
const API_KEY = process.env.STRATA_API_KEY;

export interface StrataGenerateResult extends GenerateResult {
  inputTokens: number;
  cachedTokens: number;
  readTokens: number;
  engineDecodeTokens: number;
  finishReason: string | null;
  hasEngineTimings: boolean;
}

function headers(): Record<string, string> {
  return { "content-type": "application/json", ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}) };
}
const number = (x: unknown) => Number.isFinite(Number(x)) ? Number(x) : 0;

export async function strataStatus(): Promise<{ ok: boolean; models: string[]; health: unknown | null }> {
  try {
    const healthRes = await fetch(`${ROOT}/health`, { headers: headers(), signal: AbortSignal.timeout(5000) });
    if (!healthRes.ok) return { ok: false, models: [], health: null };
    const health = await healthRes.json().catch(() => null);
    const res = await fetch(`${ROOT}/v1/models`, { headers: headers(), signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, models: [], health };
    const j = await res.json() as any;
    const models = (j.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
    return { ok: true, models, health };
  } catch {
    return { ok: false, models: [], health: null };
  }
}

/** One non-streaming OpenAI-compatible request. No retry and no token estimate:
 * usage/timings come from Strata; missing values remain zero in the generic
 * result and are flagged by hasEngineTimings=false. */
export async function generateStrata(
  prompt: string,
  opts: { model: string; timeoutMs?: number; numPredict?: number }
): Promise<StrataGenerateResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
  const started = Date.now();
  try {
    const res = await fetch(`${ROOT}/v1/chat/completions`, {
      method: "POST", headers: headers(), signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: opts.numPredict ?? 256,
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`strata HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json() as any;
    const choice = j.choices?.[0] ?? {};
    const content = choice.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((p: any) => typeof p === "string" ? p : p?.text ?? "").join("") : "";
    const usage = j.usage ?? {}, timings = j.timings ?? {};
    const inputTokens = number(usage.prompt_tokens);
    const cachedTokens = number(usage.prompt_tokens_details?.cached_tokens ?? timings.cache_n);
    const readTokens = timings.prompt_n !== undefined ? number(timings.prompt_n) : Math.max(0, inputTokens - cachedTokens);
    const evalCount = number(usage.completion_tokens);
    const promptEvalMs = number(timings.prompt_ms);
    const evalMs = number(timings.predicted_ms);
    const engineDecodeTokens = number(timings.predicted_n);
    return {
      text,
      model: String(j.model ?? opts.model),
      totalMs: Date.now() - started,
      loadMs: 0,
      promptEvalCount: readTokens,
      promptEvalMs,
      evalCount,
      evalMs,
      evalPerSec: evalMs > 0 ? Math.round((evalCount / (evalMs / 1000)) * 10) / 10 : 0,
      inputTokens,
      cachedTokens,
      readTokens,
      engineDecodeTokens,
      finishReason: choice.finish_reason ?? null,
      hasEngineTimings: Boolean(timings.prompt_ms !== undefined && timings.predicted_ms !== undefined),
    };
  } finally {
    clearTimeout(timer);
  }
}
