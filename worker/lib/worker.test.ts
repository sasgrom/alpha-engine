/**
 * Unit tests for the worker normalizers — pure functions, no network, no DB.
 * Run: npx vitest run worker/lib/worker.test.ts
 */
import { describe, expect, it } from "vitest";
import { toneFromBins, hourBucket, countArticles, buildGdeltRows } from "./gdelt";
import { aggregateStream, buildStocktwitsRows } from "./stocktwits";

describe("gdelt: toneFromBins", () => {
  it("computes weighted average normalized to [-1,1]", () => {
    const { score, articles } = toneFromBins([
      { bin: -5, count: 2 },
      { bin: 5, count: 2 },
    ]);
    expect(score).toBe(0);
    expect(articles).toBe(4);
  });
  it("is skewed by volume, not by bin count", () => {
    const { score } = toneFromBins([
      { bin: -8, count: 90 },
      { bin: 10, count: 10 },
    ]);
    expect(score).toBeCloseTo(-0.62, 2);
  });
  it("clamps extreme tones into the contract range", () => {
    expect(toneFromBins([{ bin: 100, count: 5 }]).score).toBe(1);
    expect(toneFromBins([{ bin: -100, count: 5 }]).score).toBe(-1);
  });
  it("returns null score on empty/garbage input", () => {
    expect(toneFromBins([]).score).toBeNull();
    expect(toneFromBins([{ bin: "x", count: "y" }]).score).toBeNull();
    expect(toneFromBins([{ bin: 3, count: 0 }]).score).toBeNull();
  });
  it("accepts string-typed bins (JSON defensive)", () => {
    expect(toneFromBins([{ bin: "-4", count: "2" }]).score).toBeCloseTo(-0.4, 3);
  });
});

describe("gdelt: hourBucket + rows", () => {
  it("formats UTC hour bucket and key", () => {
    const b = hourBucket(new Date("2026-10-22T17:43:11Z"));
    expect(b.eventTs).toBe("2026-10-22 17:00:00");
    expect(b.key).toBe("2026102217");
  });
  it("buildGdeltRows emits buzz always, tone only when scored", () => {
    const b = hourBucket(new Date("2026-10-22T17:43:11Z"));
    const rows = buildGdeltRows(320193, b, [{ bin: 2, count: 10 }], { articles: [{}, {}, {}] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ cik: 320193, source: "gdelt", signalType: "buzz", magnitude: 10, payloadKey: "gdelt:buzz:320193:2026102217" });
    expect(rows[1]).toMatchObject({ signalType: "tone", score: 0.2 });
    // no tone data → only buzz
    const rows2 = buildGdeltRows(320193, b, [], { articles: [{}] });
    expect(rows2).toHaveLength(1);
    expect(rows2[0].magnitude).toBe(1);
  });
  it("countArticles is defensive about shape", () => {
    expect(countArticles({})).toBe(0);
    expect(countArticles(null)).toBe(0);
    expect(countArticles({ articles: [1, 2] })).toBe(2);
  });
});

describe("stocktwits: aggregateStream + rows", () => {
  const msgs = [
    { id: 100, created_at: "2026-10-22T10:00:00Z", entities: { sentiment: { basic: "Bullish" } } },
    { id: 105, created_at: "2026-10-22T11:00:00Z", entities: { sentiment: { basic: "Bearish" } } },
    { id: 103, created_at: "2026-10-22T10:30:00Z", entities: { sentiment: null } },
    { id: 102, created_at: "2026-10-22T10:20:00Z", entities: {} },
  ];
  it("aggregates counts, score and NEWEST message by id", () => {
    const agg = aggregateStream(msgs);
    expect(agg.total).toBe(4);
    expect(agg.bullish).toBe(1);
    expect(agg.bearish).toBe(1);
    expect(agg.score).toBe(0);
    expect(agg.newestId).toBe("105");
    expect(agg.newestTs).toBe("2026-10-22 11:00:00");
  });
  it("score is null when nothing labeled", () => {
    expect(aggregateStream([{ id: 1, created_at: "2026-10-22T00:00:00Z", entities: null }]).score).toBeNull();
  });
  it("extreme one-sided streams hit ±1", () => {
    const all = [1, 2, 3].map((i) => ({ id: i, created_at: "2026-10-22T00:00:00Z", entities: { sentiment: { basic: "Bullish" } } }));
    expect(aggregateStream(all).score).toBe(1);
  });
  it("rows are idempotent: same stream → same payloadKeys", () => {
    const a1 = buildStocktwitsRows(320193, aggregateStream(msgs));
    const a2 = buildStocktwitsRows(320193, aggregateStream([...msgs].reverse()));
    expect(a1.map((r) => r.payloadKey)).toEqual(a2.map((r) => r.payloadKey));
    expect(a1[0].payloadKey).toBe("st:buzz:320193:105:4");
  });
  it("empty stream yields no rows", () => {
    expect(buildStocktwitsRows(1, aggregateStream([]))).toEqual([]);
  });
});
