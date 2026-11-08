import { median, type PriceBar } from "./form4-core";
import type { InsiderBuyCluster } from "./form4-features";

export interface Form4ForwardReturn {
  status: "computed" | "not_computable";
  entryDate: string | null;
  exitDate: string | null;
  return: number | null;
  universeMedianReturn: number | null;
  excessReturn: number | null;
  reason?: string;
}

function entryIndex(bars: PriceBar[], availableAt: string): number {
  const date = availableAt.slice(0, 10);
  const time = availableAt.slice(11, 19) || "00:00:00";
  return bars.findIndex((bar) => bar.date > date || (bar.date === date && time <= "16:00:00"));
}

function forwardReturn(bars: PriceBar[], availableAt: string, horizon: number): { entryDate: string; exitDate: string; value: number } | null {
  const entry = entryIndex(bars, availableAt);
  if (entry < 0 || entry + horizon >= bars.length) return null;
  const baseline = bars[entry].close;
  if (baseline === 0) return null;
  return { entryDate: bars[entry].date, exitDate: bars[entry + horizon].date, value: bars[entry + horizon].close / baseline - 1 };
}

export function benchmarkForm4Cluster(cluster: InsiderBuyCluster, barsByTicker: Record<string, PriceBar[]>): Record<string, Form4ForwardReturn> {
  const output: Record<string, Form4ForwardReturn> = {};
  for (const horizon of [1, 5, 20]) {
    const own = forwardReturn(barsByTicker[cluster.ticker] ?? [], cluster.availableAt, horizon);
    if (!own) {
      output[`forward${horizon}d`] = { status: "not_computable", entryDate: null, exitDate: null, return: null, universeMedianReturn: null, excessReturn: null, reason: "Reviewed entry/horizon bars are unavailable" };
      continue;
    }
    const peerReturns = Object.entries(barsByTicker).filter(([ticker]) => ticker !== cluster.ticker).map(([, bars]) => {
      const entry = bars.findIndex((bar) => bar.date === own.entryDate);
      if (entry < 0 || entry + horizon >= bars.length || bars[entry].close === 0) return null;
      return bars[entry + horizon].close / bars[entry].close - 1;
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

export function summarizeForm4Benchmark(rows: Record<string, Form4ForwardReturn>[]) {
  const horizons: Record<string, unknown> = {};
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
  return {
    status: computedClusters ? "computed" : "not_computable",
    notProductionAlpha: true,
    horizons,
  };
}
