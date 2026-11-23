import { describe, expect, it } from "vitest";
import { buildDeskCompanyActions, buildDeskCompanyGuidance, isGuidanceRow, type GuidanceStatementRow, type StandardCompanyDoc } from "./desk-company";

const quarter = (end: string, start: string, fy: number, fq: number, filed: string, form = "10-Q") => ({ end, start, fy, fq, filed, form });
const doc: StandardCompanyDoc = {
  schemaVersion: 2, cik: 7, ticker: "GUID", name: "Guiding Corp",
  quarters: [
    quarter("2025-03-31", "2025-01-01", 2025, 1, "2025-05-01"),
    quarter("2025-06-30", "2025-04-01", 2025, 2, "2025-08-01"),
    quarter("2025-09-30", "2025-07-01", 2025, 3, "2025-11-01"),
    quarter("2025-12-31", "2025-10-01", 2025, 4, "2026-02-10", "10-K"),
    quarter("2026-03-31", "2026-01-01", 2026, 1, "2026-05-01"),
  ],
  sources: ["t:Revenues", "t:EarningsPerShareDiluted"],
  fields: {
    revenue: [[0, [["2025-05-01", 100e6, 0]]], [1, [["2025-08-01", 110e6, 0]]], [2, [["2025-11-01", 120e6, 0]]], [3, [["2026-02-10", 130e6, 0], ["2026-05-01", 131e6, 0]]], [4, [["2026-05-01", 140e6, 0]]]],
    epsDil: [[4, [["2026-05-01", 1.1, 1]]]],
  },
};
const row = (over: Partial<GuidanceStatementRow>): GuidanceStatementRow => ({
  cik: 7, availableFrom: "2026-02-11", acceptedEt: "2026-02-10T16:05:00", metric: "revenue", basis: "unclear", periodKind: "Q", periodEnd: "2026-03-31",
  timing: "forward", duplicateOf: null, flags: [], low: 130, high: 136, mid: 133, unit: "usd_millions", ...over,
});
const build = (rows: GuidanceStatementRow[]) => buildDeskCompanyGuidance({ doc, rows, guidanceVersion: "g-test", standard: "v-test", builtAt: "2026-11-22T00:00:00Z" });

