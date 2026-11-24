import { describe, expect, it } from "vitest";
import { latestWatchlistFilings } from "./desk-company-files";

const file = {
  filings: [
    { cik: 2, ticker: "TWO", accession: "0000000002-26-000003", form: "8-K", filed: "2026-11-23", acceptedEt: "2026-11-23T16:05:00", earnings: true },
    { cik: 3, ticker: "THREE", accession: "0000000003-26-000001", form: "10-Q", filed: "2026-11-21", acceptedEt: null, earnings: false },
    { cik: 2, ticker: "TWO", accession: "0000000002-26-000002", form: "8-K", filed: "2026-11-20", acceptedEt: "2026-11-20T08:00:00", earnings: false },
    { cik: 1, ticker: "ONE", accession: "0000000001-26-000001", form: "10-K", filed: "2026-11-19", acceptedEt: "2026-11-19T17:00:00", earnings: false },
  ],
};

describe("the watchlist's filings feed", () => {
  it("keeps the followed companies, in the file's order, up to the limit", () => {
    const rows = latestWatchlistFilings(file, [1, 2], 2);
    expect(rows.map((row) => row.accessionNo)).toEqual(["0000000002-26-000003", "0000000002-26-000002"]);
    expect(rows[0]).toEqual({ id: "0000000002-26-000003", cik: 2, ticker: "TWO", form: "8-K", filingDate: "2026-11-23", accessionNo: "0000000002-26-000003", acceptedEt: "2026-11-23T16:05:00", earnings: true });
    expect(latestWatchlistFilings(file, [1, 2], 10)).toHaveLength(3);
  });

  it("is empty without the file or without followed companies in it", () => {
    expect(latestWatchlistFilings(null, [1], 5)).toEqual([]);
    expect(latestWatchlistFilings(file, [9], 5)).toEqual([]);
  });
});
