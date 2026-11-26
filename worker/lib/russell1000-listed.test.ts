import { describe, expect, it } from "vitest";
import { commonStockListings } from "./russell1000-listed";

describe("former Russell members still listed", () => {
  it("keeps every common class and excludes preferred or non-common instruments", () => {
    const rows = [
      { cik: 1, name: "Example Corp", ticker: "EX-A", exchange: "NYSE" },
      { cik: 1, name: "Example Corp", ticker: "EX-B", exchange: "NYSE" },
      { cik: 1, name: "Example Corp", ticker: "EX-PA", exchange: "NYSE" },
      {
        cik: 2,
        name: "Another Corp Preferred Stock",
        ticker: "ANOP",
        exchange: "Nasdaq",
      },
      { cik: 3, name: "Gone Corp", ticker: "GONE", exchange: null },
      { cik: 4, name: "Ordinary Corp", ticker: "ORD", exchange: "OTC" },
    ];
    expect(commonStockListings(rows).map(row => row.ticker)).toEqual([
      "EX-A",
      "EX-B",
      "ORD",
    ]);
  });
});
