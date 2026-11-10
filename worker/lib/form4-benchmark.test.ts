import { describe, expect, it } from "vitest";
import { benchmarkForm4Cluster, createForm4BenchmarkPriceStore, summarizeForm4Benchmark, type Form4BenchmarkPriceStore } from "./form4-benchmark";
import type { InsiderBuyCluster } from "./form4-features";
import type { PriceBar } from "./form4-core";

function bars(ticker: string, cik: number): (PriceBar & { id: number; cik: number; ticker: string; source: string; fetchedAt: string })[] {
  const output: (PriceBar & { id: number; cik: number; ticker: string; source: string; fetchedAt: string })[] = [];
  const date = new Date("2026-01-01T00:00:00Z");
  let close = ticker === "INTC" ? 100 : 50;
  while (output.length < 60) {
    if (![0, 6].includes(date.getUTCDay())) {
      output.push({ id: output.length + 1, cik, ticker, date: date.toISOString().slice(0, 10), open: null, high: null, low: null, close, adjClose: null, volume: 1_000_000, source: "stooq", fetchedAt: "2026-11-01 00:00:00" });
      close += ticker === "INTC" ? 1 : 0.5;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return output;
}

const cluster = { clusterId: "qa", ticker: "INTC", availableAt: "2026-01-10 12:00:00" } as InsiderBuyCluster;
const store = (): Form4BenchmarkPriceStore => createForm4BenchmarkPriceStore([...bars("INTC", 50863), ...bars("NVDA", 1045810)], "2026-12-01T00:00:00Z");

describe("canonical Form 4 dry-run benchmark", () => {
  it("uses canonical DB prices after availableAt and compares the same horizon", () => {
    const result = benchmarkForm4Cluster(cluster, store());
    expect(result.forward1d.status).toBe("computed");
    expect(result.forward5d.status).toBe("computed");
    expect(result.forward20d.status).toBe("computed");
    expect(result.forward1d.entryDate).toBe("2026-01-12");
    expect(result.forward1d.excessReturn).not.toBeNull();
    const summary = summarizeForm4Benchmark([{ ...result, availableAt: cluster.availableAt }]);
    expect(summary.status).toBe("computed");
    expect(summary.notProductionAlpha).toBe(true);
    expect(summary.coverageByYear[0]).toMatchObject({ year: "2026", total: 1, horizons: { forward1d: { computed: 1, coverage: 1 } } });
  });

  it("returns not_computable when reviewed price history is missing", () => {
    const result = benchmarkForm4Cluster(cluster, createForm4BenchmarkPriceStore([], "2026-12-01T00:00:00Z"));
    expect(result.forward20d.status).toBe("not_computable");
    expect(summarizeForm4Benchmark([result]).status).toBe("not_computable");
  });

  it("fails closed when the nearest eligible entry exceeds the max gap", () => {
    const oldCluster = { ...cluster, availableAt: "2020-01-01 12:00:00" };
    const result = benchmarkForm4Cluster(oldCluster, store());
    expect(result.forward1d.status).toBe("not_computable");
    expect(result.forward1d.reason).toContain("45 days");
  });
});
