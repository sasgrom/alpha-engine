// Unit tests for the 4m (D46) insider-cluster detector.
import { describe, it, expect } from "vitest";
import { detectInsiderClusters } from "./events";

const buy = (name: string, date: string, filed: string, opts: Partial<{ is10b5: boolean; code: string }> = {}) => ({
  insiderName: name,
  code: opts.code ?? "P",
  tradeDate: date,
  filingDate: filed,
  is10b5: opts.is10b5 ?? false,
  shares: 1000,
  price: 100,
});

describe("detectInsiderClusters (D46)", () => {
  it("fires on ≥3 distinct insiders buying within 30 days", () => {
    const clusters = detectInsiderClusters([
      buy("A", "2026-03-01", "2026-03-03"),
      buy("B", "2026-03-10", "2026-03-12"),
      buy("C", "2026-03-20", "2026-03-22"),
    ]);
    expect(clusters.length).toBe(1);
    expect(clusters[0].insiders).toEqual(["A", "B", "C"]);
    // point-in-time: the event is knowable only at the LAST filing date
    expect(clusters[0].filingDate).toBe("2026-03-22");
    expect(clusters[0].endDate).toBe("2026-03-20");
    expect(clusters[0].totalDollars).toBe(3000 * 100);
  });
  it("never fires on planned 10b5-1 purchases or sales", () => {
    const clusters = detectInsiderClusters([
      buy("A", "2026-03-01", "2026-03-03", { is10b5: true }),
      buy("B", "2026-03-10", "2026-03-12", { is10b5: true }),
      buy("C", "2026-03-20", "2026-03-22", { code: "S" }),
    ]);
    expect(clusters.length).toBe(0);
  });
  it("two insiders are not a cluster; spread over 60 days is not a cluster", () => {
    expect(detectInsiderClusters([buy("A", "2026-03-01", "2026-03-03"), buy("B", "2026-03-10", "2026-03-12")]).length).toBe(0);
    expect(
      detectInsiderClusters([buy("A", "2026-01-01", "2026-01-02"), buy("B", "2026-02-15", "2026-02-16"), buy("C", "2026-03-25", "2026-03-26")]).length
    ).toBe(0);
  });
  it("the same insider buying twice counts once (distinct-insiders rule)", () => {
    const clusters = detectInsiderClusters([
      buy("A", "2026-03-01", "2026-03-03"),
      buy("A", "2026-03-05", "2026-03-06"),
      buy("B", "2026-03-10", "2026-03-12"),
    ]);
    expect(clusters.length).toBe(0);
  });
});
