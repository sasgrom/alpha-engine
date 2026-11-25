import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildNameIndex,
  buildOrderFreeNameIndex,
  calendarQuarterEnds,
  latestReportOnOrBefore,
  matchHolding,
  membershipAgreement,
  mergeCompanyMembership,
  normalizeIssuerName,
  parseNportXml,
  secDisplayIssuerName,
  type ReportRef,
} from "./russell1000";
import { sectorFromSic, validateSectorMap } from "./russell1000-sector";

const fixture = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "test-fixtures",
    "nport-russell1000.xml"
  ),
  "utf8"
);

describe("Russell 1000 N-PORT parsing and matching", () => {
  it("parses equity fields and lists non-equity exclusions", () => {
    const report = parseNportXml(fixture);
    expect(report.seriesId).toBe("S000004347");
    expect(report.reportDate).toBe("2024-09-30");
    expect(report.holdings).toHaveLength(3);
    expect(report.holdings[0]).toMatchObject({
      name: "Example & Co.",
      cusip: "000000001",
      isin: "US0000000017",
      shares: 10,
      valueUsd: 100.5,
      weightPct: 0.25,
    });
    expect(report.holdings[0].identifiers).toEqual([
      { tag: "isin", value: "US0000000017" },
      { tag: "other", value: "other-id" },
    ]);
    expect(report.excluded.map(row => row.reason)).toEqual([
      "assetCat:STIF",
      "assetCat:FE",
    ]);
  });

  it("uses CUSIP before exact normalized current or former names", () => {
    const [first, second, third] = parseNportXml(fixture).holdings;
    const matcher = {
      cusipToCik: new Map([
        ["000000001", 100],
        ["000000002", 100],
      ]),
      nameToCik: buildNameIndex([
        { cik: 100, name: "Different Current Name", kind: "current" },
        { cik: 200, name: "Unmatched Issuer Limited", kind: "former" },
      ]),
    };
    expect(matchHolding(first, matcher)).toMatchObject({
      cik: 100,
      matchSource: "cusip",
    });
    expect(matchHolding(second, matcher)).toMatchObject({
      cik: 100,
      matchSource: "cusip",
    });
    expect(matchHolding(third, matcher)).toMatchObject({
      cik: 200,
      matchSource: "name",
    });
  });

  it("matches inverted SEC names by unique date-valid word sets", () => {
    const source = parseNportXml(fixture).holdings[0];
    const identities = [
      {
        cik: 1113169,
        name: "PRICE T ROWE GROUP INC",
        kind: "current" as const,
      },
    ];
    const matched = matchHolding(
      { ...source, name: "The T Rowe Price Group Inc" },
      {
        cusipToCik: new Map(),
        nameToCik: new Map(),
        orderFreeNameToCik: buildOrderFreeNameIndex(identities, "2024-09-30"),
      }
    );
    expect(matched).toMatchObject({
      cik: 1113169,
      matchSource: "name-order-free",
    });
  });

  it("uses ISIN, active tickers and unique OpenFIGI results as bounded fallbacks", () => {
    const source = {
      ...parseNportXml(fixture).holdings[0],
      name: "Unknown Issuer",
    };
    expect(
      matchHolding(
        { ...source, cusip: null, isin: "US74144T1088" },
        { cusipToCik: new Map([["74144T108", 1113169]]), nameToCik: new Map() }
      )
    ).toMatchObject({ cik: 1113169, matchSource: "isin" });
    expect(
      matchHolding(
        {
          ...source,
          identifiers: [{ tag: "other", description: "Ticker", value: "TTD" }],
        },
        {
          cusipToCik: new Map(),
          nameToCik: new Map(),
          tickerToCik: new Map([["TTD", 1671933]]),
        }
      )
    ).toMatchObject({ cik: 1671933, matchSource: "ticker" });
    const figiByCusip = new Map([
      [
        source.cusip!,
        [{ ticker: "TTD", name: "Trade Desk", exchange: "NASDAQ" }],
      ],
    ]);
    expect(
      matchHolding(source, {
        cusipToCik: new Map(),
        nameToCik: new Map(),
        tickerToCik: new Map([["TTD", 1671933]]),
        figiByCusip,
      })
    ).toMatchObject({ cik: 1671933, matchSource: "openfigi-ticker" });
    const ambiguous = new Map([
      [
        source.cusip!,
        [
          { ticker: "TTD", name: "Trade Desk", exchange: "NASDAQ" },
          { ticker: "OTHER", name: "Other", exchange: "NYSE" },
        ],
      ],
    ]);
    expect(
      matchHolding(source, {
        cusipToCik: new Map(),
        nameToCik: new Map(),
        tickerToCik: new Map([
          ["TTD", 1671933],
          ["OTHER", 2],
        ]),
        figiByCusip: ambiguous,
      }).cik
    ).toBeNull();
  });

  it("retains tracking stocks as separate flagged security lines", () => {
    const source = parseNportXml(fixture).holdings[0];
    const liberty = matchHolding(
      {
        ...source,
        name: "Liberty Media Corp-Liberty Formula One",
        cusip: "531229854",
      },
      { cusipToCik: new Map([["531229854", 1560385]]), nameToCik: new Map() }
    );
    const ordinary = matchHolding(source, {
      cusipToCik: new Map([["000000001", 100]]),
      nameToCik: new Map(),
    });
    const members = mergeCompanyMembership([liberty, ordinary]);
    const libertyLine = members.find(row => row.cik === 1560385)!.lines[0];
    expect(libertyLine).toMatchObject({
      trackingStock: true,
      securityKey: "531229854",
    });
    expect(
      matchHolding(
        {
          ...source,
          name: "Liberty Media Corp-Liberty Formula One",
          cusip: null,
        },
        {
          cusipToCik: new Map(),
          nameToCik: new Map(),
          orderFreeNameToCik: buildOrderFreeNameIndex([
            { cik: 1560385, name: "Liberty Media Corp", kind: "current" },
          ]),
        }
      )
    ).toMatchObject({ cik: 1560385, trackingStock: true });
    expect(members.find(row => row.cik === 100)!.lines[0].trackingStock).toBe(
      false
    );
  });

  it("rejects ambiguous names and normalizes legal suffix abbreviations", () => {
    expect(normalizeIssuerName("Example & Company, Incorporated")).toBe(
      "EXAMPLE AND CO INC"
    );
    expect(
      normalizeIssuerName(
        secDisplayIssuerName(
          "UNITED TECHNOLOGIES CORP /DE/  (RTX)  (CIK 0000101829)"
        )
      )
    ).toBe("UNITED TECHNOLOGIES CORP");
    expect(normalizeIssuerName("Spotify Technology SA")).toBe(
      normalizeIssuerName("SPOTIFY TECHNOLOGY S.A.")
    );
    expect(normalizeIssuerName("UBIQUITI INC COMMON STOCK USD.001")).toBe(
      "UBIQUITI INC"
    );
    expect(normalizeIssuerName("Trade Desk Inc/The")).toBe("TRADE DESK INC");
    expect(normalizeIssuerName("Western Alliance Bancorp")).toBe(
      normalizeIssuerName("WESTERN ALLIANCE BANCORPORATION")
    );
    expect(normalizeIssuerName("NU Holdings Ltd/Cayman Islands")).toBe(
      "NU HOLDINGS LTD"
    );
    expect(normalizeIssuerName("Horizon Therapeutics Plc")).toBe(
      normalizeIssuerName("Horizon Therapeutics Public Ltd Co")
    );
    expect(
      secDisplayIssuerName(
        "Liberty Broadband Corp  (LBRDA, LBRDB, LBRDK)  (CIK 0001611983)"
      )
    ).toBe("Liberty Broadband Corp");
    const historical = [
      {
        cik: 101829,
        name: "UNITED TECHNOLOGIES CORP /DE/",
        kind: "former" as const,
        from: "1994-01-24T05:00:00.000Z",
        to: "2020-04-06T04:00:00.000Z",
      },
    ];
    expect(
      buildNameIndex(historical, "2019-09-30").get("UNITED TECHNOLOGIES CORP")
    ).toBe(101829);
    expect(
      buildNameIndex(historical, "2021-09-30").has("UNITED TECHNOLOGIES CORP")
    ).toBe(false);
    const index = buildNameIndex([
      { cik: 1, name: "Same Name", kind: "current" },
      { cik: 2, name: "Same Name", kind: "former" },
    ]);
    expect(index.has("SAME NAME")).toBe(false);
    const unmatched = parseNportXml(fixture).holdings[2];
    expect(
      matchHolding(unmatched, { cusipToCik: new Map(), nameToCik: new Map() })
        .cik
    ).toBeNull();
  });

  it("merges share classes at the company level", () => {
    const holdings = parseNportXml(fixture).holdings.map(holding =>
      matchHolding(holding, {
        cusipToCik: new Map([
          ["000000001", 100],
          ["000000002", 100],
        ]),
        nameToCik: new Map(),
      })
    );
    const members = mergeCompanyMembership(holdings);
    expect(members).toHaveLength(1);
    expect(members[0].cik).toBe(100);
    expect(members[0].lines).toHaveLength(2);
    expect(members[0].weightPct).toBeCloseTo(0.75);
  });
});

