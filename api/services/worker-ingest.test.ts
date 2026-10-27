import { describe, expect, it } from "vitest";
import { workerFactRowZ, workerIngestBodyZ, workerQuarterRowZ } from "./worker";

describe("worker fund_quarters ingest contract", () => {
  it("accepts a complete book summary with availability", () => {
    const row = {
      fundCik: 2100119,
      quarterDate: "2026-03-31",
      totalValueUsd: 4_042_898_266_478,
      positions: 4062,
      accessionNo: "0002100119-26-001313",
      filingDate: "2026-05-15",
    };
    expect(workerQuarterRowZ.parse(row)).toEqual(row);
    const body = workerIngestBodyZ.parse({ kind: "fundQuarters", rows: [row] });
    expect(body.kind).toBe("fundQuarters");
  });

  it("allows historical null dates but rejects malformed quarters", () => {
    const row = { fundCik: 1, quarterDate: "2026-03-31", accessionNo: "a", filingDate: null };
    expect(workerQuarterRowZ.parse(row).filingDate).toBeNull();
    expect(() => workerQuarterRowZ.parse({ ...row, quarterDate: "03/31/2026" })).toThrow();
  });

  it("accepts the separate full-repair holdings snapshot kind", () => {
    const holding = {
      fundCik: 2100119, fundName: "Vanguard", cusip: "037833100", secClass: "COM",
      heldCik: 320193, issuer: "APPLE INC", shares: 100, valueUsd: 20_000,
      quarterDate: "2026-03-31", accessionNo: "0002100119-26-001313", tier: "institutional",
    };
    const body = workerIngestBodyZ.parse({ kind: "holdingsSnapshot", rows: [holding] });
    expect(body.kind).toBe("holdingsSnapshot");
  });
});

describe("worker companyfacts snapshot contract", () => {
  it("accepts one complete per-CIK snapshot with filing provenance", () => {
    const row = {
      cik: 320193, taxonomy: "us-gaap", concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
      unit: "USD", startDate: "2025-01-01", endDate: "2025-03-31", val: 1000,
      fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-04-30", accn: "0000320193-25-000001",
    };
    expect(workerFactRowZ.parse(row)).toEqual(row);
    const body = workerIngestBodyZ.parse({ kind: "factsSnapshot", cik: 320193, rows: [row] });
    expect(body.kind).toBe("factsSnapshot");
  });

  it("rejects malformed dates", () => {
    const row = { cik: 1, taxonomy: "us-gaap", concept: "Assets", unit: "USD", filed: "2025" };
    expect(() => workerFactRowZ.parse(row)).toThrow();
  });
});