describe("desk company guidance", () => {
  it("joins a quarter's guidance to the figure the company first reported, in dollars", () => {
    const [period] = build([row({})]).periods;
    expect(period).toMatchObject({ metric: "revenue", kind: "Q", periodEnd: "2026-03-31", fy: 2026, fq: 1, reaffirmed: 0, note: null });
    expect(period.updates).toEqual([{ issued: "2026-02-11", low: 130e6, high: 136e6, mid: 133e6 }]);
    expect(period.actual).toEqual({ value: 140e6, filed: "2026-05-01", how: "quarter" });
  });

  it("keeps the changes release after release and counts unchanged repeats", () => {
    const [period] = build([
      row({ periodKind: "FY", periodEnd: "2025-12-29", availableFrom: "2025-02-11", acceptedEt: "2025-02-10T16:05:00", low: 440, high: 460, mid: 450 }),
      row({ periodKind: "FY", periodEnd: "2025-12-31", availableFrom: "2025-05-02", acceptedEt: "2025-05-01T16:05:00", low: 440, high: 460, mid: 450 }),
      row({ periodKind: "FY", periodEnd: "2025-12-31", availableFrom: "2025-08-02", acceptedEt: "2025-08-01T16:05:00", low: 455, high: 465, mid: 460 }),
    ]).periods;
    // the first row's period end is two days off the company's own year end: the same period
    expect(period.periodEnd).toBe("2025-12-31");
    expect(period.updates.map((update) => [update.issued, update.mid])).toEqual([["2025-02-11", 450e6], ["2025-08-02", 460e6]]);
    expect(period.reaffirmed).toBe(1);
    // a fiscal year's revenue is the four quarters as first reported: the later restatement of Q4 is not used
    expect(period.actual).toEqual({ value: 460e6, filed: "2026-02-10", how: "four_quarters" });
  });

  it("treats revenue as one series whatever basis the release was labelled with, and earnings per share by basis", () => {
    const out = build([
      row({ basis: "gaap" }),
      row({ basis: "non_gaap", availableFrom: "2026-03-02", acceptedEt: "2026-03-01T08:00:00", low: 134, high: 138, mid: 136 }),
      row({ metric: "eps", unit: "usd_per_share", basis: "gaap", low: 1, high: 1.2, mid: 1.1 }),
      row({ metric: "eps", unit: "usd_per_share", basis: "non_gaap", low: 1.3, high: 1.5, mid: 1.4 }),
    ]);
    const revenue = out.periods.filter((period) => period.metric === "revenue");
    expect(revenue).toHaveLength(1);
    expect(revenue[0].updates).toHaveLength(2);
    const eps = out.periods.filter((period) => period.metric === "eps");
    expect(eps.map((period) => [period.basis, period.actual?.value ?? period.note])).toEqual([["gaap", 1.1], ["non_gaap", "adjusted_basis"]]);
  });

  it("says why there is nothing to compare with", () => {
    const out = build([
      row({ periodEnd: "2026-06-30", low: 150, high: 160, mid: 155 }),                         // the quarter is not reported yet
      row({ periodEnd: "2026-03-31", low: 20, high: 30, mid: 25 }),                            // a segment's revenue, not the company's
    ]);
    expect(out.periods.map((period) => [period.periodEnd, period.note])).toEqual([["2026-06-30", "not_reported_yet"], ["2026-03-31", "other_meaning"]]);
    expect(out.periods.every((period) => period.actual === null)).toBe(true);
  });

  it("uses only the guidance view and skips rows of one release that disagree", () => {
    expect(isGuidanceRow(row({ timing: "reported" }))).toBe(false);
    expect(isGuidanceRow(row({ duplicateOf: "abc" }))).toBe(false);
    expect(isGuidanceRow(row({ flags: ["metric_conflict"] }))).toBe(false);
    expect(isGuidanceRow(row({ flags: ["window_cut_off"] }))).toBe(true);
    expect(build([row({ timing: "reported" }), row({ unit: "percent" }), row({ mid: 133 }), row({ mid: 190, low: 180, high: 200 })]).periods).toEqual([]);
  });
});

describe("desk company splits and dividends", () => {
  const price = (date: string, close: string, dividend = "", splitRatio = "", distribution = "") => ({ date, close, dividend, splitRatio, distribution });

  it("lists splits, distributions and dividends newest first and sums the last year's dividends", () => {
    const out = buildDeskCompanyActions({
      cik: 7, ticker: "GUID", builtAt: "2026-11-22T00:00:00Z",
      rows: [price("2014-06-09", "90", "", "7.0"), price("2021-08-02", "100", "", "0.125"), price("2024-04-02", "150", "", "", "1.253"), price("2025-11-10", "200", "0.26"),
        price("2026-02-09", "210", "0.26"), price("2026-05-11", "220", "0.27"), price("2026-08-10", "230", "0.27"), price("2026-11-12", "240", "0.27"), price("2026-11-20", "250")],
    })!;
    expect(out).toMatchObject({ pricesAsOf: "2026-11-20", lastClose: 250, dividendsLastYear: 1.07 });
    expect(out.splits).toEqual([{ date: "2021-08-02", ratio: 0.125 }, { date: "2014-06-09", ratio: 7 }]);
    expect(out.distributions).toEqual([{ date: "2024-04-02", factor: 1.253 }]);
    expect(out.dividends.map((dividend) => dividend.date)).toEqual(["2026-11-12", "2026-08-10", "2026-05-11", "2026-02-09", "2025-11-10"]);
  });

  it("keeps ten years of dividends and returns nothing without prices", () => {
    const out = buildDeskCompanyActions({ cik: 7, ticker: "GUID", builtAt: "", rows: [price("2010-01-05", "10", "0.5"), price("2026-11-20", "250")] })!;
    expect(out.dividends).toEqual([]);
    expect(out.dividendsLastYear).toBe(0);
    expect(buildDeskCompanyActions({ cik: 7, ticker: "GUID", builtAt: "", rows: [] })).toBeNull();
  });
});
