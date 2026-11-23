import { describe, expect, it } from "vitest";
import { adjustedEpsFromExhibits, agreeOn, decideCompany, isAdjustedEpsLabel, rowKey, type AdjustedEpsReading, type StoredReading, type StoredRelease } from "./adjusted-eps";

const table = (rows: string[][], headers = ["September 26, 2026", "September 27, 2025"]) => `
  <p>Reconciliation of GAAP to non-GAAP results (in millions, except per share amounts)</p>
  <table>
    <tr><td></td><td colspan="2">Three Months Ended</td></tr>
    <tr><td></td>${headers.map((header) => `<td>${header}</td>`).join("")}</tr>
    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n")}
  </table>`;
const exhibit = (html: string, file = "000000000926000010.ex-ex991.htm") => ({ file, sha256: `sha-${file}-${html.length}`, html: `<html><body>${html}</body></html>` });

describe("which row is the adjusted per-share figure", () => {
  it("takes rows that name an adjusted per-share figure themselves", () => {
    for (const label of ["Adjusted diluted EPS", "Non-GAAP net income per diluted share", "Adjusted earnings per share (non-GAAP)", "Core earnings per share", "Diluted EPS excluding special items", "Operating income per diluted share", "Non-GAAP diluted earnings per share (1)"]) {
      expect(isAdjustedEpsLabel(label), label).toBe(true);
    }
  });

  it("leaves the GAAP line, the adjustments, growth rates, guidance and other per-share measures", () => {
    for (const label of ["Diluted EPS (GAAP)", "GAAP diluted earnings per share", "Diluted earnings per share", "Non-GAAP adjustments to net income per share", "Adjusted EPS growth", "Adjusted EPS guidance range", "Adjusted funds from operations (AFFO) per share", "Adjusted free cash flow per share", "Dividends per share", "Earnings per share as reported", "Adjusted net income"]) {
      expect(isAdjustedEpsLabel(label), label).toBe(false);
    }
  });

  it("takes an unmarked per-share row under an adjusted heading, not under a GAAP one", () => {
    expect(isAdjustedEpsLabel("Diluted earnings per share", ["Non-GAAP results"])).toBe(true);
    expect(isAdjustedEpsLabel("Diluted earnings per share", ["Adjusted"])).toBe(true);
    expect(isAdjustedEpsLabel("Diluted earnings per share", ["GAAP results"])).toBe(false);
    expect(isAdjustedEpsLabel("Diluted earnings per share", ["Adjusted", "As reported"])).toBe(false);
  });

  it("knows the same row from release to release whatever footnote mark it carries", () => {
    expect(rowKey("Adjusted Diluted Earnings per Share 1")).toBe("adjusted diluted earnings per share");
    expect(rowKey("Adjusted diluted earnings per share (3)")).toBe("adjusted diluted earnings per share");
    expect(rowKey("Earnings Excl. Identified Items Per Common Share (non-GAAP) ²")).toBe(rowKey("Earnings Excl. Identified Items Per Common Share (non-GAAP) 4"));
  });
});

describe("reading a release's tables", () => {
  const reconciliation = table([["Diluted EPS (GAAP)", "$ 1.85", "$ 1.60"], ["Amortization of intangibles per share", "0.10", "0.09"], ["Adjusted diluted EPS", "$ 1.95", "$ 1.69"]]);

  it("reads the adjusted row for the release's quarter and for the year-ago column", () => {
    const out = adjustedEpsFromExhibits([exhibit(reconciliation)], "2026-09-26");
    expect(out.readings.map((reading) => [reading.label, reading.months, reading.periodEnd, reading.value])).toEqual([
      ["Adjusted diluted EPS", 3, "2026-09-26", 1.95],
      ["Adjusted diluted EPS", 3, "2025-09-27", 1.69],
    ]);
    expect(out.quarter).toMatchObject({ value: 1.95, basis: "diluted", readings: 1, tables: 1, label: "Adjusted diluted EPS" });
    expect(out.year).toBeNull();
    expect(out.quarterNote).toBeNull();
  });

  it("counts the same exhibit once and finds nothing where no adjusted figure is printed", () => {
    const same = exhibit(reconciliation);
    expect(adjustedEpsFromExhibits([same, { ...same, file: "copy.htm" }], "2026-09-26").quarter).toMatchObject({ readings: 1 });
    const gaapOnly = table([["Diluted earnings per share", "$ 1.85", "$ 1.60"], ["Revenue", "500", "450"]]);
    expect(adjustedEpsFromExhibits([exhibit(gaapOnly)], "2026-09-26")).toMatchObject({ readings: [], quarter: null, quarterNote: null });
  });

  it("takes no figure when two diluted adjusted rows print different figures", () => {
    const two = table([["Adjusted diluted EPS", "$ 1.95", "$ 1.69"], ["Adjusted diluted EPS from continuing operations", "$ 2.10", "$ 1.80"]]);
    expect(adjustedEpsFromExhibits([exhibit(two)], "2026-09-26")).toMatchObject({ quarter: null, quarterNote: "ambiguous" });
  });
});

