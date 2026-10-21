/**
 * Fixture tests of the header-driven Wikipedia table parser (services/wikitable.ts).
 *
 * Why fixtures: the structure of the three target tables (S&P 500 /
 * NASDAQ-100 / Dow) was verified against the live pages on 2026-10-10, but
 * the sandbox has no guaranteed network access and Wikipedia occasionally
 * changes its markup. These fixtures reproduce the real layout
 * (id="constituents", column order, entities) — if the parser breaks during
 * a refactor, the tests fail BEFORE a production scope-resolve run.
 *
 * If Wikipedia CHANGES its structure (renames columns etc.), it will be
 * the production fetch that fails ("table not found"), not the test; then
 * the fixture and the column regexes in INDEX_SOURCES (edgar.ts) must be
 * updated together.
 */
import { describe, it, expect } from "vitest";
import { parseWikiTables, projectColumns, cellText } from "./wikitable";

// --- fixtures: shortened but structurally exact copies of the live tables ---

/** S&P 500: id="constituents", columns Symbol|Security|GICS Sector|GICS Sub-Industry|...|CIK|... */
const SP500_HTML = `
<html><body>
<table class="wikitable sortable" id="constituents">
<tr><th>Symbol</th><th>Security</th><th>GICS Sector</th><th>GICS Sub-Industry</th><th>Headquarters Location</th><th>Date added</th><th>CIK</th><th>Founded</th></tr>
<tr><td><a href="/wiki/3M">MMM</a></td><td>3M</td><td>Industrials</td><td>Industrial Conglomerates</td><td>Saint Paul, Minnesota</td><td>1957-03-04</td><td>0000066740</td><td>1902</td></tr>
<tr><td><a>AAPL</a></td><td>Apple Inc.</td><td>Information Technology</td><td>Technology Hardware, Storage &amp; Peripherals</td><td>Cupertino, California</td><td>1982-11-30</td><td>0000320193</td><td>1977</td></tr>
<tr><td>BRK.B</td><td>Berkshire Hathaway</td><td>Financials</td><td>Multi-Sector Holdings</td><td>Omaha</td><td>2010-02-16</td><td>0001067983</td><td>1839</td></tr>
</table>
<table class="wikitable"><tr><th>Old</th></tr><tr><td>x</td></tr></table>
</body></html>`;

/** NASDAQ-100: separate page, NO id, columns Ticker|Company|ICB Industry|ICB Subsector */
const NDX_HTML = `
<html><body>
<table class="wikitable sortable">
<tr><th>Ticker</th><th>Company</th><th>ICB Industry</th><th>ICB Subsector</th></tr>
<tr><td>ADBE</td><td>Adobe Inc.</td><td>Technology</td><td>Software</td></tr>
<tr><td>AAPL</td><td>Apple Inc.</td><td>Technology</td><td>Computer Hardware</td></tr>
</table>
</body></html>`;

/** Dow Jones: Symbol in the THIRD column — the case the parser is header-driven for */
const DOW_HTML = `
<html><body>
<table class="wikitable sortable">
<tr><th>Company</th><th>Exchange</th><th>Symbol</th><th>Sector</th><th>Date added</th><th>Notes</th></tr>
<tr><td>3M</td><td>NYSE</td><td>MMM</td><td>Industrials</td><td>1976-08-09</td><td>As Minnesota Mining and Manufacturing</td></tr>
<tr><td>Apple</td><td>NASDAQ</td><td>AAPL</td><td>Information Technology</td><td>2015-03-19</td><td></td></tr>
</table>
</body></html>`;

describe("parseWikiTables", () => {
  it("selects the table by id and reads headers + rows", () => {
    const tables = parseWikiTables(SP500_HTML, "constituents");
    expect(tables).toHaveLength(1);
    expect(tables[0].headers[0]).toBe("Symbol");
    expect(tables[0].headers).toContain("GICS Sub-Industry");
    expect(tables[0].rows).toHaveLength(3);
    expect(tables[0].rows[0][0]).toBe("MMM");
  });

  it("ignores tables without the id filter when an id is given", () => {
    // the second table in the fixture (no id) must not be selected
    const tables = parseWikiTables(SP500_HTML, "constituents");
    expect(tables.every((t) => t.headers.includes("Symbol"))).toBe(true);
  });

  it("without an id takes all flat tables with a header row", () => {
    const tables = parseWikiTables(SP500_HTML);
    expect(tables.length).toBe(2);
  });

  it("decodes entities and collapses whitespace in cells", () => {
    expect(cellText("Technology Hardware, Storage &amp; Peripherals")).toBe(
      "Technology Hardware, Storage & Peripherals"
    );
    expect(cellText("<a href='/x'>AAPL</a>&nbsp;")).toBe("AAPL");
  });
});

describe("projectColumns (header-driven mapping)", () => {
  it("S&P 500: ticker/name/sector/industry/cik from named columns", () => {
    const [table] = parseWikiTables(SP500_HTML, "constituents");
    const rows = projectColumns(table, {
      ticker: /^symbol$/i,
      name: /^security$/i,
      sector: /^gics\s+sector$/i,
      industry: /^gics\s+sub-?industry$/i,
      cik: /^cik$/i,
    });
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      ticker: "AAPL",
      name: "Apple Inc.",
      sector: "Information Technology",
      industry: "Technology Hardware, Storage & Peripherals",
      cik: "0000320193",
    });
  });

  it("NASDAQ-100: the column is Ticker (not Symbol), ICB instead of GICS", () => {
    const [table] = parseWikiTables(NDX_HTML);
    const rows = projectColumns(table, {
      ticker: /^ticker$/i,
      name: /^company$/i,
      sector: /^icb\s+industry/i,
      industry: /^icb\s+subsector/i,
      cik: /$^/, // no CIK column -> null, not a column shift
    });
    expect(rows[0]).toEqual({
      ticker: "ADBE",
      name: "Adobe Inc.",
      sector: "Technology",
      industry: "Software",
      cik: null,
    });
  });

  it("Dow: the ticker in the third column is found by header, not position", () => {
    const [table] = parseWikiTables(DOW_HTML);
    const rows = projectColumns(table, {
      ticker: /^symbol$/i,
      name: /^company$/i,
      sector: /^sector$/i,
    });
    expect(rows.map((r) => r.ticker)).toEqual(["MMM", "AAPL"]);
    expect(rows[0].sector).toBe("Industrials");
  });

  it("a missing column yields null in every row (fail-open per field)", () => {
    const [table] = parseWikiTables(DOW_HTML);
    const rows = projectColumns(table, { ticker: /^symbol$/i, industry: /^gics\s+sub-?industry$/i });
    expect(rows.every((r) => r.industry === null)).toBe(true);
  });
});
