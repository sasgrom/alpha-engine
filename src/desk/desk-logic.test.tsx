import { describe, expect, it } from "vitest";
import type { DeskCompany, DeskSnapshot } from "@contracts/desk-snapshot";
import { CHART_PALETTE, divergingColor, hexToOklab, labelInk, mixOklab, oklabToHex } from "./charts/color";
import { niceTicks } from "./charts/scale";
import { squarify } from "./charts/squarify";
import { earningsRadar, findCompany, impliedMoveFor, marketBrief, movers, peersOf, periodBreadth, searchCompanies } from "./data";
import { entityName, fmtCap, fmtDate, fmtPct, fmtPrice, localToday, personName, readable, relativeDay, tone } from "./format";

function company(ticker: string, overrides: Partial<DeskCompany> = {}): DeskCompany {
  return {
    ticker,
    registryTicker: ticker,
    cik: ticker.split("").reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7),
    name: `${ticker} Corp`,
    sector: "Information Technology",
    industry: "Software",
    research: false,
    close: 100,
    lastDate: "2026-11-10",
    returns: { d1: 0.01, w1: 0.02, m1: 0.03, m3: 0.04, ytd: 0.05, y1: 0.06 },
    high52: 120,
    low52: 80,
    ma50: 98,
    ma200: 95,
    vol20: 0.25,
    marketCap: 1e11,
    pe: 20,
    beta: 1,
    dividendYield: 0.01,
    epsTtm: 5,
    lastEarnings: null,
    lastEarningsReaction: null,
    lastEarningsReactionSessions: null,
    nextEarnings: null,
    nextEarningsBasis: null,
    options: null,
    spark: [1, 2, 3],
    ...overrides,
  };
}