describe("settling the period by the table's GAAP line", () => {
  const QUARTER = { months: 3, periodEnd: "2026-09-26", gaap: [1.85] }, YEAR_AGO = { months: 3, periodEnd: "2025-09-27", gaap: [1.6, 0.8] };
  const plain = (rows: string[][]) => `<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>`;

  it("finds the column of each period where the GAAP row prints the known figure, whatever the headers say", () => {
    // four columns the header reader cannot tell apart: quarter, year-ago quarter, nine months, nine months a year ago
    const html = plain([["", "Q3", "Q3", "YTD", "YTD"], ["GAAP diluted earnings per share", "$", "1.85", "$", "1.60", "$", "5.10", "$", "4.40"], ["Restructuring", "0.10", "—", "0.25", "0.05"], ["Non-GAAP diluted earnings per share", "$", "1.95", "$", "1.69", "$", "5.35", "$", "4.45"]]);
    const out = adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.filter((reading) => reading.how === "gaap_column").map((reading) => [reading.periodEnd, reading.value])).toEqual([["2026-09-26", 1.95], ["2025-09-27", 1.69]]);
    expect(out.quarter).toMatchObject({ value: 1.95, basis: "diluted" });
  });

  it("takes the year-ago column on the release's share basis after a split", () => {
    // the year-ago quarter was filed as 1.60 and is printed as 0.80 after a two-for-one split: both are known
    const html = plain([["Diluted EPS (GAAP)", "1.85", "0.80"], ["Adjusted diluted EPS", "1.95", "0.85"]]);
    const out = adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.map((reading) => [reading.periodEnd, reading.value])).toEqual([["2026-09-26", 1.95], ["2025-09-27", 0.85]]);
  });

  it("reads a table turned the other way: measures as columns, reported and comparable as rows, a block per period", () => {
    const block = (period: string, gaap: string, comparable: string) => [
      [period], ["", "Operating income", "Net income", "Diluted net income per share"],
      ["Reported (GAAP)", "$", "4,465", "$", "4,009", "$", gaap], ["Items Impacting Comparability:"], ["Other Items", "(68)", "104", "0.02"], ["Comparable (Non-GAAP)", "$", "4,397", "$", "3,944", "$", comparable],
    ];
    const out = adjustedEpsFromExhibits([exhibit(plain([...block("Three Months Ended September 26, 2026", "1.85", "1.91"), ...block("Three Months Ended September 27, 2025", "1.60", "1.66")]))], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.map((reading) => [reading.how, reading.periodEnd, reading.value, reading.diluted])).toEqual([["gaap_block", "2026-09-26", 1.91, true], ["gaap_block", "2025-09-27", 1.66, true]]);
    expect(out.quarter).toMatchObject({ value: 1.91, label: "Comparable (Non-GAAP) · Diluted net income per share" });
  });

  it("reads a per-share row that carries reported, adjustments and adjusted side by side, when they add up", () => {
    const html = (adjusted: string) => plain([["", "As reported (GAAP)", "Specified items", "As adjusted"], ["Net earnings", "3,200", "170", "3,370"], ["Diluted earnings per common share", "$", "1.85", "$", "0.10", "$", adjusted]]);
    const out = adjustedEpsFromExhibits([exhibit(html("1.95"))], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.map((reading) => [reading.how, reading.periodEnd, reading.value])).toEqual([["gaap_row", "2026-09-26", 1.95]]);
    // reported plus the adjustments must give the adjusted figure
    expect(adjustedEpsFromExhibits([exhibit(html("2.40"))], "2026-09-26", [QUARTER, YEAR_AGO]).readings).toEqual([]);
  });

  it("reads nothing from a GAAP line that prints no known figure", () => {
    const html = plain([["GAAP diluted earnings per share", "9.99", "8.88"], ["Non-GAAP diluted earnings per share", "1.95", "1.69"]]);
    expect(adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", [QUARTER, YEAR_AGO]).readings).toEqual([]);
  });
});

