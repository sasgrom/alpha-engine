import { describe, expect, it } from "vitest";
import { r1000CompanyFactsPeriod, r1000DeterministicSample, r1000LastCandle, r1000LatestFiling } from "./r1000-freshness";

const filing = (accessionNo: string, filingDate: string, acceptedEt: string | null = null) => ({ accessionNo, form: "8-K", filingDate, acceptedEt, eventTs: filingDate });

describe("Russell freshness checks", () => {
  it("selects the latest in-scope filing by date, acceptance and accession", () => {
    expect(r1000LatestFiling([filing("b", "2026-01-01", "2026-01-01T12:00:00"), filing("a", "2026-01-01", "2026-01-01T13:00:00"), filing("old", "2018-01-01")])?.accessionNo).toBe("a");
    expect(r1000LatestFiling([])).toBeNull();
  });

  it("reads the newest nested companyfacts period", () => {
    const payload = {
      facts: {
        usGaap: {
          Revenue: { units: { USD: [{ end: "2026-06-30" }, { end: "2026-09-30" }] } },
          Cash: { units: { USD: [{ end: "2025-12-31" }] } },
        },
      },
    };
    expect(r1000CompanyFactsPeriod(payload)).toBe("2026-09-30");
    expect(r1000CompanyFactsPeriod({})).toBeNull();
  });

  it("samples deterministically by CIK without duplicates", () => {
    const rows = [3, 1, 2, 4].map(cik => ({ cik }));
    expect(r1000DeterministicSample(rows, 2, 35)).toEqual(r1000DeterministicSample([...rows].reverse(), 2, 35));
    expect(new Set(r1000DeterministicSample(rows, 3, 35).map(row => row.cik)).size).toBe(3);
  });

  it("reads the last candle date and preserves a zero close only when present", () => {
    expect(r1000LastCandle({ candles: [{ datetime: Date.UTC(2026, 10, 27), close: 12.5 }] })).toEqual({ date: "2026-11-27", close: 12.5 });
    expect(r1000LastCandle({ candles: [] })).toBeNull();
  });
});
