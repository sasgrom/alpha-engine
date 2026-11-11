import { describe, expect, it } from "vitest";
import { calendarRowsFromSubmissions, companyPilotChecks, parseIndexAcceptanceEt, projectRestRun, seededQuarterSample, type ExhibitOutcome } from "./event-calendar-rest";
import { buildQuarters, type CalendarFiling } from "./event-calendar";

const company = { cik: 1, ticker: "AAA", name: "Example" };
const page = {
  accessionNumber: ["q1", "release", "q2"],
  form: ["10-Q", "8-K", "8-K"],
  filingDate: ["2026-05-07", "2026-05-01", "2004-12-31"],
  reportDate: ["2026-03-31", "", ""],
  acceptanceDateTime: ["2026-05-07T14:00:00.000Z", "2026-05-01T13:00:00.000Z", "2004-12-31T13:00:00.000Z"],
  items: ["", "2.02,9.01", "2.02"],
  primaryDocument: ["q1.htm", "release.htm", "old.htm"],
};

describe("REST submissions calendar", () => {
  it("uses SEC metadata, filters scope and rejects conflicting duplicates", () => {
    const rows = calendarRowsFromSubmissions(company, [page, page]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ accessionNo: "q1", acceptedEt: "2026-05-07T10:00:00", acceptedUtc: "2026-05-07T14:00:00.000Z", reportDate: "2026-03-31" });
    expect(rows[1]).toMatchObject({ accessionNo: "release", isEarningsRelease: true, earningsFlagBasis: "item_2.02", itemsSource: "sec_submissions" });
    expect(buildQuarters(rows, []).map((row) => row.earningsAccession)).toEqual(["release"]);
    expect(() => calendarRowsFromSubmissions(company, [page, { ...page, primaryDocument: ["other.htm", "release.htm", "old.htm"] }])).toThrow(/Inconsistent submissions metadata/);
  });

  it("reads SEC index headers and index-page acceptance times", () => {
    expect(parseIndexAcceptanceEt("<ACCEPTANCE-DATETIME>20260701120000")).toBe("2026-07-01T12:00:00");
    expect(parseIndexAcceptanceEt("<span>Accepted</span><span>2026-07-01 12:00:00</span>")).toBe("2026-07-01T12:00:00");
    expect(parseIndexAcceptanceEt("not found")).toBeNull();
  });

  it("selects a seeded, deterministic earnings-quarter sample", () => {
    const rows = calendarRowsFromSubmissions(company, [page]);
    const quarters = buildQuarters(rows, []);
    expect(seededQuarterSample(quarters, 1, "seed")).toEqual(seededQuarterSample([...quarters].reverse(), 1, "seed"));
    expect(seededQuarterSample(quarters, 1, "seed")[0].earningsAccession).toBe("release");
  });

  it("checks K01 thresholds and explicit exhibit reasons", () => {
    const filings = calendarRowsFromSubmissions(company, [page]);
    const quarters = buildQuarters(filings, []);
    const complete: ExhibitOutcome = { accessionNo: "release", status: "complete", files: [{ name: "ex.htm", size: 10, sha256: "x" }], reason: null, bytesDownloaded: 10 };
    expect(companyPilotChecks(filings, quarters, [complete]).pass).toBe(true);
    expect(companyPilotChecks(filings, quarters, []).issues).toContain("1 earnings releases have no exhibit outcome");
    const missing: ExhibitOutcome = { ...complete, files: [], status: "no_exhibit", reason: "no substantive exhibit", bytesDownloaded: 0 };
    expect(companyPilotChecks(filings, quarters, [missing]).pass).toBe(true);
  });

  it("projects remaining bytes, time and the 100 GiB stop guard", () => {
    const result = projectRestRun({ eligibleCompanies: 446, pilotCompanies: 20, bytesDownloaded: 2 ** 30, elapsedSeconds: 600, freeBytes: 102 * 2 ** 30 });
    expect(result.projectedRemainingBytes).toBe(Math.round(2 ** 30 / 20 * 426));
    expect(result.projectedRemainingSeconds).toBe(12780);
    expect(result.storagePass).toBe(false);
    expect(projectRestRun({ eligibleCompanies: 20, pilotCompanies: 20, bytesDownloaded: 0, elapsedSeconds: 1, freeBytes: 100 * 2 ** 30 }).storagePass).toBe(true);
  });
});
