import { describe, expect, it } from "vitest";
import { canonicalLabel, durationMonths, extractCandidateRows, findStatementCandidates, fullDates, joinStatementCandidates, parseExhibitHtml, parsePrintedNumber, rowUnit, type RawTable } from "./flash-html";

const firstCandidate = (html: string, periodEnd: string) => joinStatementCandidates(findStatementCandidates(parseExhibitHtml(html, "fixture.htm", "fixture"), periodEnd))[0];

describe("flash HTML table reading", () => {
  it("expands spans, preserves negative numbers and strips label footnotes", () => {
    const html = `<p>Consolidated Statements of Operations (In millions, except per share data and shares in thousands)</p><table>
      <tr><td colspan="2"></td><td colspan="2">Three Months Ended</td></tr>
      <tr><td colspan="2"></td><td>September 26,2026</td><td>September 27,2025</td></tr>
      <tr><td colspan="2">Total net sales (1)</td><td>$</td><td>114,477</td><td>$</td><td>102,466</td></tr>
      <tr><td colspan="2">Net loss</td><td>(551)</td><td>(116)</td></tr>
      <tr><td colspan="2">Payments for acquisition of property, plant and equipment</td><td>(208)</td><td>(5,982)</td></tr>
      <tr><td colspan="2">Diluted loss per share</td><td>($0.26)</td><td>($1.04)</td></tr>
    </table>`;
    const candidate = firstCandidate(html, "2026-09-26");
    const rows = extractCandidateRows(candidate);
    expect(candidate.kind).toBe("income");
    expect(candidate.tables[0].unitMultiplier).toBe(1e6);
    expect(candidate.tables[0].shareMultiplier).toBe(1e3);
    expect(rows.find((row) => row.label === "Total net sales")?.values.map((value) => value.value)).toEqual([114477, 102466]);
    expect(rows.find((row) => row.label === "Net loss")?.values.map((value) => value.value)).toEqual([-551, -116]);
    expect(rows.find((row) => row.label.startsWith("Payments for"))?.values.map((value) => value.value)).toEqual([-208, -5982]);
    expect(rows.find((row) => row.label === "Diluted loss per share")?.values.map((value) => value.value)).toEqual([-0.26, -1.04]);
    expect(canonicalLabel("Total shareholders’ equity (a)")).toBe("total shareholders' equity");
    expect(parsePrintedNumber("(208)")?.value).toBe(-208);
    expect(fullDates("September 26,2026")).toEqual(["2026-09-26"]);
    expect(fullDates("05/31/2009")).toEqual(["2009-05-31"]);
    expect(durationMonths("Nine months ended September 30")).toBe(9);
    expect(durationMonths("YEAR TO DATE ENDED", "REPORTS FISCAL 2009 FOURTH QUARTER")).toBe(12);
    expect(durationMonths("YEAR TO DATE ENDED", "REPORTS THIRD QUARTER")).toBe(9);
  });

  it("combines split month/year rows and removes percent-change columns", () => {
    const html = `<p>Condensed Consolidated Statements of Income (Amounts in millions)</p><table>
      <tr><td></td><td>Three Months Ended</td><td>Three Months Ended</td><td>Three Months Ended</td><td>Six Months Ended</td><td>Six Months Ended</td><td>Six Months Ended</td></tr>
      <tr><td></td><td>July 31,</td><td>July 31,</td><td>July 31,</td><td>July 31,</td><td>July 31,</td><td>July 31,</td></tr>
      <tr><td></td><td>2026</td><td>2025</td><td colspan="2">Percent Change</td><td>2026</td><td>2025</td><td colspan="2">Percent Change</td></tr>
      <tr><td>Net sales</td><td>186100</td><td>175750</td><td>5.9</td><td>%</td><td>361784</td><td>339731</td><td>6.5</td><td>%</td></tr>
    </table>`;
    const candidate = firstCandidate(html, "2026-07-31");
    const rows = extractCandidateRows(candidate);
    expect(candidate.columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2026-07-31"], [3, "2025-07-31"], [6, "2026-07-31"], [6, "2025-07-31"]]);
    expect(rows[0].values.map((value) => value.value)).toEqual([186100, 175750, 361784, 339731]);
    expect(rows[0].alignable).toBe(true);
  });

  it("keeps five quarters and nine-month columns in printed order", () => {
    const html = `<p>CONSOLIDATED STATEMENTS OF INCOME (in millions, except per share data)</p><table>
      <tr><td></td><td>3Q26</td><td>2Q26</td><td>1Q26</td><td>4Q25</td><td>3Q25</td><td colspan="2">3Q26 Change</td><td>Nine Months Ended September 30</td><td>Nine Months Ended September 30</td><td colspan="2">2026 Change</td></tr>
      <tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>2026</td><td>2025</td><td></td></tr>
      <tr><td>TOTAL NET REVENUE</td><td>50172</td><td>57347</td><td>49836</td><td>45798</td><td>46427</td><td>8</td><td>%</td><td>157355</td><td>136649</td><td>15</td><td>%</td></tr>
    </table>`;
    const candidate = firstCandidate(html, "2026-09-30");
    const rows = extractCandidateRows(candidate);
    expect(candidate.columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2026-09-30"], [3, "2026-06-30"], [3, "2026-03-31"], [3, "2025-12-31"], [3, "2025-09-30"], [9, "2026-09-30"], [9, "2025-09-30"]]);
    expect(rows[0].alignable).toBe(true);
    expect(rows[0].values.map((value) => value.value)).toEqual([50172, 57347, 49836, 45798, 46427, 157355, 136649]);
  });

  it("joins cash-flow continuation tables without inheriting their header row positions", () => {
    const html = `<p>CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS (In millions)</p><table>
      <tr><td></td><td>Three Months Ended July 26, 2026</td><td>Three Months Ended July 27, 2025</td></tr>
      <tr><td>Net cash provided by operating activities</td><td>24077</td><td>15365</td></tr>
    </table><table><tr><td>Financing activities</td><td></td><td></td></tr><tr><td>Purchases of property and equipment</td><td>(208)</td><td>(203)</td></tr></table>`;
    const candidates = joinStatementCandidates(findStatementCandidates(parseExhibitHtml(html, "fixture.htm", "fixture"), "2026-07-26"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tables).toHaveLength(2);
    const rows = extractCandidateRows(candidates[0]);
    expect(rows.find((row) => row.label === "Purchases of property and equipment")?.values.map((value) => value.value)).toEqual([-208, -203]);
  });

  it("joins a data table without repeated headers to its statement", () => {
    const html = `<p>INCOME STATEMENT</p><table><tr><td></td><td>QUARTER ENDED</td></tr><tr><td></td><td>05/31/2009</td><td>05/31/2008</td></tr></table><table><tr><td>Revenue</td><td>100</td><td>90</td></tr><tr><td>Operating income</td><td>20</td><td>18</td></tr></table>`;
    const candidates = joinStatementCandidates(findStatementCandidates(parseExhibitHtml(html, "fixture.htm", "fixture"), "2009-05-31"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tables).toHaveLength(2);
    const rows = extractCandidateRows(candidates[0]);
    expect(rows.find((row) => row.label === "Revenue")?.values.map((value) => value.value)).toEqual([100, 90]);
  });

  it("resolves ordinal quarters, YTD columns and week-based durations", () => {
    const cop = `<p>ConocoPhillips Reports First-Quarter Earnings</p><table><tr><td></td><td>2009</td></tr><tr><td></td><td>1st Qtr</td><td>YTD</td></tr><tr><td>Revenue</td><td>100</td><td>90</td></tr><tr><td>Operating income</td><td>20</td><td>18</td></tr></table>`;
    const candidate = firstCandidate(cop, "2009-03-31");
    expect(candidate.columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2009-03-31"], [3, "2009-03-31"]]);
    expect(extractCandidateRows(candidate)[0].values.map((value) => value.value)).toEqual([100, 90]);
    const micron = `<p>MICRON TECHNOLOGY, INC. | CONSOLIDATED FINANCIAL SUMMARY</p><table><tr><td></td><td>1st Qtr.</td><td>4th Qtr.</td><td>1st Qtr.</td></tr><tr><td></td><td>Dec. 3,</td><td>Sep. 3,</td><td>Dec. 4,</td></tr><tr><td></td><td>2009</td><td>2009</td><td>2008</td></tr><tr><td>Net sales</td><td>1740</td><td>1302</td><td>1402</td></tr><tr><td>Operating income</td><td>100</td><td>90</td><td>80</td></tr></table>`;
    expect(firstCandidate(micron, "2009-12-03").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2009-12-03"], [3, "2009-09-03"], [3, "2008-12-04"]]);
    const cof = `<p>Consolidated Statements of Income</p><table><tr><td></td><td>2018</td><td>2017</td></tr><tr><td></td><td>Q1</td><td>Q4</td></tr><tr><td>Revenue</td><td>100</td><td>90</td></tr><tr><td>Operating income</td><td>20</td><td>18</td></tr></table>`;
    expect(firstCandidate(cof, "2018-03-31").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2018-03-31"], [3, "2017-12-31"]]);
    const costco = `<p>CONDENSED CONSOLIDATED STATEMENTS OF INCOME</p><table><tr><td></td><td colspan="2">12 Weeks Ended</td></tr><tr><td></td><td>November 20, 2022</td><td>November 21, 2021</td></tr><tr><td>Net sales</td><td>53437</td><td>49417</td></tr><tr><td>Operating income</td><td>1000</td><td>900</td></tr></table>`;
    expect(firstCandidate(costco, "2022-11-20").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2022-11-20"], [3, "2021-11-21"]]);
    expect(durationMonths("Thirteen Weeks")).toBe(3);
    expect(durationMonths("Fifty-Two Weeks")).toBe(12);
    expect(durationMonths("Thirty-Nine Weeks")).toBe(9);
  });

  it("combines split duration headers without mixing column months", () => {
    const html = `<p>Consolidated Statements of Operations</p><table><tr><td></td><td>Thirteen</td><td>Thirteen</td><td>Thirty-Nine</td><td>Thirty-Nine</td></tr><tr><td></td><td>Weeks Ended</td><td>Weeks Ended</td><td>Weeks Ended</td><td>Weeks Ended</td></tr><tr><td></td><td>November 1,</td><td>November 2,</td><td>November 1,</td><td>November 2,</td></tr><tr><td></td><td>2009</td><td>2008</td><td>2009</td><td>2008</td></tr><tr><td>Net revenue</td><td>112891</td><td>87047</td><td>292292</td><td>249565</td></tr><tr><td>Operating income</td><td>10000</td><td>9000</td><td>20000</td><td>18000</td></tr></table>`;
    const candidate = firstCandidate(html, "2009-11-01");
    expect(candidate.columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2009-11-01"], [3, "2008-11-02"], [9, "2009-11-01"], [9, "2008-11-02"]]);
    expect(durationMonths("Fourth-Quarter")).toBe(3);
    expect(durationMonths("Full-Year")).toBe(12);
    expect(durationMonths("Quarters Ended")).toBe(3);
  });

  it("distinguishes per-share values from share counts and fails closed on missing cells", () => {
    const table: RawTable = { sourceFile: "fixture", sourceSha256: "fixture", tableIndex: 0, grid: [], context: "", title: "", unitMultiplier: 1e6, shareMultiplier: 1e3 };
    const base = { headingPath: [], footnotes: [], sourceFile: "fixture", sourceSha256: "fixture", tableIndex: 0, rowIndex: 0, alignable: true, kind: "data" as const };
    const eps = { ...base, label: "Diluted", headingPath: ["Earnings per share"], values: [] };
    const shares = { ...base, label: "Diluted", headingPath: ["Shares used in computing earnings per share"], values: [] };
    expect(rowUnit(eps, table)).toMatchObject({ multiplier: 1, perShare: true, shares: false });
    expect(rowUnit(shares, table)).toMatchObject({ multiplier: 1e3, perShare: false, shares: true });
    const candidate = firstCandidate(`<p>Consolidated Statements of Income (In millions)</p><table><tr><td></td><td>September 26, 2026</td><td>September 27, 2025</td></tr><tr><td>Revenue</td><td>100</td><td>90</td><td>Operating income</td><td>10</td></tr></table>`, "2026-09-26");
    expect(extractCandidateRows(candidate)[0].alignable).toBe(false);
  });

  it("anchors fiscal-year labels and recognizes extended fiscal weeks", () => {
    const johnson = `<p>Condensed Consolidated Statement of Earnings</p><table><tr><td></td><td colspan="2">FOURTH QUARTER</td><td colspan="2">TWELVE MONTHS</td></tr><tr><td></td><td>2020</td><td>2019</td><td>2020</td><td>2019</td><td>Percent</td></tr><tr><td>Sales to customers</td><td>22475</td><td>20747</td><td>82059</td><td>82116</td></tr><tr><td>Net earnings</td><td>2000</td><td>1800</td><td>14000</td><td>15000</td></tr></table>`;
    expect(firstCandidate(johnson, "2021-01-03").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2021-01-03"], [3, "2020-01-05"], [12, "2021-01-03"], [12, "2020-01-05"]]);
    const lululemon = `<p>Condensed Consolidated Statements of Operations</p><table><tr><td></td><td colspan="2">Fourth Quarter</td><td colspan="2">Fiscal Year</td></tr><tr><td></td><td>2025</td><td>2024</td><td>2025</td><td>2024</td></tr><tr><td>Net revenue</td><td>3640801</td><td>3611497</td><td>11102600</td><td>10588126</td></tr><tr><td>Operating income</td><td>1000</td><td>900</td><td>2500</td><td>2200</td></tr></table>`;
    expect(firstCandidate(lululemon, "2026-02-01").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2026-02-01"], [3, "2025-02-02"], [12, "2026-02-01"], [12, "2025-02-02"]]);
    const costco = `<p>CONSOLIDATED STATEMENTS OF INCOME</p><table><tr><td></td><td>17 Weeks Ended</td><td>16 Weeks Ended</td><td>53 Weeks Ended</td><td>52 Weeks Ended</td></tr><tr><td></td><td>September 3, 2023</td><td>August 28, 2022</td><td>September 3, 2023</td><td>August 28, 2022</td></tr><tr><td>Net sales</td><td>50000</td><td>45000</td><td>240000</td><td>220000</td></tr><tr><td>Operating income</td><td>2000</td><td>1800</td><td>8000</td><td>7500</td></tr></table>`;
    expect(firstCandidate(costco, "2023-09-03").columns.map((column) => [column.months, column.periodEnd])).toEqual([[4, "2023-09-03"], [4, "2022-08-28"], [12, "2023-09-03"], [12, "2022-08-28"]]);
    const nvidia = `<table><tr><td>GAAP Annual Financial Comparison</td></tr><tr><td>(in millions except per share data)</td><td>FY13</td><td>FY12</td></tr><tr><td>Revenue</td><td>4000</td><td>3500</td></tr><tr><td>Operating income</td><td>500</td><td>450</td></tr><tr><td>Net income</td><td>600</td><td>550</td></tr></table>`;
    expect(firstCandidate(nvidia, "2013-01-27").columns.map((column) => [column.months, column.periodEnd])).toEqual([[12, "2013-01-27"], [12, "2012-01-29"]]);
  });

  it("reads year rows beside change labels and ordinal headers with full dates", () => {
    const pfizer = `<p>Consolidated Statements of Operations</p><table><tr><td></td><td colspan="2">Third-Quarter</td><td>% Incr. /</td></tr><tr><td></td><td>2026</td><td>2025</td><td>(Decr.)</td></tr><tr><td>Total revenues</td><td>16583</td><td>16654</td><td>0</td></tr><tr><td>Operating income</td><td>4000</td><td>3900</td><td>3</td></tr></table>`;
    expect(firstCandidate(pfizer, "2026-09-27").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2026-09-27"], [3, "2025-09-28"]]);
    const att = `<p>Consolidated Statements of Income</p><table><tr><td>Unaudited</td><td colspan="2">First Quarter</td><td>Percent</td></tr><tr><td></td><td>2026</td><td>2025</td><td>Change</td></tr><tr><td>Total Operating Revenues</td><td>31506</td><td>30626</td><td>2.9</td></tr><tr><td>Operating income</td><td>6000</td><td>5500</td><td>9</td></tr></table>`;
    expect(firstCandidate(att, "2026-03-31").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2026-03-31"], [3, "2025-03-31"]]);
    const micron = `<p>CONSOLIDATED STATEMENTS OF OPERATIONS</p><table><tr><td></td><td>1st Qtr.</td><td>4th Qtr.</td><td>1st Qtr.</td></tr><tr><td></td><td>November 27, 2025</td><td>August 28, 2025</td><td>November 28, 2024</td></tr><tr><td>Revenue</td><td>13643</td><td>11315</td><td>8709</td></tr><tr><td>Operating income</td><td>6136</td><td>3654</td><td>2174</td></tr></table>`;
    expect(firstCandidate(micron, "2025-11-27").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2025-11-27"], [3, "2025-08-28"], [3, "2024-11-28"]]);
    const cof = `<p>Income Statement</p><table><tr><td></td><td>2026 Q1</td></tr><tr><td>(Dollars in millions)</td><td></td><td>2026</td><td></td><td>2025</td></tr><tr><td></td><td>Q1</td><td></td><td>Q4</td><td></td></tr><tr><td>Revenue</td><td>100</td><td></td><td>90</td><td></td></tr><tr><td>Operating income</td><td>20</td><td></td><td>18</td><td></td></tr></table>`;
    expect(firstCandidate(cof, "2026-03-31").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2026-03-31"], [3, "2025-12-31"]]);
    const johnson = `<p>Condensed Consolidated Statement of Earnings</p><table><tr><td></td><td colspan="2">FIRST QUARTER</td><td>Percent</td></tr><tr></tr><tr><td></td><td>2018</td><td>2017*</td><td>Percent</td></tr><tr><td>Sales to customers</td><td>20009</td><td>17766</td><td>12.6</td></tr><tr><td>Net earnings</td><td>2000</td><td>1800</td><td>11</td></tr></table>`;
    expect(firstCandidate(johnson, "2018-04-01").columns.map((column) => [column.months, column.periodEnd])).toEqual([[3, "2018-04-01"], [3, "2017-04-02"]]);
  });

  it("rejects non-GAAP and highlights tables as statement candidates", () => {
    const html = `<p>GAAP to non-GAAP reconciliation</p><table><tr><td></td><td>September 26, 2026</td></tr><tr><td>Revenue</td><td>100</td><td>Operating income</td><td>20</td></tr></table><p>Condensed Consolidated Balance Sheets (In millions)</p><table><tr><td></td><td>September 26, 2026</td></tr><tr><td>Total assets</td><td>100</td><td>Total liabilities</td><td>60</td><td>Total shareholders’ equity</td><td>40</td></tr></table>`;
    const candidates = joinStatementCandidates(findStatementCandidates(parseExhibitHtml(html, "fixture.htm", "fixture"), "2026-09-26"));
    expect(candidates.map((candidate) => candidate.kind)).toEqual(["balance"]);
  });
});
