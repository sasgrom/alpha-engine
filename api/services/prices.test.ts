/**
 * Prices service tests (3f): provider parsers (stooq CSV / yahoo chart JSON),
 * derived statistics (change, 52-week window, average volume, 5Y beta) and
 * the range-chip start-date math. DB-touching functions are not covered here
 * (they need MySQL) — everything below is pure.
 */
import { describe, expect, it } from "vitest";
import { avgVolume, beta5y, changePct, mergeBars, parseStooqCsv, parseYahooChart, week52, type StoredBar } from "./prices";
import { rangeStart } from "../routers/prices";

describe("parseStooqCsv", () => {
  it("parses bars and sets adjClose = close (stooq is pre-adjusted)", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2025-01-02,100,105,99,104,1234567\n2025-01-03,104,106,103,105.5,987654\n";
    const bars = parseStooqCsv(csv);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({ date: "2025-01-02", open: 100, high: 105, low: 99, close: 104, adjClose: 104, volume: 1234567 });
    expect(bars[1].close).toBe(105.5);
  });

  it("skips halted-day null rows and empty payloads", () => {
    expect(parseStooqCsv("Date,Open,High,Low,Close,Volume\n")).toEqual([]);
    const csv = "Date,Open,High,Low,Close,Volume\n2025-01-02,null,null,null,null,null\n2025-01-03,1,2,0.5,1.5,10\n";
    const bars = parseStooqCsv(csv);
    expect(bars).toHaveLength(1);
    expect(bars[0].date).toBe("2025-01-03");
  });
});

describe("parseYahooChart", () => {
  it("maps timestamps to trading dates, uses adjclose, skips null closes", () => {
    const t1 = Date.UTC(2025, 0, 2, 21) / 1000; // 2025-01-02 21:00 UTC (market close)
    const t2 = Date.UTC(2025, 0, 3, 21) / 1000;
    const t3 = Date.UTC(2025, 0, 6, 21) / 1000;
    const json = {
      chart: {
        result: [
          {
            timestamp: [t1, t2, t3],
            indicators: {
              quote: [{ open: [10, 11, 12], high: [12, 13, null], low: [9, 10, null], close: [11, 12.5, null], volume: [100, 200, null] }],
              adjclose: [{ adjclose: [10.8, 12.3, null] }],
            },
          },
        ],
        error: null,
      },
    };
    const bars = parseYahooChart(json);
    expect(bars).toHaveLength(2); // the null-close bar is dropped
    expect(bars[0]).toEqual({ date: "2025-01-02", open: 10, high: 12, low: 9, close: 11, adjClose: 10.8, volume: 100 });
    expect(bars[1].date).toBe("2025-01-03");
    expect(bars[1].adjClose).toBe(12.3);
  });

  it("falls back to raw close when adjclose is missing", () => {
    const t1 = Date.UTC(2025, 0, 2, 21) / 1000;
    const json = {
      chart: { result: [{ timestamp: [t1], indicators: { quote: [{ close: [50], open: [49], high: [51], low: [48], volume: [1] }] } }], error: null },
    };
    expect(parseYahooChart(json)[0].adjClose).toBe(50);
  });
});

/** helper: synthetic daily bars, business days only, i = trading-day index */
function mkBars(closes: number[], start = "2024-01-02"): StoredBar[] {
  const out: StoredBar[] = [];
  const d = new Date(start + "T00:00:00Z");
  let i = 0;
  for (const c of closes) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push({
      date: d.toISOString().slice(0, 10),
      open: c, high: c * 1.01, low: c * 0.99, close: c, adjClose: c,
      volume: 1000 + i,
      source: "stooq",
    });
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
  }
  return out;
}

describe("changePct", () => {
  it("computes relative change and guards zero prev", () => {
    expect(changePct(105, 100)).toBeCloseTo(0.05);
    expect(changePct(90, 100)).toBeCloseTo(-0.1);
    expect(changePct(100, 0)).toBeNull();
  });
});