describe("the figure the readings agree on", () => {
  const reading = (value: number, over: Partial<AdjustedEpsReading> = {}): AdjustedEpsReading => ({ file: "a.htm", tableIndex: 1, rowIndex: 5, label: "Adjusted EPS", heading: null, diluted: false, basic: false, months: 3, periodEnd: "2026-09-26", value, raw: String(value), ...over });

  it("lets rows labelled diluted decide, then unlabelled rows, then basic ones", () => {
    expect(agreeOn([reading(1.9), reading(1.95, { diluted: true, tableIndex: 2 }), reading(1.95, { diluted: true, tableIndex: 4 })]).figure).toMatchObject({ value: 1.95, basis: "diluted", readings: 2, tables: 2 });
    expect(agreeOn([reading(1.9), reading(1.97, { basic: true })]).figure).toMatchObject({ value: 1.9, basis: "unlabelled" });
    expect(agreeOn([reading(1.97, { basic: true })]).figure).toMatchObject({ value: 1.97, basis: "basic" });
    expect(agreeOn([])).toEqual({ figure: null, note: null });
  });

  it("decides nothing when the deciding rank disagrees with itself", () => {
    expect(agreeOn([reading(1.95, { diluted: true }), reading(2.1, { diluted: true }), reading(1.95)])).toEqual({ figure: null, note: "ambiguous" });
  });
});

describe("deciding a company's figures release by release", () => {
  const row = (periodEnd: string, value: number, over: Partial<StoredReading> = {}): StoredReading => ({ months: 3, periodEnd, value, diluted: true, basic: false, label: "Adjusted diluted EPS", file: "x.htm", tableIndex: 3, rowIndex: 9, ...over });
  const ENDS = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  /** One release per quarter; each prints its own quarter and the quarter a year before. */
  const company = (figures: number[], printedYearAgo: (index: number, original: number) => number = (_, original) => original, extra: (index: number) => StoredReading[] = () => []): StoredRelease[] =>
    ENDS.map((end, index) => ({
      accession: `a${index}`, acceptedEt: `${end.slice(0, 4)}-${String(Number(end.slice(5, 7)) + 1).padStart(2, "0").replace("13", "12")}-28T16:05:00`, fiscalPeriodEnd: end,
      readings: [row(end, figures[index]), ...(index >= 4 ? [row(ENDS[index - 4], printedYearAgo(index, figures[index - 4]))] : []), ...extra(index)],
    }));
  const FIGURES = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8];

  it("confirms a figure that a later release prints again, and trusts that row for the quarters not printed again yet", () => {
    const out = decideCompany(company(FIGURES));
    expect(out.map((release) => release.quarter?.grade)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed", "confirmed", "same_row", "same_row", "same_row", "same_row"]);
    expect(out[0].quarter).toMatchObject({ value: 1, label: "Adjusted diluted EPS", laterValues: [1] });
    expect(out[8].quarter).toMatchObject({ value: 1.8, laterValues: [] });
  });

  it("puts a later release's figure back on the earlier share basis across a split", () => {
    // two-for-one in January 2025: the releases after it print the year-ago quarters at half
    const out = decideCompany(company(FIGURES, (_, original) => original / 2), [{ date: "2025-01-15", ratio: 2 }]);
    expect(out.slice(0, 4).map((release) => release.quarter?.grade)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"]);
    // without the split the same figures would count as restated
    expect(decideCompany(company(FIGURES, (_, original) => original / 2))[0].quarter?.grade).toBe("restated");
  });

  it("marks a figure the company later printed differently, and does not use a row whose figures are not borne out", () => {
    const out = decideCompany(company(FIGURES, (index, original) => (index === 6 ? original + 0.2 : original)));
    expect(out[2].quarter).toMatchObject({ value: 1.2, grade: "restated", laterValues: [1.4] });
    expect(out[0].quarter?.grade).toBe("confirmed");
    // a row that later releases never repeat (a year-to-date figure taken for the quarter) earns no trust
    const misread = decideCompany(company(FIGURES, (_, original) => original * 2));
    expect(misread.map((release) => release.quarter?.grade)).toEqual(["restated", "restated", "restated", "restated", "restated", "unchecked", "unchecked", "unchecked", "unchecked"]);
  });

  it("reads the trusted row when a release prints a second adjusted measure beside it", () => {
    const out = decideCompany(company(FIGURES, undefined, (index) => [row(ENDS[index], FIGURES[index] + 0.5, { label: "Adjusted diluted EPS excluding the divested business", rowIndex: 12 })]));
    expect(out[8].quarter).toMatchObject({ value: 1.8, grade: "same_row", label: "Adjusted diluted EPS" });
    expect(out[8].quarterNote).toBeNull();
  });

  it("decides the fiscal year from the twelve-month column and returns nothing for a release without rows", () => {
    const releases = company(FIGURES);
    releases[3].readings.push(row("2024-12-31", 4.6, { months: 12 }));
    releases[7].readings.push(row("2025-12-31", 6.2, { months: 12 }), row("2024-12-31", 4.6, { months: 12 }));
    releases[8].readings = [];
    const out = decideCompany(releases);
    expect(out[3].year).toMatchObject({ value: 4.6, grade: "confirmed" });
    expect(out[7].year).toMatchObject({ value: 6.2, grade: "same_row" });
    expect(out[8]).toMatchObject({ quarter: null, year: null, quarterNote: null });
  });
});
