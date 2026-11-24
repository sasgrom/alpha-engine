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
import { createRouter, authedQuery } from "../middleware";
import { getBars } from "../services/prices";

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
});