describe("squarify", () => {
  it("fills the rectangle exactly with one tile per positive value, largest first", () => {
    const tiles = squarify([6, 6, 4, 3, 2, 2, 1, 0, -1].map((value, index) => ({ value, item: index })), { x: 0, y: 0, w: 600, h: 400 });
    expect(tiles.map((tile) => tile.item)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const area = tiles.reduce((sum, tile) => sum + tile.w * tile.h, 0);
    expect(area).toBeCloseTo(600 * 400, 6);
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(-1e-9);
      expect(tile.y).toBeGreaterThanOrEqual(-1e-9);
      expect(tile.x + tile.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(tile.y + tile.h).toBeLessThanOrEqual(400 + 1e-6);
      // areas stay proportional to the values (total 24 → 10,000 px² per unit)
      expect(tile.w * tile.h).toBeCloseTo(tile.value * 10_000, 4);
    }
    // the squarified layout keeps tiles far from slivers
    expect(Math.max(...tiles.map((tile) => Math.max(tile.w / tile.h, tile.h / tile.w)))).toBeLessThan(4);
  });

  it("returns nothing for an empty or degenerate input", () => {
    expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(squarify([{ value: 1, item: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
  });
});

describe("chart colors", () => {
  it("round-trips through OKLab and mixes from the gray midpoint to each pole", () => {
    for (const hex of ["#2a78d6", "#e34948", "#f0efec", "#1a1a19"]) expect(oklabToHex(hexToOklab(hex))).toBe(hex);
    const palette = CHART_PALETTE.light;
    expect(divergingColor(0, 0.03, palette)).toBe(palette.mid);
    expect(divergingColor(null, 0.03, palette)).toBe(palette.mid);
    expect(divergingColor(0.05, 0.03, palette)).toBe(palette.pos);
    expect(divergingColor(-0.05, 0.03, palette)).toBe(palette.neg);
    // lightness falls monotonically from the light midpoint toward the pole
    const lightness = [0, 0.25, 0.5, 0.75, 1].map((t) => hexToOklab(mixOklab(palette.mid, palette.pos, t))[0]);
    for (let k = 1; k < lightness.length; k++) expect(lightness[k]).toBeLessThan(lightness[k - 1]);
  });

  it("picks the label ink that reads better on a fill", () => {
    expect(labelInk("#f0efec")).toBe("#0b0b0b");
    expect(labelInk("#1c5cab")).toBe("#ffffff");
  });

  it("builds nice axis ticks", () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    // ticks stay inside the extent: the chart's domain is the padded data range, not the outer ticks
    expect(niceTicks(243.4, 351.2, 4)).toEqual([250, 300, 350]);
    expect(niceTicks(243.4, 351.2, 8)).toEqual([260, 280, 300, 320, 340]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("formatting", () => {
  it("formats percentages with a true minus sign and unsigned zeros", () => {
    expect(fmtPct(0.01234)).toBe("+1.2%");
    expect(fmtPct(-0.0567, 2)).toBe("−5.67%");
    expect(fmtPct(0.00001)).toBe("0.0%");
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(0.3, 0, false)).toBe("30%");
  });

  it("formats prices, market values and dates", () => {
    expect(fmtPrice(1234.5)).toBe("$1,234.50");
    expect(fmtCap(5.0963e12)).toBe("$5.10T");
    expect(fmtCap(8.12e11)).toBe("$812B");
    expect(fmtCap(9.4e9)).toBe("$9.40B");
    expect(fmtDate("2026-11-10", "short")).toBe("Nov 10");
    expect(fmtDate("2026-11-10", "weekday")).toBe("Tue, Nov 10");
    expect(relativeDay("2026-11-17", "2026-11-10")).toBe("in 7 days");
    expect(relativeDay("2026-11-09", "2026-11-10")).toBe("yesterday");
    expect(tone(-0.02)).toBe("down");
    expect(tone(0)).toBe("flat");
    expect(localToday(new Date(2026, 10, 11, 23, 30))).toBe("2026-11-11");
  });

  it("cleans filer names for display", () => {
    expect(entityName("STATE STREET CORP (STT, STT-PG) (CIK 0000093751)")).toBe("State Street Corp");
    expect(entityName("VANGUARD CAPITAL MANAGEMENT LLC (CIK 0002100119)")).toBe("Vanguard Capital Management LLC");
    expect(entityName("FMR LLC")).toBe("FMR LLC");
    expect(entityName("T. ROWE PRICE ASSOCIATES, INC.")).toBe("T. Rowe Price Associates, Inc.");
    expect(entityName("BlackRock, Inc.")).toBe("BlackRock, Inc.");
    // a name cut off inside its ticker list (stored names end at 128 characters) must clean up at once
    const truncated = "WELLS FARGO & COMPANY/MN (WFC, WFCNP, WFC-PA, WFC-PC, WFC-PD, WFC-PL, WFC-PY, WFC-PZ, WFC-PA, WFC-PC, WFC-PD, WFC-PL, WFC-PY, WF";
    const started = Date.now();
    expect(entityName(truncated)).toBe("Wells Fargo & Company");
    expect(entityName("PRIMECAP MANAGEMENT CO/CA/ (CIK 0000763212)")).toBe("Primecap Management Co");
    expect(Date.now() - started).toBeLessThan(50);
    expect(entityName("FIFTH THIRD BANCORP (FITB, FITB-PA, FITB-PI) (CIK 0000035527)")).toBe("Fifth Third Bancorp");
    expect(entityName("BERKSHIRE HATHAWAY INC (BRK-A, BRK-B) (CIK 00010679")).toBe("Berkshire Hathaway Inc");
    expect(personName("Newstead Jennifer")).toBe("Jennifer Newstead");
    expect(personName("COOK TIMOTHY D")).toBe("Timothy D Cook");
    expect(personName("Smith John Jr")).toBe("John Smith Jr");
    expect(personName("Sequoia Capital Fund LP")).toBe("Sequoia Capital Fund LP");
    expect(personName("Levinson, Arthur")).toBe("Levinson, Arthur");
  });

  it("makes report text readable", () => {
    expect(readable("push failed: HTTP 413 (fatal): <html> <head><title>413 Request Entity Too Large</title></head></html>")).toBe("push failed: HTTP 413 (fatal): 413 Request Entity Too Large");
    expect(readable("Not due yet; next run 2026-11-12T12:30:00.000Z.")).toMatch(/^Not due yet; next run Nov 12, \d{1,2}:30 (AM|PM)\.$/);
  });
});

describe("desk derivations", () => {
  const companies = [
    company("AAPL", { name: "Apple Inc.", marketCap: 5e12, returns: { d1: -0.006, w1: 0.05, m1: 0.03, m3: 0.13, ytd: 0.28, y1: 0.3 } }),
    company("AMZN", { name: "Amazon", marketCap: 2.4e12, sector: "Consumer Discretionary", industry: "Broadline Retail", returns: { d1: 0.02, w1: null, m1: null, m3: null, ytd: null, y1: null } }),
    company("APA", { name: "APA Corporation", marketCap: 8e9, sector: "Energy", industry: "Oil & Gas", returns: { d1: -0.04, w1: null, m1: null, m3: null, ytd: null, y1: null } }),
    company("MA", { name: "Mastercard", marketCap: 5e11, sector: "Financials", returns: { d1: 0, w1: null, m1: null, m3: null, ytd: null, y1: null } }),
    company("BRK-B", { name: "Berkshire Hathaway", marketCap: 1e12, sector: "Financials", returns: { d1: 0.01, w1: null, m1: null, m3: null, ytd: null, y1: null } }),
    company("MSFT", { name: "Microsoft", marketCap: 4e12, returns: { d1: -0.01, w1: null, m1: null, m3: null, ytd: null, y1: null } }),
  ];

  it("ranks search results: exact ticker, ticker prefix, name word, then anywhere", () => {
    expect(searchCompanies(companies, "ma").map((row) => row.ticker)).toEqual(["MA", "AMZN"]);
    expect(searchCompanies(companies, "a").slice(0, 3).map((row) => row.ticker)).toEqual(["AAPL", "AMZN", "APA"]);
    expect(searchCompanies(companies, "berk")[0].ticker).toBe("BRK-B");
    expect(searchCompanies(companies, "brkb")[0].ticker).toBe("BRK-B");
    expect(searchCompanies(companies, "  ")).toEqual([]);
    expect(findCompany({ companies } as DeskSnapshot, "brk.b")?.ticker).toBe("BRK-B");
  });

  it("splits movers and breadth by period, ignoring missing returns", () => {
    const result = movers(companies, "d1", 2);
    expect(result.gainers.map((row) => row.ticker)).toEqual(["AMZN", "BRK-B"]);
    expect(result.losers.map((row) => row.ticker)).toEqual(["APA", "MSFT"]);
    expect(periodBreadth(companies, "d1")).toEqual({ measured: 6, up: 2, down: 3, flat: 1, median: -0.003 });
    expect(periodBreadth(companies, "w1")).toMatchObject({ measured: 1, up: 1 });
  });

  it("lists recent and projected reports around the session", () => {
    const snapshot = {
      session: "2026-11-10",
      companies: [
        company("A", { lastEarnings: "2026-11-05", nextEarnings: "2027-02-04" }),
        company("B", { lastEarnings: "2026-10-01", nextEarnings: "2026-11-18" }),
        company("C", { lastEarnings: "2026-11-10", nextEarnings: "2026-11-30" }),
      ],
    } as DeskSnapshot;
    const radar = earningsRadar(snapshot, 7, 14);
    expect(radar.reported.map((row) => row.ticker)).toEqual(["C", "A"]);
    expect(radar.upcoming.map((row) => row.ticker)).toEqual(["B"]);
  });

  it("finds the implied move to the first expiry covering a date", () => {
    const withOptions = company("X", {
      options: {
        capturedAt: "2026-11-11T12:00:00Z",
        rv20: 0.2,
        ivRvSpread: 0.05,
        buckets: [
          { bucket: "1-7D", days: 5, atmIv: 0.3, expectedMovePct: 0.03, skew25: null, putCallOiRatio: null },
          { bucket: "8-30D", days: 16, atmIv: 0.3, expectedMovePct: 0.05, skew25: null, putCallOiRatio: null },
        ],
      },
    });
    expect(impliedMoveFor(withOptions, 8)).toEqual({ pct: 0.05, days: 16 });
    expect(impliedMoveFor(withOptions, 1)).toEqual({ pct: 0.03, days: 5 });
    // an expiry far beyond the date says nothing about it
    expect(impliedMoveFor(withOptions, 2)).toEqual({ pct: 0.03, days: 5 });
    expect(impliedMoveFor({ ...withOptions, options: { ...withOptions.options!, buckets: withOptions.options!.buckets.slice(1) } }, 3)).toBeNull();
    expect(impliedMoveFor(withOptions, 40)).toBeNull();
    expect(impliedMoveFor(company("Y"), 3)).toBeNull();
  });

  it("orders peers by same industry first", () => {
    const snapshot = { companies } as DeskSnapshot;
    expect(peersOf(snapshot, companies[0], 3).map((row) => row.ticker)).toEqual(["MSFT"]);
  });

  it("writes the brief from the snapshot alone", () => {
    const snapshot = {
      session: "2026-11-10",
      breadth: { measured: 492, advancers: 244, decliners: 242, unchanged: 6, medianChange: 0, newHighs: 29, newLows: 3, aboveMa50: 0, withMa50: 0, aboveMa200: 0, withMa200: 0 },
      benchmark: { ticker: "SPY", close: 749.92, lastDate: "2026-11-10", returns: { d1: -0.0037, w1: null, m1: null, m3: null, ytd: null, y1: null }, spark: [] },
      sectors: [
        { name: "Financials", companies: 75, marketCap: 1, advancers: 1, decliners: 1, returns: { d1: 0.0052, w1: null, m1: null, m3: null, ytd: null, y1: null } },
        { name: "Information Technology", companies: 73, marketCap: 2, advancers: 1, decliners: 1, returns: { d1: -0.0141, w1: null, m1: null, m3: null, ytd: null, y1: null } },
      ],
      companies: [company("NVDA", { name: "Nvidia", returns: { d1: -0.0547, w1: null, m1: null, m3: null, ytd: null, y1: null } })],
    } as unknown as DeskSnapshot;
    const text = marketBrief(snapshot).map((sentence) => sentence.map((part) => (typeof part === "string" ? part : part.strong)).join("")).join(" ");
    expect(text).toContain("It was a mixed session: 244 of 492 S&P 500 companies closed higher and 242 lower, while SPY −0.37%.");
    expect(text).toContain("Financials led (+0.52%) and Information Technology lagged (−1.41%).");
    expect(text).toContain("Among the largest companies, Nvidia fell 5.5%.");
    expect(text).toContain("29 closed at a 52-week high and 3 at a 52-week low.");
  });
});
