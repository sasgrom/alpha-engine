import { describe, expect, it } from "vitest";
import {
  barFindings,
  calendarFindings,
  expectationCompanyShares,
  expectationEvidenceFindings,
  gapEntries,
  nearestHealthRatio,
  negativeValueEntry,
  nonAdditiveEntry,
  optionHealthFindings,
  priceRatioFindings,
  quoteSplitFindings,
  restatementEntry,
  unitScaleEntry,
} from "./data-health";

describe("two sources, one story", () => {
  it("accepts KO dividend steps and rejects a planted split-sized step", () => {
    const ko = [0.9741, 0.9809, 0.9877, 0.9941, 1].map((ratio, index) => ({
      ticker: "KO",
      date: `2026-0${index + 1}-01`,
      stooqClose: ratio,
      schwabClose: 1,
    }));
    expect(priceRatioFindings(ko)).toEqual([]);
    const planted = [
      ...ko.slice(0, 4),
      { ticker: "KO", date: "2026-05-01", stooqClose: 2, schwabClose: 1 },
    ];
    expect(priceRatioFindings(planted).at(-1)?.evidence.reasons).toContain(
      "step_above_15_percent"
    );
  });

  it("finds the reviewed PG 1987-10-19 archive step", () => {
    const findings = priceRatioFindings([
      {
        ticker: "PG",
        date: "1987-10-16",
        stooqClose: 0.460825495388549,
        schwabClose: 1,
      },
      {
        ticker: "PG",
        date: "1987-10-19",
        stooqClose: 0.5364222647039133,
        schwabClose: 1,
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.reasons).toContain("step_above_15_percent");
    expect(
      Number(findings[0].evidence.ratio) /
        Number(findings[0].evidence.previousRatio) -
        1
    ).toBeCloseTo(0.1640464125180927, 12);
  });
});

describe("splits from option quotes", () => {
  it("finds AAPL 4:1 and NVDA 10:1 and leaves a stable series clean", () => {
    const { splits, findings } = quoteSplitFindings([
      {
        ticker: "AAPL",
        date: "2020-08-28",
        spot: 499.325,
        schwabClose: 124.8075,
      },
      {
        ticker: "AAPL",
        date: "2020-08-31",
        spot: 129.275,
        schwabClose: 129.04,
      },
      {
        ticker: "NVDA",
        date: "2024-06-07",
        spot: 1210.65,
        schwabClose: 120.888,
      },
      { ticker: "NVDA", date: "2024-06-10", spot: 122.05, schwabClose: 121.79 },
      { ticker: "KO", date: "2026-01-05", spot: 100, schwabClose: 100 },
      { ticker: "KO", date: "2026-01-06", spot: 100.2, schwabClose: 100 },
    ]);
    expect(splits.map(row => [row.key, row.evidence.ratio])).toEqual([
      ["AAPL|2020-08-31", 4],
      ["NVDA|2024-06-10", 10],
    ]);
    expect(findings).toEqual([]);
    expect(nearestHealthRatio(1.37)).toBeNull();
  });
});

describe("bars and gaps", () => {
  it("finds a real high-below-low bar from the 2026-10-26 dump and accepts a valid bar", () => {
    const invalid = barFindings([
      {
        ticker: "ARE",
        source: "stooq",
        date: "2006-06-06",
        open: 6,
        high: 6.21779,
        low: 61.215,
        close: 6,
        volume: 100,
      },
    ]);
    expect(invalid[0].evidence).toMatchObject({
      reason: "high_below_low",
      high: 6.21779,
      low: 61.215,
    });
    expect(
      barFindings([
        {
          ticker: "ARE",
          source: "stooq",
          date: "2006-06-06",
          open: 60,
          high: 62,
          low: 59,
          close: 61,
          volume: 100,
        },
        {
          ticker: "ARE",
          source: "stooq",
          date: "2006-06-07",
          open: 61,
          high: 63,
          low: 60,
          close: 62,
          volume: 120,
        },
      ])
    ).toEqual([]);
  });

  it("reports CHTR's 25 missing sessions over its span and no gaps for a complete series", () => {
    const first = [
      "2009-12-07",
      "2009-12-21",
      "2009-12-22",
      "2009-12-23",
      "2009-12-28",
    ];
    const missing = [
      ...first,
      ...Array.from(
        { length: 20 },
        (_, index) => `2010-01-${String(index + 1).padStart(2, "0")}`
      ),
    ];
    const finding = gapEntries("CHTR", "stooq+schwab", missing)[0];
    expect(finding.evidence.missingSessions).toBe(25);
    expect(finding.evidence.dates).toEqual(expect.arrayContaining(first));
    expect(gapEntries("CHTR", "stooq+schwab", [])).toEqual([]);
  });
});

describe("filed figures", () => {
  it("rejects AAPL's former derived negative share quarter but keeps reported negative EPS", () => {
    expect(
      nonAdditiveEntry({
        cik: 320193,
        concept: "WeightedAverageNumberOfDilutedSharesOutstanding",
        periodEnd: "2026-09-26",
        vintage: "latest",
        val: -30000000,
        derivation: "derived_ytd",
        sourceAccn: "aapl-2026",
        sourceFiled: "2026-11-03",
      })?.severity
    ).toBe("quarantine");
    expect(
      nonAdditiveEntry({
        cik: 320193,
        concept: "EarningsPerShareDiluted",
        periodEnd: "2026-09-26",
        vintage: "latest",
        val: -0.5,
        derivation: "reported",
        sourceAccn: "aapl-2026",
        sourceFiled: "2026-11-03",
      })
    ).toBeNull();
  });

  it("rejects FCX's millionfold unit error without rescaling and accepts a normal ratio", () => {
    const reference = {
      concept: "WeightedAverageNumberOfDilutedSharesOutstanding",
      val: 471000000,
      filed: "2009-08-07",
      accession: "0000831259-09-000076",
      periodEnd: "2009-06-30",
      startDate: "2009-04-01",
    };
    const candidate = {
      ...reference,
      val: 471,
      filed: "2010-08-06",
      accession: "0000831259-10-000048",
    };
    const finding = unitScaleEntry(candidate, reference);
    expect(finding?.evidence).toMatchObject({
      factor: 0.000001,
      action: "reject_without_rescaling",
    });
    expect(
      unitScaleEntry({ ...candidate, val: 471500000 }, reference)
    ).toBeNull();
  });

  it("flags AIG's reported negative revenue and allows a positive value", () => {
    expect(
      negativeValueEntry({
        cik: 884887,
        concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
        periodEnd: "2020-09-30",
        vintage: "latest",
        val: -33688000,
        sourceAccn: "0000884887-21-000028",
        sourceFiled: "2021-10-29",
      })?.severity
    ).toBe("quarantine");
    expect(
      negativeValueEntry({
        cik: 884887,
        concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
        periodEnd: "2021-09-30",
        vintage: "latest",
        val: 1,
        sourceAccn: null,
        sourceFiled: null,
      })
    ).toBeNull();
  });

  it("reports LIN's successor restatement without quarantining it and accepts a small revision", () => {
    expect(
      restatementEntry({
        cik: 1707925,
        concept: "NetIncomeLoss",
        periodEnd: "2017-09-30",
        first: -290825,
        latest: 419000000,
        firstFiled: "2017-10-30",
        latestFiled: "2019-03-18",
        latestAccession: "0001628280-19-003050",
      })?.severity
    ).toBe("info");
    expect(
      restatementEntry({
        cik: 1707925,
        concept: "NetIncomeLoss",
        periodEnd: "2017-09-30",
        first: 100,
        latest: 105,
        firstFiled: null,
        latestFiled: null,
        latestAccession: null,
      })
    ).toBeNull();
  });
});

describe("calendar anomalies", () => {
  it("includes TMUS 2006 and TXN 2010-06-30 and accepts a clean calendar", () => {
    const findings = calendarFindings({
      outOfOrderNextPublications: [
        {
          cik: 1283699,
          ticker: "TMUS",
          fiscalPeriodEnd: "2006-09-30",
          firstPublicationEt: "2007-04-09T14:23:47",
          nextFiscalPeriodEnd: "2006-12-31",
          nextFirstPublicationCandidate: "2007-03-30T15:50:53",
        },
      ],
      duplicateOriginalPeriods: [
        {
          cik: 97476,
          ticker: "TXN",
          fiscalPeriodEnd: "2010-06-30",
          keptAccession: "0001140361-10-029928",
          duplicates: [
            {
              accessionNo: "0001140361-10-029984",
              form: "10-Q",
              acceptedUtc: "2010-07-22T15:50:22.000Z",
            },
          ],
        },
      ],
    });
    expect(findings.map(row => row.key)).toEqual([
      "1283699|2006-09-30",
      "97476|0001140361-10-029984",
    ]);
    expect(
      calendarFindings({
        outOfOrderNextPublications: [],
        duplicateOriginalPeriods: [],
      })
    ).toEqual([]);
  });
});

describe("model evidence", () => {
  const row = {
    cik: 1045810,
    ticker: "NVDA",
    accessionNo: "0001045810-04-000011",
    filingDate: "2004-02-12",
    updatedAt: "2026-11-08T00:00:00Z",
    status: "empty",
    rejectedEvidence: 1,
    statements: [],
    sourceFile: "000104581004000011.ex-q105prfinancials.htm",
  };
  it("counts NVDA's rejected quote per release and accepts verified releases", () => {
    expect(
      expectationEvidenceFindings([row])[0].evidence.rejectedStatements
    ).toBe(1);
    expect(
      expectationEvidenceFindings([
        { ...row, rejectedEvidence: 0, status: "extracted" },
      ])
    ).toEqual([]);
    expect(
      expectationCompanyShares([
        row,
        { ...row, accessionNo: "clean", rejectedEvidence: 1, statements: [{}] },
      ])[0]
    ).toMatchObject({
      rejectedReleases: 2,
      rejectedStatements: 2,
      acceptedStatements: 1,
      rejectedShare: 2 / 3,
    });
  });
});

describe("option snapshot health", () => {
  it("accepts a quote-derived spot, valid IV and a nearby ATM strike", () => {
    expect(
      optionHealthFindings({
        ticker: "AAPL",
        date: "2020-08-31",
        spot: 129.04,
        spotSource: "put-call parity",
        atmIv: 0.3,
        atmStrike: 125,
      })
    ).toEqual([]);
  });

  it("rejects a missing spot, out-of-range IV and a distant ATM strike", () => {
    const findings = optionHealthFindings({
      ticker: "AAPL",
      date: "2020-08-31",
      spot: 100,
      spotSource: "price history",
      atmIv: 0.02,
      atmStrike: 150,
    });
    expect(findings.map(row => row.evidence.reason)).toEqual([
      "missing_quote_derived_spot",
      "atm_iv_outside_bounds",
      "atm_strike_not_within_5_percent",
    ]);
  });
});
