import { describe, expect, it } from "vitest";
import { nextLlmFailureStreak, shouldAbortLlmBatch } from "./llm-run-policy";

describe("LLM batch failure policy", () => {
  it("does not abort on isolated schema or content failures", () => {
    expect(nextLlmFailureStreak("unparsed", 0)).toBe(0);
    expect(nextLlmFailureStreak("empty", 0)).toBe(0);
    expect(shouldAbortLlmBatch(0)).toBe(false);
  });

  it("aborts only after two consecutive transport failures", () => {
    const first = nextLlmFailureStreak("request_failed", 0);
    const second = nextLlmFailureStreak("request_failed", first);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(shouldAbortLlmBatch(second)).toBe(true);
  });

  it("resets the transport streak after a valid response", () => {
    expect(nextLlmFailureStreak("extracted", 1)).toBe(0);
  });
});
