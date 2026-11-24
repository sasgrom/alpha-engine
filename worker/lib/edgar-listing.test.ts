import { describe, expect, it } from "vitest";
import { detailedRowsFromBlock, fillFilingDetails } from "./edgar-listing";

const block = {
  accessionNumber: ["0000320193-26-000101", "0000320193-26-000102", "0000320193-26-000103", "0000320193-26-000104"],
  form: ["8-K", "4", "10-Q", "8-K"],
  filingDate: ["2026-11-19", "2026-11-18", "2026-07-31", "2026-01-29"],
  reportDate: ["2026-11-19", "", "2026-06-27", "2026-01-29"],
  primaryDocument: ["a8k.htm", "form4.xml", "a10q.htm", "b8k.htm"],
  acceptanceDateTime: ["2026-11-19T21:31:05.000Z", "2026-11-18T23:00:00.000Z", "2026-07-31T10:01:36.000Z", "20260129163012"],
  items: ["2.02,9.01", "", "", " 5.02 "],
};

describe("filing list with acceptance time and items", () => {
  it("keeps the wanted forms and reads the acceptance time as New York wall clock", () => {
    const rows = detailedRowsFromBlock(block);
    expect(rows.map((row) => row.accessionNo)).toEqual(["0000320193-26-000101", "0000320193-26-000103", "0000320193-26-000104"]);
    // 21:31 UTC in November is 16:31 in New York; 10:01 UTC in July is 06:01
    expect(rows[0].acceptedEt).toBe("2026-11-19T16:31:05");
    expect(rows[1].acceptedEt).toBe("2026-07-31T06:01:36");
    // the old 14-digit form is already New York wall clock and is taken as written
    expect(rows[2].acceptedEt).toBe("2026-01-29T16:30:12");
  });

  it("keeps an 8-K's items and leaves a filing without items at null", () => {
    const rows = detailedRowsFromBlock(block);
    expect(rows[0].items).toBe("2.02,9.01");
    expect(rows[1].items).toBeNull();
    expect(rows[2].items).toBe("5.02");
  });

  it("writes eventTs as the plain list does", () => {
    const rows = detailedRowsFromBlock(block);
    expect(rows[0].eventTs).toBe("2026-11-19 00:00:00");
    expect(rows[2].eventTs).toBe("2026-01-29 16:30:12");
  });

  it("gives no acceptance time when the SEC gives none", () => {
    const rows = detailedRowsFromBlock({ accessionNumber: ["0000000001-26-000001"], form: ["10-K"], filingDate: ["2026-02-01"] });
    expect(rows[0]).toMatchObject({ acceptedEt: null, items: null, reportDate: "", primaryDoc: "", eventTs: "2026-02-01 00:00:00" });
  });

  it("fills a stored entry once and never replaces what is stored", () => {
    const entry: { acceptedEt?: string | null; items?: string | null } = {};
    expect(fillFilingDetails(entry, { acceptedEt: "2026-11-19T16:31:05", items: "2.02" })).toBe(true);
    expect(entry).toEqual({ acceptedEt: "2026-11-19T16:31:05", items: "2.02" });
    expect(fillFilingDetails(entry, { acceptedEt: "2026-11-20T09:00:00", items: null })).toBe(false);
    expect(entry).toEqual({ acceptedEt: "2026-11-19T16:31:05", items: "2.02" });
    // a stored null (the SEC gave none) is a stored answer too
    const none: { acceptedEt?: string | null; items?: string | null } = { acceptedEt: null, items: null };
    expect(fillFilingDetails(none, { acceptedEt: "2026-11-19T16:31:05", items: "2.02" })).toBe(false);
  });
});
