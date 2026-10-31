import { describe, expect, it } from "vitest";
import { selectLatestFilings } from "./filing-selection";
import type { ManifestEntry } from "../edgar-fetch.mts";

const filing = (form: string, filingDate: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry => ({
  accessionNo: `${form}-${filingDate}`, form, filingDate, reportDate: filingDate, primaryDoc: "doc.htm", eventTs: `${filingDate} 12:00:00`,
  docName: "doc.htm", fetched: true, scored: false, ...overrides,
});

describe("latest filing selection", () => {
  it("selects one latest primary filing of each form and prefers exhibit-bearing 8-Ks", () => {
    const selected = selectLatestFilings([
      filing("10-K", "2024-01-01"),
      filing("10-K", "2025-01-01"),
      filing("10-K/A", "2026-01-01"),
      filing("10-Q", "2025-07-01"),
      filing("10-Q", "2025-10-01"),
      filing("8-K", "2026-02-01"),
      filing("8-K", "2025-12-01", { exFile: "earnings.htm" }),
      filing("8-K", "2026-01-15", { exhibitFiles: [{ name: "main.htm", size: 100, sha256: "abc" }] }),
    ]);
    expect(selected.map((entry) => entry.accessionNo)).toEqual(["10-K-2025-01-01", "10-Q-2025-10-01", "8-K-2026-01-15"]);
  });

  it("does not select an 8-K cover without any exhibit", () => {
    expect(selectLatestFilings([filing("8-K", "2026-01-01")])).toEqual([]);
  });
});
