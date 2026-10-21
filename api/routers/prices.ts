/**
 * prices router (Stage 1.7, iteration 3f) — daily price bars + quote stats.
 *
 * Everything here is computed from OUR OWN accumulated data (prices table +
 * canonical series): no per-request calls to external providers, so the UI
 * never depends on a free endpoint's mood. What cannot be computed in-house
 * (bid/ask, analyst targets) is deliberately absent — the UI shows only
 * numbers we can stand behind (data-honesty rule).
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { metricHistory } from "@db/schema";
import { createJob } from "../services/runner";
import { avgVolume, beta5y, changePct, fundamentalsFromSeries, getBars, week52 } from "../services/prices";

export const PRICE_RANGES = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"] as const;
export type PriceRange = (typeof PRICE_RANGES)[number];

/** Inclusive start date for a UI range chip; ALL = unbounded. */
export function rangeStart(range: PriceRange): string | undefined {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (range) {
    case "1M": return iso(new Date(now.getTime() - 31 * 86400_000));
    case "3M": return iso(new Date(now.getTime() - 92 * 86400_000));
    case "6M": return iso(new Date(now.getTime() - 183 * 86400_000));
    case "YTD": return `${now.getUTCFullYear()}-01-01`;
    case "1Y": return iso(new Date(now.getTime() - 365 * 86400_000));
    case "5Y": return iso(new Date(now.getTime() - 5 * 365 * 86400_000));
    case "ALL": return undefined;
  }
}

export const pricesRouter = createRouter({
  /** Daily bars for the chart; ascending, one preferred source. */
  history: authedQuery
    .input(z.object({ cik: z.number(), range: z.enum(PRICE_RANGES).default("1Y") }))
    .query(async ({ input }) => {
      const bars = await getBars(input.cik, rangeStart(input.range));
      return { bars, source: bars[0]?.source ?? null };
    }),

  /**
   * Quote header + stats grid for the company Overview tab.
   * last/prev bar → change; 52-week extremes; 3-month average volume;
   * market cap = last close × latest diluted shares (our series);
   * P/E (TTM) = last close / Σ last 4 quarterly diluted EPS (our series);
   * beta = 5-year monthly regression vs our SPY series.
   */
  quote: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    // 5Y+ of bars covers beta and the 52w window in one read
    const bars = await getBars(input.cik, rangeStart("5Y"));
    if (bars.length === 0) {
      return { available: false as const };
    }
    const last = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;
    const lastClose = last.adjClose ?? last.close;
    const prevClose = prev ? (prev.adjClose ?? prev.close) : null;
    const w52 = week52(bars);
    const { epsTtm, sharesDiluted } = await fundamentalsFromSeries(input.cik);
    const bench = await getBars(0, rangeStart("5Y")); // SPY pseudo-cik
    const beta = bench.length > 0 ? beta5y(bars, bench) : null;

    return {
      available: true as const,
      asOf: last.date,
      source: last.source,
      price: lastClose,
      open: last.open,
      dayHigh: last.high,
      dayLow: last.low,
      volume: last.volume,
      prevClose,
      change: lastClose !== null && prevClose !== null ? lastClose - prevClose : null,
      changePct: lastClose !== null && prevClose !== null ? changePct(lastClose, prevClose) : null,
      week52High: w52.high,
      week52Low: w52.low,
      avgVolume3m: avgVolume(bars, 92),
      marketCap: lastClose !== null && sharesDiluted !== null ? lastClose * sharesDiluted : null,
      epsTtm,
      peTtm: lastClose !== null && epsTtm !== null && epsTtm !== 0 ? lastClose / epsTtm : null,
      beta,
    };
  }),

  /** Job launcher: incremental (default) or full-backfill price sync. ADMIN-only since 4c (D31): writes shared tables. */
  startPrices: adminQuery
    .input(
      z.object({
        tickers: z.string().default("universe"),
        exclude: z.string().default(""),
        mode: z.enum(["incremental", "backfill"]).default("incremental"),
      })
    )
    .mutation(({ input, ctx }) => createJob("prices", input, ctx.user.id)),

  /**
   * 3g bulk import (admin-only — storage is billed to the owner): launches
   * the import job over a previously chunk-uploaded Stooq archive batch.
   * The client uploads parts via POST /api/prices-import/chunk first and
   * passes the batch id here.
   */
  startImport: adminQuery
    .input(z.object({ batch: z.string().regex(/^[0-9a-f-]{36}$/) }))
    .mutation(({ input, ctx }) => createJob("prices", { mode: "import", batch: input.batch }, ctx.user.id)),

  /**
   * 4n (D47): the pre-computed month-end history of one quote-grid metric —
   * reads metric_history (static, immediate display; the chart opens on the
   * stat tile click).
   */
  metricHistory: authedQuery
    .input(z.object({ cik: z.number(), metric: z.enum(["volume", "avgVolume3m", "marketCap", "epsTtm", "peTtm", "beta5y"]) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({ date: metricHistory.date, value: metricHistory.value })
        .from(metricHistory)
        .where(and(eq(metricHistory.cik, input.cik), eq(metricHistory.metric, input.metric)))
        .orderBy(metricHistory.date)
        .limit(600);
    }),
});
