import { describe, expect, it } from "vitest";
import type { DeskCompanyGuidance, DeskGuidancePeriod, DeskGuidanceUpdate } from "../../contracts/desk-company";
import { buildDeskGuidanceMarket, type GuidanceStatementRow } from "./desk-company";

const update = (issued: string, low: number | null, high: number | null, mid: number): DeskGuidanceUpdate => ({ issued, low, high, mid });
const period = (over: Partial<DeskGuidancePeriod>): DeskGuidancePeriod => ({
  metric: "revenue", basis: "unclear", kind: "FY", periodEnd: "2026-12-31", fy: 2026, fq: null, updates: [], reaffirmed: 0, actual: null, note: "not_reported_yet", ...over,
});
const guidance = (cik: number, ticker: string, periods: DeskGuidancePeriod[]): DeskCompanyGuidance => ({ schemaVersion: 2, cik, ticker, guidanceVersion: "g-test", standard: "v-test", builtAt: "", periods });
const row = (over: Partial<GuidanceStatementRow>): GuidanceStatementRow => ({
  cik: 5, availableFrom: "2026-10-30", acceptedEt: "2026-10-30T07:00:00", metric: "revenue", basis: "gaap", periodKind: "FY", periodEnd: "2026-12-31", timing: "forward",
  duplicateOf: null, flags: [], low: 410, high: 420, mid: 415, unit: "usd_billions", quote: "We now expect revenue of $410 billion to $420 billion", ...over,
});
/** A period whose reported figure came in `miss` away from a guided 100. */
const compared = (end: string, miss: number, metric: "revenue" | "eps" = "revenue") =>
  period({ metric, kind: "Q", periodEnd: end, updates: [update("2026-08-01", null, null, 100)], actual: { value: 100 * (1 + miss), filed: end, how: "quarter" }, note: null });

describe("guidance across companies", () => {
  it("lists the changes of the last year with what stood before, and the release's own words for the figure", () => {
    const market = buildDeskGuidanceMarket({
      standard: "v-test", builtAt: "",
      companies: [
        {
          guidance: guidance(5, "RAIS", [
            period({ updates: [update("2026-02-01", 390e9, 400e9, 395e9), update("2026-07-30", 400e9, 410e9, 405e9), update("2026-10-30", 410e9, 420e9, 415e9)] }),
            // the midpoint stayed, the range narrowed
            period({ metric: "eps", basis: "non_gaap", updates: [update("2026-07-30", 4.8, 5.2, 5), update("2026-10-30", 4.9, 5.1, 5)] }),
          ]),
          rows: [
            row({}),
            // the same release also guides the next year: another period, never this figure's words
            row({ periodEnd: "2027-12-31", mid: 440, quote: "and $440 billion in 2027" }),
            // two statements of one release for the period: the one nearest the figure shown is quoted
            row({ availableFrom: "2026-07-30", mid: 404, quote: "about $404 billion" }),
            row({ availableFrom: "2026-07-30", mid: 405, quote: "revenue of $400 billion   to $410 billion" }),
          ],
        },
        {
          guidance: guidance(6, "CUTS", [
            period({ metric: "eps", basis: "gaap", kind: "Q", periodEnd: "2026-12-31", fq: 4, updates: [update("2026-08-05", null, null, -0.5), update("2026-11-04", null, null, -0.75)] }),
            // older than a year: outside the list
            period({ periodEnd: "2025-12-31", fy: 2025, updates: [update("2025-02-01", null, null, 10e9), update("2025-10-30", null, null, 11e9)] }),
          ]),
          rows: [],
        },
        { guidance: guidance(7, "NONE", []), rows: [] },
      ],
    })!;
    expect(market).toMatchObject({ guidanceVersion: "g-test", standard: "v-test", asOf: "2026-11-04", companies: 2 });
    expect(market.changes.map((change) => [change.ticker, change.issued, change.metric, change.what, change.change])).toEqual([
      // a loss guided deeper is a cut, measured on the size of the figure
      ["CUTS", "2026-11-04", "eps", "cut", -0.5],
      ["RAIS", "2026-10-30", "eps", "range", 0],
      ["RAIS", "2026-10-30", "revenue", "raised", 0.0247],
      ["CUTS", "2026-08-05", "eps", "first", null],
      ["RAIS", "2026-07-30", "eps", "first", null],
      ["RAIS", "2026-07-30", "revenue", "raised", 0.0253],
      ["RAIS", "2026-02-01", "revenue", "first", null],
    ]);
    const raised = market.changes[2];
    expect(raised).toMatchObject({ before: { low: 400e9, high: 410e9, mid: 405e9 }, now: { low: 410e9, high: 420e9, mid: 415e9 }, quote: "We now expect revenue of $410 billion to $420 billion", kind: "FY", fy: 2026 });
    expect(market.changes[5].quote).toBe("revenue of $400 billion to $410 billion");
    // no statement of that release for that measure and period: no words
    expect(market.changes[0].quote).toBeNull();
    expect(market.changes[1].quote).toBeNull();
  });

  it("keeps each company's record where four periods can be compared, and the habit of all companies over three years", () => {
    const market = buildDeskGuidanceMarket({
      standard: "v-test", builtAt: "",
      companies: [
        { guidance: guidance(5, "BEAT", [compared("2026-09-30", 0.04), compared("2026-06-30", 0.02), compared("2026-03-31", -0.01), compared("2025-12-31", 0.03), compared("2021-12-31", 0.5)]), rows: [] },
        // three periods only: no record of its own, but they count in the habit
        { guidance: guidance(6, "FEW", [compared("2026-09-30", -0.02, "eps"), compared("2026-06-30", -0.04, "eps"), compared("2026-03-31", 0.06, "eps")]), rows: [] },
      ],
    })!;
    // five periods, four above; the median of 0.5, 0.04, 0.03, 0.02, -0.01
    expect(market.records).toEqual([{ cik: 5, ticker: "BEAT", metric: "revenue", compared: 5, above: 4, median: 0.03 }]);
    // the period of 2021 is older than three years: four revenue periods, three above
    expect(market.habit).toEqual({ revenue: { compared: 4, above: 3, median: 0.025 }, eps: { compared: 3, above: 1, median: -0.02 } });
    expect(buildDeskGuidanceMarket({ standard: "v-test", builtAt: "", companies: [{ guidance: guidance(7, "NONE", []), rows: [] }] })).toBeNull();
  });
});
