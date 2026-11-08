import { describe, expect, it } from "vitest";
import { benchmarkForm4Cluster, summarizeForm4Benchmark } from "./form4-benchmark";
import type { InsiderBuyCluster } from "./form4-features";
import type { PriceBar } from "./form4-core";

function bars(ticker: string): PriceBar[] {
  const output: PriceBar[] = [];
  const date = new Date("2026-01-01T00:00:00Z");
  let close = ticker === "INTC" ? 100 : 50;
  while (output.length < 60) {
    if (![0, 6].includes(date.getUTCDay())) {
      output.push({ date: date.toISOString().slice(0, 10), close, volume: 1_000_000 });
      close += ticker === "INTC" ? 1 : 0.5;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return output;
}

const cluster = { clusterId: "qa", ticker: "INTC", availableAt: "2026-01-10 12:00:00" } as InsiderBuyCluster;

describe("Form 4 dry-run benchmark", () => {
  it("computes forward returns only after availableAt and compares the same horizon", () => {
    const result = benchmarkForm4Cluster(cluster, { INTC: bars("INTC"), NVDA: bars("NVDA") });
    expect(result.forward1d.status).toBe("computed");
    expect(result.forward5d.status).toBe("computed");
    expect(result.forward20d.status).toBe("computed");
    expect(result.forward1d.entryDate).toBe("2026-01-12");
    expect(result.forward1d.excessReturn).not.toBeNull();
    const summary = summarizeForm4Benchmark([result]);
    expect(summary.status).toBe("computed");
    expect(summary.notProductionAlpha).toBe(true);
  });

  it("returns not_computable when reviewed price history is missing", () => {
    const result = benchmarkForm4Cluster(cluster, { INTC: [] });
    expect(result.forward20d.status).toBe("not_computable");
    expect(summarizeForm4Benchmark([result]).status).toBe("not_computable");
  });
});
