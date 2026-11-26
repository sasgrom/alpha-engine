import { describe, expect, it } from "vitest";
import { corporateEndEvidence } from "./russell1000-coverage";

describe("K27 former-member corporate-end evidence", () => {
  it("retains Forms 15/25 and merger/control 8-K items, not ordinary earnings", () => {
    const page = { accessionNumber: ["a", "b", "c", "d"], form: ["25-NSE", "15-12G", "8-K", "8-K"], filingDate: ["2024-01-02", "2024-02-03", "2024-03-04", "2024-04-05"], acceptanceDateTime: ["20240102090000", "20240203090000", "20240304090000", "20240405090000"], items: ["", "", "2.01, 9.01", "2.02, 9.01"] };
    expect(corporateEndEvidence([page])).toEqual([
      { kind: "merger 8-K", accessionNo: "c", filingDate: "2024-03-04", acceptedEt: "2024-03-04T09:00:00", items: "2.01, 9.01" },
      { kind: "Form 15", accessionNo: "b", filingDate: "2024-02-03", acceptedEt: "2024-02-03T09:00:00", items: null },
      { kind: "Form 25", accessionNo: "a", filingDate: "2024-01-02", acceptedEt: "2024-01-02T09:00:00", items: null },
    ]);
  });

  it("reads the recent block of a main submissions response and deduplicates pages", () => {
    const page = { accessionNumber: ["same"], form: ["25"], filingDate: ["2025-01-01"], acceptanceDateTime: [""], items: [""] };
    expect(corporateEndEvidence([{ filings: { recent: page } }, page])).toEqual([{ kind: "Form 25", accessionNo: "same", filingDate: "2025-01-01", acceptedEt: null, items: null }]);
  });
});
