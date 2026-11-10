import { describe, expect, it } from "vitest";
import { buildWeeklyCoverage } from "./build-weekly-coverage.mts";

const table = (rows: number, hash: string, maxDate: string | null = null) => ({ present: true, rows, contentSha256: hash, maxDate });

describe("weekly coverage report", () => {
  it("reports row and hash drift per table without hiding decreases", () => {
    const report = buildWeeklyCoverage(
      { generatedAt: "2026-11-03T00:00:00Z", tables: { prices: table(100, "a"), macro_points: table(50, "b") } },
      { generatedAt: "2026-11-10T00:00:00Z", tables: { prices: table(110, "a"), macro_points: table(49, "c") } },
    );
    expect(report.summary).toMatchObject({ tablesWithRowIncrease: 1, tablesWithRowDecrease: 1, tablesWithHashDrift: 1, rows: 159, baselineRows: 150, deltaRows: 9 });
    expect(report.tables.find((row) => row.table === "macro_points")).toMatchObject({ deltaRows: -1, hashChanged: true });
  });

  it("marks a missing baseline instead of claiming zero coverage", () => {
    const report = buildWeeklyCoverage(null, { generatedAt: "2026-11-10T00:00:00Z", tables: { prices: table(110, "a") } });
    expect(report.status).toBe("baseline_missing");
    expect(report.tables[0].baselineRows).toBeNull();
  });
});
