import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { latestDeskShortInterest } from "./desk-short-interest";

const folder = mkdtempSync(path.join(tmpdir(), "desk-short-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const file = path.join(folder, "desk-short-interest.json");
writeFileSync(file, JSON.stringify({
  schemaVersion: 1, source: "s", asOf: "2026-10-30", settlements: ["2026-10-30", "2026-10-15"], builtAt: "b", ambiguous: [],
  companies: {
    "1": [{ date: "2026-10-30", shares: 120, averageDailyVolume: 40, daysToCover: 3 }, { date: "2026-10-15", shares: 100, averageDailyVolume: 50, daysToCover: 2 }],
    "2": [{ date: "2026-10-30", shares: 7, averageDailyVolume: 0, daysToCover: null }],
  },
}));

describe("a company's short interest from the FINRA file", () => {
  it("gives the latest reading, the one before and the change", () => {
    expect(latestDeskShortInterest(1, file)).toEqual({
      current: { settlementDate: "2026-10-30", sharesShort: 120, shortPercentOfFloat: null, shortRatio: 3, source: "finra" },
      prior: { settlementDate: "2026-10-15", sharesShort: 100, shortPercentOfFloat: null, shortRatio: 2, source: "finra" },
      deltaShares: 20,
    });
  });

  it("has no prior for a single reading and nothing for a company FINRA does not list", () => {
    expect(latestDeskShortInterest(2, file)).toMatchObject({ prior: null, deltaShares: null, current: { shortRatio: null } });
    expect(latestDeskShortInterest(3, file)).toBeNull();
  });

  it("is null when the file is not built and refuses another schema", () => {
    expect(latestDeskShortInterest(1, path.join(folder, "absent.json"))).toBeNull();
    const old = path.join(folder, "old.json");
    writeFileSync(old, JSON.stringify({ schemaVersion: 0, companies: {} }));
    expect(() => latestDeskShortInterest(1, old)).toThrow(/schema/);
  });
});
