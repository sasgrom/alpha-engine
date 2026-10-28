import { describe, expect, it } from "vitest";
import { compareScores, evenSample, REPORT_ENGINES } from "./tone-ab";
import { generateStrata } from "./strata";

describe("tone A/B sampling and score comparison", () => {
  it("keeps both engine summaries after a single-engine continuation", () => {
    expect(REPORT_ENGINES).toEqual(["ollama", "strata"]);
  });

  it("samples the full history deterministically with both endpoints", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const sample = evenSample(rows, 100);
    expect(sample).toHaveLength(100);
    expect(sample[0]).toBe(0);
    expect(sample.at(-1)).toBe(999);
    expect(new Set(sample).size).toBe(100);
    expect(evenSample(rows, 100)).toEqual(sample);
  });

  it("computes agreement without treating it as absolute quality", () => {
    const q = compareScores([{ a: 0, b: 0 }, { a: 1, b: 1 }]);
    expect(q.n).toBe(2);
    expect(q.meanDelta).toBe(0);
    expect(q.mae).toBe(0);
    expect(q.pearson).toBe(1);
    expect(q.signAgreement).toBe(1);
    expect(compareScores([]).n).toBe(0);
  });
});

describe("Strata OpenAI adapter", () => {
  it("preserves cached/read/generated accounting and engine timings", async () => {
    const original = globalThis.fetch;
    let body: any;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: "qwen-test",
        choices: [{ finish_reason: "stop", message: { content: '{"score":0.2,"why":"ok"}' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 200 } },
        timings: { prompt_n: 800, prompt_ms: 4000, predicted_n: 48, predicted_ms: 2000, cache_n: 200 },
      }), { status: 200 });
    };
    try {
      const r = await generateStrata("test", { model: "qwen-test", numPredict: 256 });
      expect(body.temperature).toBe(0);
      expect(body.reasoning_effort).toBe("none");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.max_tokens).toBe(256);
      expect(r.inputTokens).toBe(1000);
      expect(r.cachedTokens).toBe(200);
      expect(r.readTokens).toBe(800);
      expect(r.promptEvalCount).toBe(800);
      expect(r.promptEvalMs).toBe(4000);
      expect(r.evalCount).toBe(50);
      expect(r.engineDecodeTokens).toBe(48);
      expect(r.evalPerSec).toBe(25);
      expect(r.hasEngineTimings).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