describe("Russell 1000 membership rules", () => {
  const reports: ReportRef[] = [
    {
      accession: "a",
      reportDate: "2024-03-31",
      filed: "2024-05-01",
      sha256: "a",
    },
    {
      accession: "b",
      reportDate: "2024-06-30",
      filed: "2024-08-01",
      sha256: "b",
    },
  ];

  it("uses the latest report on or before each quarter end", () => {
    expect(latestReportOnOrBefore(reports, "2024-06-30")?.accession).toBe("b");
    expect(latestReportOnOrBefore(reports, "2024-06-29")?.accession).toBe("a");
    expect(latestReportOnOrBefore(reports, "2024-03-01")).toBeNull();
    expect(calendarQuarterEnds("2019-09-30", "2020-06-30")).toEqual([
      "2019-09-30",
      "2019-12-31",
      "2020-03-31",
      "2020-06-30",
    ]);
  });

  it("measures agreement over the union of both funds", () => {
    expect(membershipAgreement(new Set([1, 2]), new Set([2, 3]))).toBeCloseTo(
      1 / 3
    );
    expect(membershipAgreement(new Set(), new Set())).toBe(1);
  });
});

describe("SIC sector map", () => {
  it("uses specific exceptions before broad ranges", () => {
    expect(sectorFromSic(7372)).toBe("Information Technology");
    expect(sectorFromSic(2834)).toBe("Health Care");
    expect(sectorFromSic(1311)).toBe("Energy");
    expect(sectorFromSic(6020)).toBe("Financials");
    expect(sectorFromSic(9999)).toBeNull();
  });

  it("reports agreement and the full confusion table", () => {
    const result = validateSectorMap([
      { cik: 1, sic: "7372", registrySector: "Information Technology" },
      { cik: 2, sic: "1311", registrySector: "Materials" },
      { cik: 3, sic: null, registrySector: "Utilities" },
    ]);
    expect(result).toMatchObject({
      population: 3,
      evaluated: 2,
      agreements: 1,
      agreementShare: 0.5,
      unmapped: 1,
    });
    expect(result.confusion.Materials.Energy).toBe(1);
  });
});
