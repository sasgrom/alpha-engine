import { inArray } from "drizzle-orm";
import { prices } from "@db/schema";
import { chooseDailyPrice, type DailyPriceCandidate } from "../../api/services/daily-price";
import { getDb } from "../../api/queries/connection";
import { median, type Form4UniverseCompany } from "./form4-core";
import type { InsiderBuyCluster } from "./form4-features";

export const FORM4_BENCHMARK_MAX_ENTRY_GAP_DAYS = 45;

export interface Form4BenchmarkPriceStore {
  rowsByTicker: Map<string, Map<string, DailyPriceCandidate[]>>;
  cikByTicker: Map<string, number>;
  asOf: string;
  maxEntryGapDays: number;
}

export interface Form4ForwardReturn {
  status: "computed" | "not_computable";
  entryDate: string | null;
  exitDate: string | null;
  return: number | null;
  universeMedianReturn: number | null;
  excessReturn: number | null;
  reason?: string;
}

export function createForm4BenchmarkPriceStore(rows: (DailyPriceCandidate & { ticker: string })[], asOf: string, maxEntryGapDays = FORM4_BENCHMARK_MAX_ENTRY_GAP_DAYS): Form4BenchmarkPriceStore {
  const rowsByTicker = new Map<string, Map<string, DailyPriceCandidate[]>>();
  const cikByTicker = new Map<string, number>();
  for (const row of rows) {
    cikByTicker.set(row.ticker, row.cik);
    const byDate = rowsByTicker.get(row.ticker) ?? new Map<string, DailyPriceCandidate[]>();
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
    rowsByTicker.set(row.ticker, byDate);
  }
  return { rowsByTicker, cikByTicker, asOf, maxEntryGapDays };
}

export async function loadForm4BenchmarkPriceStore(universe: Form4UniverseCompany[], asOf: string, maxEntryGapDays = FORM4_BENCHMARK_MAX_ENTRY_GAP_DAYS): Promise<Form4BenchmarkPriceStore> {
  const ciks = universe.map((company) => company.cik);
  const rows = await getDb().select({
    id: prices.id,
    cik: prices.cik,
    ticker: prices.ticker,
    date: prices.date,
    open: prices.open,
    high: prices.high,
    low: prices.low,
    close: prices.close,
    adjClose: prices.adjClose,
    volume: prices.volume,
    source: prices.source,
    fetchedAt: prices.fetchedAt,
  }).from(prices).where(inArray(prices.cik, ciks));
  return createForm4BenchmarkPriceStore(rows, asOf, maxEntryGapDays);
}

function eligiblePrice(store: Form4BenchmarkPriceStore, ticker: string, date: string) {
  const cik = store.cikByTicker.get(ticker);
  if (!cik) return null;
  const selected = chooseDailyPrice(store.rowsByTicker.get(ticker)?.get(date) ?? [], cik, date, store.asOf);
  return selected.status === "ready" && selected.price !== null && selected.price > 0 ? selected : null;
}

function forwardReturn(store: Form4BenchmarkPriceStore, ticker: string, availableAt: string, horizon: number) {
  const availableDate = availableAt.slice(0, 10);
  const availableTime = availableAt.slice(11, 19) || "00:00:00";
  const dates = [...(store.rowsByTicker.get(ticker)?.keys() ?? [])].sort();
  const firstAllowed = availableTime <= "16:00:00" ? availableDate : new Date(Date.parse(`${availableDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const entryDate = dates.find((date) => date >= firstAllowed && eligiblePrice(store, ticker, date));
  if (!entryDate || Date.parse(entryDate) - Date.parse(firstAllowed) > store.maxEntryGapDays * 86_400_000) return null;
  let exitDate: string | null = null;
  let remaining = horizon;
  for (const date of dates.filter((value) => value > entryDate)) {
    if (!eligiblePrice(store, ticker, date)) continue;
    remaining--;
    if (remaining === 0) {
      exitDate = date;
      break;
    }
  }
  if (!exitDate) return null;
  const entry = eligiblePrice(store, ticker, entryDate)!;
  const exit = eligiblePrice(store, ticker, exitDate)!;
  return { entryDate, exitDate, entry: entry.price!, exit: exit.price!, value: exit.price! / entry.price! - 1 };
}

export function benchmarkForm4Cluster(cluster: InsiderBuyCluster, store: Form4BenchmarkPriceStore): Record<string, Form4ForwardReturn> {
  const output: Record<string, Form4ForwardReturn> = {};
  for (const horizon of [1, 5, 20]) {
    const own = forwardReturn(store, cluster.ticker, cluster.availableAt, horizon);
    if (!own) {
      output[`forward${horizon}d`] = {
        status: "not_computable",
        entryDate: null,
        exitDate: null,
        return: null,
        universeMedianReturn: null,
        excessReturn: null,
        reason: `No eligible entry within ${store.maxEntryGapDays} days or the horizon is incomplete`,
      };
      continue;
    }
    const peerReturns = [...store.cikByTicker.keys()].filter((ticker) => ticker !== cluster.ticker).map((ticker) => {
      const entry = eligiblePrice(store, ticker, own.entryDate);
      const exit = eligiblePrice(store, ticker, own.exitDate);
      return entry && exit ? exit.price! / entry.price! - 1 : null;
    }).filter((value): value is number => value !== null);
    const universeMedianReturn = median(peerReturns);
    output[`forward${horizon}d`] = {
      status: universeMedianReturn === null ? "not_computable" : "computed",
      entryDate: own.entryDate,
      exitDate: own.exitDate,
      return: own.value,
      universeMedianReturn,
      excessReturn: universeMedianReturn === null ? null : own.value - universeMedianReturn,
      ...(universeMedianReturn === null ? { reason: "Universe median is unavailable for the same entry/horizon" } : {}),
    };
  }
  return output;
}

export function summarizeForm4Benchmark(rows: (Record<string, Form4ForwardReturn> & { availableAt?: string })[]) {
  const horizons: Record<string, unknown> = {};
  const years = new Map<string, { total: number; computed: Record<string, number> }>();
  let computedClusters = 0;
  for (const horizon of [1, 5, 20]) {
    const key = `forward${horizon}d`;
    const computed = rows.map((row) => row[key]).filter((row) => row.status === "computed" && row.excessReturn !== null);
    if (computed.length) computedClusters++;
    horizons[key] = {
      status: computed.length ? "computed" : "not_computable",
      counts: { total: rows.length, computed: computed.length },
      hitRate: computed.length ? computed.filter((row) => row.excessReturn! > 0).length / computed.length : null,
      medianExcess: median(computed.map((row) => row.excessReturn!)),
      coverage: rows.length ? computed.length / rows.length : 0,
    };
  }
  for (const row of rows) {
    const year = row.availableAt?.slice(0, 4) ?? "unknown";
    const entry = years.get(year) ?? { total: 0, computed: { forward1d: 0, forward5d: 0, forward20d: 0 } };
    entry.total++;
    for (const horizon of [1, 5, 20]) {
      const key = `forward${horizon}d`;
      if (row[key].status === "computed" && row[key].excessReturn !== null) entry.computed[key]++;
    }
    years.set(year, entry);
  }
  return {
    status: computedClusters ? "computed" : "not_computable",
    notProductionAlpha: true,
    horizons,
    coverageByYear: [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, value]) => ({
      year,
      total: value.total,
      horizons: Object.fromEntries([1, 5, 20].map((horizon) => {
        const key = `forward${horizon}d`;
        return [key, { computed: value.computed[key], coverage: value.total ? value.computed[key] / value.total : 0 }];
      })),
    })),
  };
}
