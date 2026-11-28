import { describe, expect, it } from "vitest";
import { fetchYahooActions, validYahooActionsAnswer, yahooActionsUrl } from "./yahoo-r1000-actions";

const valid = { chart: { result: [{ timestamp: [1] }] } };

describe("Yahoo corporate actions", () => {
  it("requests events and adjusted close with no provider credential", () => {
    const url = yahooActionsUrl("BRK-B", 2027);
    expect(url).toContain("BRK-B");
    expect(url).toContain("events=div%2Csplits");
    expect(url).toContain("includeAdjustedClose=true");
    expect(validYahooActionsAnswer(valid)).toBe(true);
    expect(validYahooActionsAnswer({ chart: { error: "not found" } })).toBe(false);
  });

  it("retries twice at most and preserves the successful raw body", async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    const result = await fetchYahooActions("AAA", 2027, async (url) => {
      calls.push(url);
      return calls.length === 1 ? { ok: false, status: 500, text: async () => "{}" } : { ok: true, status: 200, text: async () => JSON.stringify(valid) };
    }, async ms => { waits.push(ms); });
    expect(result.attempts).toBe(2);
    expect(result.body).toEqual(valid);
    expect(result.raw).toBe(JSON.stringify(valid));
    expect(waits).toEqual([1500]);
  });

  it("returns an honest error after three attempts", async () => {
    const result = await fetchYahooActions("BAD", 2027, async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ chart: { error: "missing" } }) }), async () => {});
    expect(result).toMatchObject({ attempts: 3 });
    expect(result.error).toContain("404");
  });
});