describe("week52", () => {
  it("takes raw high/low extremes inside the window", () => {
    const old = mkBars([100], "2020-01-02"); // outside the window
    const recent = mkBars([50, 60, 55], new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10));
    const w = week52([...old, ...recent]);
    expect(w.high).toBeCloseTo(60 * 1.01);
    expect(w.low).toBeCloseTo(50 * 0.99);
  });

  it("anchors the 52-week window to the LAST BAR, not wall-clock now", () => {
    // 2020 data only: a today-anchored window would find nothing at all
    const bars = mkBars([10, 20, 15], "2020-03-02");
    const w = week52(bars);
    expect(w.high).toBeCloseTo(20 * 1.01);
    expect(w.low).toBeCloseTo(10 * 0.99);
  });

  it("returns nulls for an empty series", () => {
    expect(week52([])).toEqual({ high: null, low: null });
  });
});

describe("avgVolume", () => {
  it("averages volume within the window, ignoring nulls and old bars", () => {
    const bars = mkBars([10, 10, 10], new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10));
    bars[0].volume = 300;
    bars[1].volume = 900;
    bars[2].volume = null;
    expect(avgVolume(bars, 92)).toBeCloseTo(600);
    expect(avgVolume([], 92)).toBeNull();
  });

  it("anchors the window to the LAST BAR, not wall-clock now (stale archive data)", () => {
    // last bar ~200 days in the past: a today-anchored 3M window would be
    // empty, but relative to the data itself the window is full
    const bars = mkBars([5, 5, 5], "2020-06-01");
    bars.forEach((b) => (b.volume = 1000));
    expect(avgVolume(bars, 92)).toBeCloseTo(1000);
  });
});

describe("mergeBars (3h: per-date stooq priority, yahoo fills gaps)", () => {
  const bar = (date: string, close: number, source: string): StoredBar =>
    ({ date, open: close, high: close, low: close, close, adjClose: close, volume: 1, source });

  it("unions dates, sorts ascending, and lets the primary win conflicts", () => {
    const stooq = [bar("2026-01-02", 100, "stooq"), bar("2026-01-05", 101, "stooq")];
    const yahoo = [bar("2026-01-05", 999, "yahoo"), bar("2026-01-06", 102, "yahoo")];
    const m = mergeBars(stooq, yahoo);
    expect(m.map((b) => b.date)).toEqual(["2026-01-02", "2026-01-05", "2026-01-06"]);
    expect(m[1].close).toBe(101); // stooq wins the shared date
    expect(m[1].source).toBe("stooq");
    expect(m[2].source).toBe("yahoo"); // yahoo-only date survives
  });

  it("handles empty inputs", () => {
    expect(mergeBars([], [bar("2026-01-02", 1, "yahoo")])).toHaveLength(1);
    expect(mergeBars([bar("2026-01-02", 1, "stooq")], [])).toHaveLength(1);
    expect(mergeBars([], [])).toEqual([]);
  });
});

describe("beta5y", () => {
  it("recovers a known leverage: asset = 2× benchmark monthly returns", () => {
    // 36 months of synthetic data: benchmark monthly return r_m alternates,
    // asset return is exactly 2×r_m → OLS beta must be ≈ 2
    const bench: StoredBar[] = [];
    const asset: StoredBar[] = [];
    let pb = 100;
    let pa = 100;
    for (let m = 0; m < 36; m++) {
      const r = (m % 4 === 0 ? -0.02 : 0.03); // non-constant benchmark variance
      const rb = r;
      const ra = 2 * r;
      pb *= 1 + rb;
      pa *= 1 + ra;
      // one bar per month is enough: monthLast takes the last bar per month
      const date = new Date(Date.UTC(2022, m, 28)).toISOString().slice(0, 10);
      bench.push({ date, open: pb, high: pb, low: pb, close: pb, adjClose: pb, volume: 1, source: "stooq" });
      asset.push({ date, open: pa, high: pa, low: pa, close: pa, adjClose: pa, volume: 1, source: "stooq" });
    }
    expect(beta5y(asset, bench)).toBeCloseTo(2, 6);
  });

  it("returns null when fewer than 24 overlapping month-ends exist", () => {
    const bars = mkBars([1, 2, 3, 4, 5]);
    expect(beta5y(bars, bars)).toBeNull();
  });
});

describe("rangeStart", () => {
  it("computes YTD as Jan 1 of the current UTC year; ALL is unbounded", () => {
    expect(rangeStart("YTD")).toBe(`${new Date().getUTCFullYear()}-01-01`);
    expect(rangeStart("ALL")).toBeUndefined();
    expect(rangeStart("1M")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
