import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMarketValueAt, getSchwabLevelBars } from "./market-value";
import type { StoredBar } from "./prices";
import {
  buildSplitProfile,
  selectShareCount,
  type ShareEvidence,
} from "./split-shares";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../queries/connection", () => ({ getDb }));

function bar(date: string, close: number, source: string): StoredBar {
  return {
    date,
    close,
    open: close,
    high: close,
    low: close,
    adjClose: null,
    volume: 100,
    source,
  };
}

function shares(value: number): ShareEvidence {
  return {
    shares: value,
    rawShares: value / 10,
    ratio: 10,
    source: "common_stock",
    periodEnd: "2024-04-28",
    filed: "2024-05-29",
    accession: "test",
    events: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Schwab level bars", () => {
  it("preserves history and lets newer Schwab bars win on the same date", async () => {
    const history = [
      bar("2024-05-30", 100, "schwab-hist"),
      bar("2024-05-31", 10, "schwab-hist"),
    ];
    const current = [bar("2024-05-31", 12, "schwab")];
    const rows = [history, current];
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => rows.shift() }),
          }),
        }),
      }),
    });
    expect(await getSchwabLevelBars(1045810)).toEqual([history[0], current[0]]);
  });
});

describe("split-safe market value", () => {
  it("uses converted shares and the last eligible Schwab close", async () => {
    const result = await getMarketValueAt(
      1045810,
      "2024-06-07",
      { at: () => shares(24890000000) },
      [
        bar("2024-05-31", 109.63, "schwab-hist"),
        bar("2024-06-07", 120.12, "schwab-hist"),
      ]
    );
    expect(result.marketCap).toBe(24890000000 * 120.12);
    expect(result.priceSource).toBe("schwab-hist");
    expect(result.shares?.ratio).toBe(10);
  });

  it("fails closed when no corroborated share count exists", async () => {
    const result = await getMarketValueAt(
      1652044,
      "2022-07-15",
      { at: () => null },
      [bar("2022-07-15", 113.6, "schwab-hist")]
    );
    expect(result.marketCap).toBeNull();
    expect(result.price).toBe(113.6);
  });
});

describe("instrument share fallback", () => {
  it("uses the official instrument count only when no current SEC candidate exists", async () => {
    const profile = buildSplitProfile([
      {
        concept: "EntityCommonStockSharesOutstanding",
        endDate: "2010-01-27",
        val: 469280842,
        filed: "2010-02-03",
        accn: "old",
        form: "10-Q",
      },
    ]);
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ ticker: "V" }] }),
        }),
      }),
    });
    const result = await getMarketValueAt(
      1403161,
      new Date().toISOString().slice(0, 10),
      { profile, at: date => selectShareCount(profile, date) },
      [bar("2026-11-10", 423, "schwab-hist")],
      {
        generatedAt: "2026-11-12T03:10:10.994Z",
        instruments: [
          { symbol: "V", fundamental: { sharesOutstanding: 1724473215 } },
        ],
        files: [{ kind: "instrument/V", sourceHash: "abc" }],
      }
    );
    expect(result.marketCap).toBe(1724473215 * 423);
    expect(result.shares).toMatchObject({
      source: "schwab_instrument",
      filed: "2026-11-12T03:10:10.994Z",
      sourceHash: "abc",
      ratio: 1,
    });
    expect(result.priceSource).toBe("schwab-hist");
  });

  it("does not substitute the instrument count for rejected split evidence", async () => {
    const profile = buildSplitProfile(
      [
        {
          concept: "WeightedAverageNumberOfDilutedSharesOutstanding",
          endDate: "2026-08-31",
          startDate: "2026-06-02",
          val: 100,
          filed: "2026-09-01",
          accn: "first",
          form: "10-Q",
        },
        {
          concept: "WeightedAverageNumberOfDilutedSharesOutstanding",
          endDate: "2026-08-31",
          startDate: "2026-06-02",
          val: 137,
          filed: "2026-10-30",
          accn: "latest",
          form: "10-Q",
        },
      ],
      [
        {
          concept: "WeightedAverageNumberOfDilutedSharesOutstanding",
          periodEnd: "2026-08-31",
          vintage: "first",
          val: 100,
          sourceAccn: "first",
          sourceFiled: "2026-09-01",
        },
        {
          concept: "WeightedAverageNumberOfDilutedSharesOutstanding",
          periodEnd: "2026-08-31",
          vintage: "latest",
          val: 137,
          sourceAccn: "latest",
          sourceFiled: "2026-10-30",
        },
      ]
    );
    const result = await getMarketValueAt(
      1652044,
      new Date().toISOString().slice(0, 10),
      { profile, at: date => selectShareCount(profile, date) },
      [bar("2026-11-10", 287.38, "schwab-hist")],
      {
        generatedAt: "2026-11-12T03:10:10.994Z",
        instruments: [
          { symbol: "GOOGL", fundamental: { sharesOutstanding: 5888000000 } },
        ],
      }
    );
    expect(result.marketCap).toBeNull();
  });
});
