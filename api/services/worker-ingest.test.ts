import { describe, expect, it } from "vitest";
import { workerIngestBodyZ, workerQuarterRowZ } from "./worker";

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
