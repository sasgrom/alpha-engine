import { describe, expect, it } from "vitest";
import { chooseBucket, compareFactorRows, evaluateFactorRows, FACTOR_CONFIGS, type ResearchRow } from "./dolthub-research";
import type { OptionBucketFeatures } from "./option-features";

function rows(): ResearchRow[] {
  const out: ResearchRow[] = [];
  for (let month = 0; month < 6; month++) {
    for (let cik = 1; cik <= 16; cik++) {
      const x = cik + month;
      out.push({
        cik, ticker: `T${cik}`, sector: cik <= 8 ? "Tech" : "Finance",
        date: `202${month < 4 ? 4 : 5}-0${month % 4 + 1}-15`, quarter: `202${month < 4 ? 4 : 5}-0${month % 4 + 1}`,
        bucket: "31-90D", factor: "atmIv", horizon: 63, x, y: 2 * x,
      });
    }
  }
  return out;
}

describe("DoltHub research evaluation", () => {
  it("keeps trailing RV20 as an explicit baseline factor", () => {
    expect(FACTOR_CONFIGS.rv20).toBeDefined();
    expect(FACTOR_CONFIGS.rv20.bucketPreference).toEqual(["31-90D", "8-30D"]);
  });

  it("selects primary buckets without searching for the best result", () => {
    const buckets = [{ bucket: "8-30D" }, { bucket: "31-90D" }] as OptionBucketFeatures[];
    expect(chooseBucket(buckets, ["31-90D", "8-30D"])?.bucket).toBe("31-90D");
    expect(chooseBucket(buckets, ["365+D"])).toBeNull();
  });

  it("computes overall, independent-universe, sector-neutral and yearly IC", () => {
    const result = evaluateFactorRows(rows());
    expect(result.overall.months).toBe(6);
    expect(result.overall.n).toBe(96);
    expect(result.overall.weightedSpearman).toBeCloseTo(1);
    expect(result.oddCik.weightedSpearman).toBeCloseTo(1);
    expect(result.evenCik.weightedSpearman).toBeCloseTo(1);
    expect(result.sectorNeutral.weightedSpearman).toBeCloseTo(1);
    expect(result.overall.ci95.low).not.toBeNull();
    expect(result.byYear["2024"].weightedSpearman).toBeCloseTo(1);
    expect(result.byYear["2025"].weightedSpearman).toBeCloseTo(1);
    expect(result.byBucket["31-90D"].weightedSpearman).toBeCloseTo(1);
  });

  it("bootstraps the paired ATM IV minus RV20 IC difference", () => {
    const a = rows(), b = rows().map((row) => ({ ...row, y: -row.y }));
    const comparison = compareFactorRows(a, b);
    expect(comparison.months).toBe(6);
    expect(comparison.deltaSpearman).toBeCloseTo(2);
    expect(comparison.betterShare).toBe(1);
    expect(comparison.ci95.low).toBeCloseTo(2);
    expect(comparison.ci95.high).toBeCloseTo(2);
    expect(comparison.byYear["2024"].deltaSpearman).toBeCloseTo(2);
  });
});
