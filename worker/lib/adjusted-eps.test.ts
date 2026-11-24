import { describe, expect, it } from "vitest";
import { adjustedEpsFromExhibits, agreeOn, decideCompany, isAdjustedEpsLabel, rowKey, statedAdjustedFigures, type AdjustedEpsReading, type StoredReading, type StoredRelease } from "./adjusted-eps";

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

  it("leaves a part of the reconciliation that names an adjusted per-share figure", () => {
    expect(isAdjustedEpsLabel("Less: Adjusted earnings (loss) per share attributable to trivago")).toBe(false);
    expect(isAdjustedEpsLabel("Add: adjusted EPS of the acquired business")).toBe(false);
    expect(isAdjustedEpsLabel("Adjusted earnings per share excluding trivago")).toBe(true);
  });

  it("takes no non-operating or non-core item, and no constant-currency or pre-tax variant, for the adjusted figure", () => {
    for (const label of ["Non-operating pension costs per diluted share, before tax", "Non-core business results per diluted share", "Adjusted EPS @ Constant FX (Non-GAAP)", "Adjusted Diluted EPS, excluding Currency", "Core Constant Currency Diluted EPS", "Restructuring charge per share (pre-tax)"]) {
      expect(isAdjustedEpsLabel(label), label).toBe(false);
    }
    for (const label of ["Diluted earnings per share, excluding non-operating items", "Non-GAAP operating earnings per diluted share", "Non-GAAP diluted EPS"]) expect(isAdjustedEpsLabel(label), label).toBe(true);
  });

  it("lists the adjusted per-share figures the running text states in the order it states them, not table rows, rates or amounts", () => {
    expect(statedAdjustedFigures([
      "Adjusted EPS attributable to Kimberly-Clark were $1.92, down 2.0 percent versus prior year.",
      "Adjusted diluted EPS | 1.92 | 1.96",
      "Revenue of $1.23 billion and an adjusted operating margin of 15.25%, with non-GAAP EPS growth expected.",
      "GAAP EPS was $1.53.",
      "The company reported an adjusted net loss of $(0.28) per share for the quarter, compared with a GAAP loss.",
    ])).toEqual([192, 28]);
  });

  it("reads a sentence a line break cut in two, and takes no figure from a table split into paragraphs", () => {
    expect(statedAdjustedFigures([
      // Regeneron 2012, Charles River 2013
      "The Company reported non-GAAP net income of $171 million, or $1.47 per diluted",
      "share, in the fourth quarter, compared to a net loss a year ago.",
      "First-Quarter GAAP Earnings per Share of $0.53 and Non-GAAP Earnings per",
      "Share of $0.69",
      // Norfolk Southern 2025: the quarter's reconciliation, then the year-ago quarter's, a cell to a paragraph
      "Adjusted diluted earnings per share", "$", "3.30", "($ in millions except per share amounts)", "Third", "Quarter 2024",
      "Adjusted diluted earnings per share", "$", "3.25",
    ])).toEqual([147, 53, 69]);
  });

  it("takes an adjusted column in reported currency for adjusted, not for the GAAP line", () => {
    // Ralph Lauren: "As Adjusted (Reported $)" beside "As Adjusted (Constant $)"
    expect(isAdjustedEpsLabel("Net income per diluted common share · As Adjusted (Reported $)")).toBe(true);
    expect(isAdjustedEpsLabel("Net income per diluted common share · As Reported")).toBe(false);
    expect(isAdjustedEpsLabel("Net income per diluted common share · As Adjusted (Constant $)")).toBe(false);
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

  it("takes no footnote mark printed in a cell of its own after a row's last figure for the figure", () => {
    // Cencora: "Adjusted Non-GAAP ... $ 3.73 | 2", read as 2.00 since a2
    const block = (period: string, gaap: string, adjusted: string, mark: string) => [
      [period], ["", "Operating income", "Net income", "Diluted Earnings Per Share"],
      ["GAAP", "$", "4,465", "$", "4,009", "$", gaap], ["Restructuring and other expenses", "68", "45", "0.06"], ["Adjusted Non-GAAP", "$", "4,397", "$", "3,944", "$", adjusted, mark],
    ];
    const out = adjustedEpsFromExhibits([exhibit(plain([...block("Three Months Ended September 26, 2026", "1.85", "1.91", "2"), ...block("Three Months Ended September 27, 2025", "1.60", "1.66", "3")]))], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.filter((reading) => reading.how === "gaap_block").map((reading) => [reading.periodEnd, reading.value])).toEqual([["2026-09-26", 1.91], ["2025-09-27", 1.66]]);
  });

  it("reads a per-share row that carries reported, adjustments and adjusted side by side, when they add up", () => {
    const html = (adjusted: string) => plain([["", "As reported (GAAP)", "Specified items", "As adjusted"], ["Net earnings", "3,200", "170", "3,370"], ["Diluted earnings per common share", "$", "1.85", "$", "0.10", "$", adjusted]]);
    const out = adjustedEpsFromExhibits([exhibit(html("1.95"))], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.map((reading) => [reading.how, reading.periodEnd, reading.value])).toEqual([["gaap_row", "2026-09-26", 1.95]]);
    // reported plus the adjustments must give the adjusted figure
    expect(adjustedEpsFromExhibits([exhibit(html("2.40"))], "2026-09-26", [QUARTER, YEAR_AGO]).readings).toEqual([]);
  });

  it("reads rows named only GAAP and Non-GAAP under a per-share heading", () => {
    const html = plain([["Diluted net income per share"], ["GAAP", "$", "1.85", "$", "2.10", "$", "1.60"], ["Non-GAAP", "$", "1.95", "$", "2.20", "$", "1.69"], ["Weighted average shares", "2,400", "2,410", "2,450"]]);
    const out = adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.map((reading) => [reading.how, reading.label, reading.periodEnd, reading.value, reading.diluted])).toEqual([
      ["gaap_column", "Diluted net income per share · Non-GAAP", "2026-09-26", 1.95, true],
      ["gaap_column", "Diluted net income per share · Non-GAAP", "2025-09-27", 1.69, true],
    ]);
  });

  it("reads a row whose first half is GAAP and second half adjusted, by the headers or by a name inside the row", () => {
    const halves = plain([["", "GAAP", "Non-GAAP"], ["Earnings per common share - diluted", "$", "1.85", "$", "1.60", "+$0.25", "$", "1.95", "$", "1.69", "+$0.26"]]);
    expect(adjustedEpsFromExhibits([exhibit(halves)], "2026-09-26", [QUARTER, YEAR_AGO]).readings.map((reading) => [reading.how, reading.periodEnd, reading.value])).toEqual([["gaap_row", "2026-09-26", 1.95], ["gaap_row", "2025-09-27", 1.69]]);
    const named = plain([["Diluted EPS", "$1.85", "$1.60", "16%", "Core EPS", "$1.95", "$1.69", "+15%"]]);
    const out = adjustedEpsFromExhibits([exhibit(named)], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.map((reading) => [reading.label, reading.periodEnd, reading.value])).toEqual([["Diluted EPS · Core EPS", "2026-09-26", 1.95], ["Diluted EPS · Core EPS", "2025-09-27", 1.69]]);
  });

  it("reads a row that prints GAAP and adjusted in turn", () => {
    const html = plain([["", "GAAP", "Non-GAAP", "GAAP", "Non-GAAP"], ["DILUTED EARNINGS PER SHARE", "$", "1.85", "$", "1.95", "$", "1.60", "$", "1.69"]]);
    expect(adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", [QUARTER, YEAR_AGO]).readings.map((reading) => [reading.how, reading.periodEnd, reading.value])).toEqual([["gaap_row", "2026-09-26", 1.95], ["gaap_row", "2025-09-27", 1.69]]);
  });

  it("reads twin tables headed GAAP and Non-GAAP by the column of the GAAP table", () => {
    const one = (title: string, eps: string[]) => plain([[title], ["($ in millions, except earnings per share)", "Q3 FY26", "Q2 FY26", "Q3 FY25"], ["Revenue", "500", "480", "450"], ["Diluted earnings per share", ...eps]]);
    const out = adjustedEpsFromExhibits([exhibit(one("GAAP", ["$1.85", "$2.10", "$1.60"]) + one("Non-GAAP", ["$1.95", "$2.20", "$1.69"]))], "2026-09-26", [QUARTER, YEAR_AGO]);
    expect(out.readings.filter((reading) => reading.how === "gaap_table").map((reading) => [reading.periodEnd, reading.value])).toEqual([["2026-09-26", 1.95], ["2025-09-27", 1.69]]);
  });

  it("reads nothing from a GAAP line that prints no known figure", () => {
    const html = plain([["GAAP diluted earnings per share", "9.99", "8.88"], ["Non-GAAP diluted earnings per share", "1.95", "1.69"]]);
    expect(adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", [QUARTER, YEAR_AGO]).readings).toEqual([]);
  });

  // the cases below are layouts the full read of a3 misread (CMS, CF, Union Pacific, Dominion, Sempra, TE
  // Connectivity, Lululemon, Kimberly-Clark); the anchored readings must take the adjusted figure or nothing
  const anchored = (html: string, anchors = [QUARTER, YEAR_AGO]) => adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", anchors).readings.filter((reading) => reading.how !== "period_header").map((reading) => [reading.how, reading.periodEnd, reading.value]);

  it("takes no caption of units for a per-share heading, and no other measure named by its basis", () => {
    // an income statement: "Operating Income" and "Adjusted EBITDA" in millions under the units caption
    const statement = plain([["In Millions, Except Per Share Amounts"], ["Operating Income", "379", "280", "1,338", "1,256"], ["Adjusted EBITDA", "342", "708", "642", "1,178"], ["Diluted earnings per share", "1.85", "1.60", "5.10", "4.40"]]);
    expect(anchored(statement)).toEqual([]);
    // an operating ratio under a heading that names shares and per-share figures
    const ratio = plain([["Share and Per Share"], ["Diluted earnings per share", "1.85", "1.60"], ["Operating Ratio", "60.1", "61.3"]]);
    expect(anchored(ratio)).toEqual([]);
  });

  it("takes no amount for a per-share figure", () => {
    expect(anchored(plain([["Diluted EPS (GAAP)", "1.85", "1.60"], ["Adjusted diluted EPS", "379", "280"]]))).toEqual([]);
  });

  it("pairs a GAAP row only with the adjusted rows of its own period block", () => {
    const html = plain([
      ["", "Three months ended September 30,"], ["Earnings Per Share (EPS):"],
      ["OPERATING EARNINGS", "$1.95", "$1.69", "$0.26"], ["Items excluded from operating earnings", "(0.10)", "(0.09)", "(0.01)"], ["REPORTED EARNINGS", "$1.85", "$1.60", "$0.25"],
      ["", "Nine months ended September 30,"], ["Earnings Per Share (EPS):"],
      ["OPERATING EARNINGS", "$5.35", "$4.45", "$0.90"], ["Items excluded from operating earnings", "(0.25)", "(0.05)", "(0.20)"], ["REPORTED EARNINGS", "$5.10", "$4.40", "$0.70"],
    ]);
    expect(anchored(html)).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
  });

  it("reads reported, adjustments and adjusted side by side, never as GAAP and adjusted halves", () => {
    // the header names GAAP and Non-GAAP with the adjustments between them
    const charges = plain([["", "U.S. GAAP", "Charges", "(Credits), Net", "Adjusted (Non-GAAP)"], ["Diluted Earnings per Share from Continuing Operations", "$", "1.85", "$", "0.04", "$", "0.06", "$", "1.95"]]);
    expect(anchored(charges)).toEqual([["gaap_row", "2026-09-26", 1.95]]);
    // two header rows, the second naming the adjustments
    const twoRows = plain([["", "GAAP Results", "Adjustments", "Adjusted Results (Non-GAAP)"], ["", "Tax on Repatriation", "U.S. Tax Reform"], ["Diluted earnings per share", "$", "1.85", "$", "0.18", "$", "(0.08)", "$", "1.95"]]);
    expect(anchored(twoRows)).toEqual([["gaap_row", "2026-09-26", 1.95]]);
  });

  it("reads adjustments printed as charges taken off, and gives a year-ago figure a cent from this quarter's to the year-ago quarter", () => {
    const thisQuarter = { months: 3, periodEnd: "2026-09-26", gaap: [1.85] }, yearAgo = { months: 3, periodEnd: "2025-09-27", gaap: [1.84] };
    const html = plain([["", "As Reported", "Restructuring", "Acquisition-Related Costs", "As Adjusted Non-GAAP"], ["Diluted Earnings per Share", "1.84", "(0.31)", "(0.03)", "2.18"]]);
    expect(anchored(html, [thisQuarter, yearAgo])).toEqual([["gaap_row", "2025-09-27", 2.18]]);
  });

  it("still reads GAAP and adjusted in turn where the header also names the adjustments", () => {
    const html = plain([["(In millions, except per share amounts)", "Reported", "Adjustments", "Adjusted", "Reported", "Adjustments", "Adjusted"], ["Earnings per share - Diluted", "$", "1.85", "$", "1.95", "$", "1.60", "$", "1.69"]]);
    expect(anchored(html)).toEqual([["gaap_row", "2026-09-26", 1.95], ["gaap_row", "2025-09-27", 1.69]]);
  });

  // the cases below are layouts the full read of a4 misread or lost (Mettler-Toledo, Intel, Dominion, PPL, Southern,
  // Keurig Dr Pepper, Williams-Sonoma, Merck)
  it("gives a printed figure to the period it was first reported for, before a later version that repeats it", () => {
    // a later 10-K repeats this quarter's 1.85 as a version of the year-ago quarter
    const html = plain([["Diluted EPS (GAAP)", "1.85", "1.60"], ["Adjusted diluted EPS", "1.95", "1.69"]]);
    expect(anchored(html, [QUARTER, { ...YEAR_AGO, later: [1.85] }])).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
    // a later version still places a figure that no first report gives (a recast year-ago quarter)
    const recast = plain([["Diluted EPS (GAAP)", "1.85", "1.70"], ["Adjusted diluted EPS", "1.95", "1.75"]]);
    expect(anchored(recast, [QUARTER, { ...YEAR_AGO, later: [1.7] }])).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.75]]);
  });

  it("tells two periods with the same known figure apart by order, the newer first", () => {
    const same = [{ months: 3, periodEnd: "2026-09-26", gaap: [0.54] }, { months: 3, periodEnd: "2025-09-27", gaap: [0.54] }];
    const html = plain([["GAAP diluted earnings per share", "0.54", "0.54"], ["Non-GAAP diluted earnings per share", "0.57", "0.59"]]);
    expect(anchored(html, same)).toEqual([["gaap_column", "2026-09-26", 0.57], ["gaap_column", "2025-09-27", 0.59]]);
    // printed once, the figure could be either period's: nothing is taken
    expect(anchored(plain([["GAAP diluted earnings per share", "0.54"], ["Non-GAAP diluted earnings per share", "0.57"]]), same)).toEqual([]);
    // a table whose year header runs from the older year (AT&T)
    expect(anchored(plain([["", "2025", "2026"], ["GAAP diluted earnings per share", "0.54", "0.54"], ["Non-GAAP diluted earnings per share", "0.59", "0.57"]]), same)).toEqual([["gaap_column", "2026-09-26", 0.57], ["gaap_column", "2025-09-27", 0.59]]);
    // the year-ago quarter printed as restated: the shared figure is this quarter's
    const restated = [same[0], { ...same[1], later: [0.56] }];
    expect(anchored(plain([["GAAP diluted earnings per share", "0.56", "0.54"], ["Non-GAAP diluted earnings per share", "0.65", "0.72"]]), restated)).toEqual([["gaap_column", "2026-09-26", 0.72], ["gaap_column", "2025-09-27", 0.65]]);
  });

  it("takes no other period's GAAP figure for an adjusted one in a row of GAAP figures", () => {
    // a "GAAP and | Non-GAAP" tax-rate header far above a row of this quarter's and the year-ago quarter's GAAP figures
    const html = plain([["", "GAAP and", "GAAP and"], ["", "Non-GAAP", "Non-GAAP"], ["Tax rate", "12%", "22%"], ["DILUTED NET INCOME PER SHARE:"], ["GAAP diluted net income per share", "$", "1.85", "$", "1.60"], ["Amortization", "0.10", "0.09"], ["Non-GAAP diluted net income per share", "$", "1.95", "$", "1.69"]]);
    expect(anchored(html)).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
  });

  it("places no period by a figure a cent from its filed one outside a row of quarters, and lets a computed one be a cent away", () => {
    // a nine-month table whose year-ago figure 1.84 is a cent from this quarter's filed 1.85 (Dominion)
    const nineMonths = plain([["Earnings Per Share (EPS):"], ["REPORTED EARNINGS", "$(1.38)", "$1.84", "$(3.22)"], ["Adjustments to reported earnings (after tax)", "4.11", "2.09", "2.02"], ["OPERATING EARNINGS", "$2.73", "$3.93", "$(1.20)"]]);
    expect(anchored(nineMonths, [QUARTER, { months: 3, periodEnd: "2025-09-27", gaap: [1.17] }])).toEqual([]);
    // a fourth quarter computed from the year's net income and shares, 1.8538, printed as 1.86
    const computed = [{ months: 3, periodEnd: "2026-09-26", gaap: [1.8538] }, YEAR_AGO];
    expect(anchored(plain([["Diluted EPS (GAAP)", "1.86", "1.60"], ["Adjusted diluted EPS", "1.95", "1.69"]]), computed)).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
    // earnings from continuing operations printed a cent from the known figure of all operations (Dover)
    const continuing = [{ months: 3, periodEnd: "2026-09-26", gaap: [1.75] }, { months: 3, periodEnd: "2025-09-27", gaap: [6.13] }];
    expect(anchored(plain([["Diluted EPS from continuing operations", "1.76", "1.73"], ["Adjusted diluted EPS from continuing operations", "2.28", "2.05"]]), continuing)).toEqual([["gaap_column", "2026-09-26", 2.28]]);
    expect(anchored(plain([["Diluted EPS", "1.76", "1.73"], ["Adjusted diluted EPS", "2.28", "2.05"]]), continuing)).toEqual([]);
  });

  it("reads past a row that names the periods side by side again between the GAAP and the adjusted row", () => {
    const html = plain([
      ["", "3rd Quarter", "Year to Date"], ["", "2026", "2025", "% Change", "2026", "2025", "% Change"],
      ["Reported earnings per share", "$", "1.85", "$", "1.60", "16%", "$", "5.10", "$", "4.40", "16%"],
      ["", "3rd Quarter", "Year to Date"], ["", "2026", "2025 (adjusted)", "% Change", "2026", "2025 (adjusted)", "% Change"],
      ["Earnings from ongoing operations per share", "$", "1.95", "$", "1.69", "15%", "$", "5.35", "$", "4.45", "20%"],
    ]);
    expect(anchored(html)).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
  });

  it("takes the last adjusted row of a block, not an adjustment named 'excluding ...'", () => {
    const html = plain([
      ["(in millions, except per share data)", "Income before taxes", "Net income", "Diluted earnings per share"],
      ["Third Quarter of 2026"], ["Reported", "$", "852", "$", "662", "$", "1.85"], ["Items Affecting Comparability:"],
      ["Productivity", "47", "33", "0.02"], ["Integration of acquisitions, excluding the acquired business", "4", "7", "0.01"], ["Adjusted", "$", "955", "$", "738", "$", "1.95"],
      ["Third Quarter of 2025"], ["Reported", "$", "802", "$", "616", "$", "1.60"], ["Items Affecting Comparability:"], ["Productivity", "30", "23", "0.09"], ["Adjusted", "$", "832", "$", "639", "$", "1.69"],
    ]);
    expect(anchored(html)).toEqual([["gaap_block", "2026-09-26", 1.95], ["gaap_block", "2025-09-27", 1.69]]);
  });

  it("pairs rows that start with a year only with the GAAP row of the same year", () => {
    const html = plain([["", "Q1", "Q2", "Q3", "Q4"], ["2026 GAAP Diluted EPS", "1.20", "1.30", "1.40", "1.85"], ["2026 Non-GAAP Diluted EPS", "1.25", "1.35", "1.45", "1.95"], ["2025 GAAP Diluted EPS", "1.10", "1.15", "1.20", "1.60"], ["2025 Non-GAAP Diluted EPS", "1.12", "1.18", "1.22", "1.69"]]);
    expect(anchored(html)).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
  });

  it("reads a side-by-side reconciliation with a subtotal of the adjustments, and takes it for no twin table", () => {
    const sideBySide = (title: string) => plain([[title], ["", "GAAP", "Acquisition-Related Costs", "Restructuring Costs", "Adjustment Subtotal", "Non-GAAP"], ["Net Income", "2,962", "(920)", "(1,043)", "(1,963)", "4,925"], ["Earnings per Common Share Assuming Dilution", "$", "1.85", "(0.05)", "(0.05)", "(0.10)", "$", "1.95"]]);
    expect(anchored(sideBySide("GAAP") + sideBySide("Non-GAAP"))).toEqual([["gaap_row", "2026-09-26", 1.95], ["gaap_row", "2026-09-26", 1.95]]);
  });

  // the cases below are layouts the full read of a5 misread or lost (AEP, Morgan Stanley, HP, Kimberly-Clark,
  // Raytheon, Cadence, Intel, Sempra, PepsiCo, Tractor Supply, Ralph Lauren, Citizens)
  it("places a period by a figure a cent from its filed one in a row of quarters: one that places another period, or under a quarter's header", () => {
    // continuing operations printed a cent from the filed figure of all operations, the year-ago quarter to the cent
    expect(anchored(plain([["GAAP diluted EPS", "1.86", "1.60"], ["Adjusted diluted EPS", "1.95", "1.69"]]))).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
    // both a cent away, each the other's witness
    expect(anchored(plain([["GAAP diluted EPS", "1.86", "1.61"], ["Adjusted diluted EPS", "1.95", "1.69"]]))).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
    // no year-ago quarter known: the header must name the quarter
    expect(anchored(plain([["", "Q3 FY26", "Q3 FY25"], ["GAAP diluted EPS", "1.86", "1.20"], ["Non-GAAP diluted EPS", "1.95", "1.30"]]), [QUARTER])).toEqual([["gaap_column", "2026-09-26", 1.95]]);
    expect(anchored(plain([["GAAP diluted EPS", "1.86", "1.20"], ["Non-GAAP diluted EPS", "1.95", "1.30"]]), [QUARTER])).toEqual([]);
    // where the row prints the figure to the cent, a figure a cent away elsewhere in it is another period's
    expect(anchored(plain([["", "Q3", "Q3", "YTD", "YTD"], ["GAAP diluted earnings per share", "1.85", "1.60", "5.10", "1.84"], ["Non-GAAP diluted earnings per share", "1.95", "1.69", "5.35", "2.10"]]))).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
  });

  it("knows a fourth quarter computed from the year by its source, not by its decimals", () => {
    const html = plain([["", "As Reported", "Restructuring", "As Adjusted Non-GAAP"], ["Diluted earnings per share", "1.86", "(0.09)", "1.95"]]);
    expect(anchored(html, [{ months: 3, periodEnd: "2026-09-26", gaap: [1.85], computed: true }, YEAR_AGO])).toEqual([["gaap_row", "2026-09-26", 1.95]]);
    expect(anchored(html, [QUARTER, YEAR_AGO])).toEqual([]);
  });

  it("gives each period a column of its year where a header names the years over the row", () => {
    // the year-ago column prints this quarter's filed figure; this quarter's own column prints it a cent away (Raytheon)
    const html = plain([["", "Quarter Ended September 30,"], ["", "2026", "2025"], ["Diluted Earnings Per Share", "1.86", "1.85"], ["Adjusted Diluted Earnings Per Share", "1.95", "2.40"]]);
    expect(anchored(html, [QUARTER, { months: 3, periodEnd: "2025-09-27", gaap: [1.17] }])).toEqual([["gaap_column", "2026-09-26", 1.95]]);
    // a trend table from the older quarter on, both quarters with the same GAAP figure (Cadence, Intel)
    const same = [{ months: 3, periodEnd: "2026-09-26", gaap: [1.05] }, { months: 3, periodEnd: "2025-09-27", gaap: [1.05] }];
    const trend = plain([["", "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026"], ["GAAP Net Income Per Share", "1.05", "1.42", "1.23", "1.33", "1.05"], ["Non-GAAP Net Income Per Share", "1.93", "1.99", "1.96", "2.11", "2.15"]]);
    expect(anchored(trend, same)).toEqual([["gaap_column", "2026-09-26", 2.15], ["gaap_column", "2025-09-27", 1.93]]);
  });

  it("starts a new block at a header that names the same longer period for two years", () => {
    const html = plain([
      ["", "Three months ended September 26, 2026", "Three months ended September 27, 2025"], ["GAAP earnings per diluted share", "1.85", "1.60"], ["Adjusted earnings per diluted share", "1.95", "1.69"],
      ["", "Nine months ended September 26, 2026", "Nine months ended September 27, 2025"], ["GAAP earnings per diluted share", "5.10", "4.40"], ["Adjusted earnings per diluted share", "5.35", "4.45"],
    ]);
    expect(anchored(html)).toEqual([["gaap_column", "2026-09-26", 1.95], ["gaap_column", "2025-09-27", 1.69]]);
  });

  it("takes an adjusted figure equal to another period's GAAP figure where the adjustments add up to it", () => {
    const yearAgo = { months: 3, periodEnd: "2025-09-27", gaap: [1.95] };
    expect(anchored(plain([["", "Reported", "Restructuring", "Core"], ["Net income per common share - diluted", "1.85", "0.10", "1.95"]]), [QUARTER, yearAgo])).toEqual([["gaap_row", "2026-09-26", 1.95]]);
    // with nothing between them to add up, it may be a row of the two quarters' GAAP figures
    expect(anchored(plain([["", "As Reported", "As Adjusted"], ["Diluted earnings per share", "1.85", "1.95"]]), [QUARTER, yearAgo])).toEqual([]);
  });

  it("reads the header over the adjusted figure where the last header names a constant-currency variant", () => {
    const html = plain([["", "As Reported", "Total Adjustments", "As Adjusted (Reported $)", "Foreign Currency Impact", "As Adjusted (Constant $)"], ["Net revenues", "1,496.5", "—", "1,496.5", "11.8", "1,508.3"], ["Net income per diluted common share", "1.85", "", "1.95", "", ""]]);
    expect(anchored(html)).toEqual([["gaap_row", "2026-09-26", 1.95]]);
  });

  it("takes no figure a cent away from another quarter of a trend table: the witness must stand beside it, the year must fit", () => {
    // a 2025 trend table in the 2026 release: the year-ago quarter's column to the cent, the third quarter of 2025 a
    // cent from this quarter's filed figure (Ecolab)
    const trend = plain([["", "First Quarter", "Second Quarter", "Six Months", "Third Quarter", "Nine Months", "Fourth Quarter", "Year"], ["", "2025", "2025", "2025", "2025", "2025", "2025", "2025"],
      ["Diluted earnings per share, as reported (U.S. GAAP)", "0.86", "1.00", "1.86", "1.84", "3.70", "1.60", "5.30"], ["Adjusted diluted earnings per share (Non-GAAP)", "0.80", "1.12", "1.92", "1.90", "3.82", "1.69", "5.51"]]);
    expect(anchored(trend)).toEqual([["gaap_column", "2025-09-27", 1.69]]);
    // quarters only: the 2025 quarter beside the year-ago one is still of 2025
    const quarters = plain([["", "Q1", "Q2", "Q3", "Q4"], ["", "2025", "2025", "2025", "2025"], ["GAAP diluted EPS", "1.20", "1.30", "1.84", "1.60"], ["Adjusted diluted EPS", "1.25", "1.35", "1.90", "1.69"]]);
    expect(anchored(quarters)).toEqual([["gaap_column", "2025-09-27", 1.69]]);
  });

  it("starts a block at a row of one year, and reads no column date from a title", () => {
    // a table stacked by year, each year with its quarter and its year to date (IFF)
    const stacked = plain([["Earnings Per Share"], ["2026"], ["", "Q3", "YTD"], ["EPS Reported", "1.85", "4.10"], ["Restructuring Charges", "0.10", "0.20"], ["EPS as Adjusted", "1.95", "4.30"],
      ["2025"], ["", "Q3", "YTD"], ["EPS Reported", "1.70", "3.90"], ["Restructuring Charges", "0.11", "0.21"], ["EPS as Adjusted", "1.81", "4.11"]]);
    expect(anchored(stacked)).toEqual([["gaap_column", "2026-09-26", 1.95]]);
    // a title spanning the whole table names the year's end, no column's (Pentair)
    const titled = `<table><tr><td colspan="3">Reconciliation of GAAP to non-GAAP financial measures for the year ending December 31, 2026</td></tr>`
      + plain([["", "Third Quarter", "Full Year"], ["Diluted earnings per ordinary share", "1.85", "6.10"], ["Diluted earnings per ordinary share—as adjusted", "1.95", "6.40"]]).replace("<table>", "");
    expect(anchored(titled)).toEqual([["gaap_column", "2026-09-26", 1.95]]);
  });

  it("holds a period only in a column whose header names its end, and takes no guidance column for a year", () => {
    // a forecast for the next quarter, its GAAP figure a cent from this quarter's (Church & Dwight)
    const forecast = plain([["", "For the quarter ended"], ["", "December 31, 2026", "December 31, 2025", "Change"], ["Diluted Earnings Per Share - Reported", "1.84", "0.95", "-64%"], ["Diluted Earnings Per Share - Adjusted (non-GAAP)", "1.84", "0.90", "10%"]]);
    expect(anchored(forecast)).toEqual([]);
    // the quarter, the year, and next year's guidance under a later year (Sherwin-Williams)
    const guidance = plain([["", "Three Months Ended September 26, 2026", "Year Ended September 26, 2026", "(after-tax guidance) Year Ended September 2027", "(after-tax guidance) Year Ended September 2027"], ["Diluted net income per share", "1.85", "6.40", "7.10", "7.40"], ["Adjusted diluted net income per share", "1.95", "6.80", "7.50", "7.80"]]);
    expect(anchored(guidance)).toEqual([["gaap_column", "2026-09-26", 1.95]]);
  });

  it("places a period by the total of a breakdown, not by a segment that prints the same figure, and pairs rows of a quarter's year", () => {
    // FirstEnergy's variance table: segments as columns under a header that names the quarter beside them, rows named
    // by quarter and year
    const html = plain([
      ["Three Months Ended June 30, 2026", "Regulated Distribution", "Regulated Transmission", "Competitive Energy Services", "Other", "Consolidated"],
      ["2Q 2025 Basic EPS", "0.43", "0.12", "0.74", "(0.12)", "1.17"],
      ["2Q 2025 Basic EPS - Operating (Non-GAAP)", "0.45", "0.12", "0.82", "(0.09)", "1.30"],
      ["2Q 2026 Basic EPS - Operating (Non-GAAP)", "0.39", "1.85", "(0.21)", "(0.08)", "1.95"],
      ["2Q 2026 Basic EPS", "0.37", "1.85", "(0.28)", "(0.08)", "1.86"],
    ]);
    expect(anchored(html, [QUARTER, { months: 3, periodEnd: "2025-09-27", gaap: [1.17] }])).toEqual([["gaap_column", "2025-09-27", 1.3], ["gaap_column", "2026-09-26", 1.95]]);
  });

  it("calls a row basic where its own label says so, whatever its heading", () => {
    const html = plain([["Diluted earnings per share:"], ["GAAP diluted EPS", "1.85", "1.60"], ["Adjusted EPS - basic", "1.97", "1.70"], ["Adjusted EPS - diluted", "1.95", "1.69"]]);
    expect(adjustedEpsFromExhibits([exhibit(html)], "2026-09-26", [QUARTER, YEAR_AGO]).quarter).toMatchObject({ value: 1.95, basis: "diluted" });
  });

  // the cases below are layouts the full read of a6 lost (Marvell, Autodesk, Cadence)
  it("takes no row of periods for a breakdown: its figures add up within the rounding of each, under no header of different periods", () => {
    // a quarter, the quarter before and the year-ago quarter, this quarter and the year-ago one with the same GAAP figure (Marvell)
    const same = [{ months: 3, periodEnd: "2026-09-26", gaap: [-0.2] }, { months: 3, periodEnd: "2025-09-27", gaap: [-0.2] }];
    const quarters = plain([["", "Three Months Ended"], ["", "September 26, 2026", "June 27, 2026", "September 27, 2025"], ["GAAP diluted net loss per share", "(0.20)", "(0.02)", "(0.20)"], ["Non-GAAP diluted net income per share", "0.31", "0.46", "0.52"]]);
    expect(anchored(quarters, same)).toEqual([["gaap_column", "2026-09-26", 0.31], ["gaap_column", "2025-09-27", 0.52]]);
    // two quarters and their half year, the half year a cent from the year-ago quarter's figure (Autodesk): no
    // breakdown, and no quarter placed a cent away in the half year's column
    const half = plain([["Fiscal Year 2026", "QTR 1", "QTR 2", "YTD 2026"], ["GAAP Diluted Net Income Per Share", "0.12", "0.13", "0.26"], ["Non-GAAP Diluted Net Income Per Share", "0.32", "0.35", "0.67"]]);
    expect(anchored(half, [{ months: 3, periodEnd: "2026-09-26", gaap: [0.13] }, { months: 3, periodEnd: "2025-09-27", gaap: [0.27] }])).toEqual([["gaap_column", "2026-09-26", 0.35]]);
  });

  it("lets readings placed by a GAAP figure printed to the cent outrank those placed by one a cent away", () => {
    // the quarter on the current revenue standard to the cent (0.27), and a trend of quarters on the former one (0.26) (Cadence)
    const anchors = [{ months: 3, periodEnd: "2026-09-26", gaap: [0.27] }, { months: 3, periodEnd: "2025-09-27", gaap: [0.25] }];
    const current = plain([["", "Three Months Ended"], ["", "September 26, 2026", "September 27, 2025"], ["Diluted net income per share on a GAAP basis", "0.27", "0.25"], ["Diluted net income per share on a non-GAAP basis", "0.45", "0.34"]]);
    const trend = plain([["", "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026"], ["Diluted net income (loss) per share on a GAAP basis", "0.25", "0.29", "(0.05)", "0.30", "0.26"], ["Diluted net income per share on a non-GAAP basis", "0.34", "0.35", "0.39", "0.44", "0.44"]]);
    const out = adjustedEpsFromExhibits([exhibit(current + trend)], "2026-09-26", anchors);
    expect(out.readings.filter((reading) => reading.periodEnd === "2026-09-26" && reading.how !== "period_header").map((reading) => [reading.value, reading.near ?? false])).toEqual([[0.45, false], [0.44, true]]);
    expect(out.quarter).toMatchObject({ value: 0.45, basis: "diluted" });
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

  it("lets the readings the GAAP line placed outrank the readings the headers placed", () => {
    // a full year taken for the quarter by its header
    expect(agreeOn([reading(0.74, { diluted: true, how: "gaap_column" }), reading(3.7, { diluted: true, how: "period_header", rowIndex: 41 })]).figure).toMatchObject({ value: 0.74, basis: "diluted" });
    expect(agreeOn([reading(0.74, { diluted: true, how: "gaap_column" }), reading(0.8, { diluted: true, how: "gaap_row" })])).toEqual({ figure: null, note: "ambiguous" });
    // whatever their rank: an unlabelled row the GAAP line placed against a diluted row placed by its header (AMD)
    expect(agreeOn([reading(0.15, { how: "gaap_column" }), reading(0.09, { diluted: true, how: "period_header", rowIndex: 45 })]).figure).toMatchObject({ value: 0.15, basis: "unlabelled" });
  });

  it("lets the readings placed by a GAAP figure printed to the cent outrank those placed by one a cent away", () => {
    expect(agreeOn([reading(0.45, { diluted: true, how: "gaap_column" }), reading(0.44, { diluted: true, how: "gaap_column", near: true, tableIndex: 26 })]).figure).toMatchObject({ value: 0.45 });
    // placed a cent away and by nothing else: it stands
    expect(agreeOn([reading(0.44, { diluted: true, how: "gaap_column", near: true }), reading(0.4, { diluted: true, how: "period_header", rowIndex: 30 })]).figure).toMatchObject({ value: 0.44 });
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

  it("prefers a trusted diluted row to a basic row confirmed more often", () => {
    const basic = (end: string, value: number) => row(end, value, { label: "Adjusted basic EPS", diluted: false, basic: true, rowIndex: 12 });
    const releases = company(FIGURES, undefined, (index) => [basic(ENDS[index], FIGURES[index] + 0.02), ...(index >= 4 ? [basic(ENDS[index - 4], FIGURES[index - 4] + 0.02)] : [])]);
    // the diluted row is missing from the first two releases, so the basic row has the longer record
    for (const release of releases.slice(0, 2)) release.readings = release.readings.filter((reading) => reading.basic);
    const out = decideCompany(releases);
    expect(out[8].quarter).toMatchObject({ value: 1.8, label: "Adjusted diluted EPS" });
  });

  it("reads the trusted row where the GAAP line placed it when the headers placed another figure on it", () => {
    const placed = company(FIGURES, undefined, (index) => (index === 8 ? [row(ENDS[index], 7.2, { how: "period_header", rowIndex: 41 })] : []))
      .map((release) => ({ ...release, readings: release.readings.map((reading) => (reading.how ? reading : { ...reading, how: "gaap_column" as const })) }));
    expect(decideCompany(placed)[8].quarter).toMatchObject({ value: 1.8, grade: "same_row" });
  });

  it("reads the trusted row where a GAAP figure printed to the cent placed it when one a cent away placed another figure on it", () => {
    const placed = company(FIGURES, undefined, (index) => (index === 8 ? [row(ENDS[index], 1.79, { how: "gaap_column", near: true, tableIndex: 26, rowIndex: 7 })] : []))
      .map((release) => ({ ...release, readings: release.readings.map((reading) => (reading.how ? reading : { ...reading, how: "gaap_column" as const })) }));
    expect(decideCompany(placed)[8].quarter).toMatchObject({ value: 1.8, grade: "same_row" });
  });

  it("lets the release's own words choose between rows that print different figures, and keeps the trusted row where they say nothing", () => {
    // the diluted row's header takes another column in every release, and the next release repeats the mistake (AMD)
    const header = company(FIGURES.map((value) => value + 0.3)).map((release) => ({ ...release, readings: release.readings.map((reading) => ({ ...reading, how: "period_header" as const })) }));
    const unlabelled = (end: string, value: number) => row(end, value, { label: "Non-GAAP EPS", diluted: false, how: "gaap_column", rowIndex: 20 });
    const releases = header.map((release, index) => ({ ...release, readings: [...release.readings, unlabelled(ENDS[index], FIGURES[index]), ...(index >= 4 ? [unlabelled(ENDS[index - 4], FIGURES[index - 4])] : [])] }));
    // the text says nothing: the trusted diluted row decides (another measure may be the one guided on: GE's 2015 rows)
    expect(decideCompany(releases)[0].quarter).toMatchObject({ value: 1.3 });
    // the text states the figure of the row its GAAP line placed
    const out = decideCompany(releases.map((release, index) => ({ ...release, stated: [Math.round(FIGURES[index] * 100)] })));
    expect(out[0].quarter).toMatchObject({ value: 1, grade: "confirmed", label: "Non-GAAP EPS", byText: true });
    expect(out[8].quarter).toMatchObject({ value: 1.8, label: "Non-GAAP EPS" });
    // the text states the trusted row's figure: it stands
    const kept = decideCompany(releases.map((release, index) => ({ ...release, stated: [Math.round((FIGURES[index] + 0.3) * 100)] })))[0].quarter;
    expect(kept).toMatchObject({ value: 1.3 });
    expect(kept?.byText).toBeUndefined();
  });

  it("never lets the text overrule a figure the GAAP line placed, though the text states the year's figure a header took for the quarter", () => {
    // PepsiCo's first quarter of 2010: the core figure placed by the GAAP line, and the year 2009 placed by a header
    const releases = company(FIGURES).map((release, index) => ({
      ...release, stated: [Math.round(FIGURES[index] * 400)],
      readings: [...release.readings.map((reading) => ({ ...reading, how: "gaap_column" as const })), row(ENDS[index], FIGURES[index] * 4, { how: "period_header", label: "Core diluted EPS", rowIndex: 41 })],
    }));
    const out = decideCompany(releases);
    expect(out[0].quarter).toMatchObject({ value: 1, label: "Adjusted diluted EPS" });
    expect(out[0].quarter?.byText).toBeUndefined();
  });

  it("leaves a quarter open where the text states more than one of its candidates: the order of its figures is no guide", () => {
    // Aflac's second quarter of 2009: the trusted row read for the quarter twice, once from the six months' table a
    // header took for the quarter, and the text states both; Emerson's fourth quarter of 2017 states the year first
    const releases = company(FIGURES, undefined, (index) => (index === 8 ? [row(ENDS[index], 3.4, { tableIndex: 4 })] : []))
      .map((release) => ({ ...release, readings: release.readings.map((reading) => ({ ...reading, how: "period_header" as const })) }));
    releases[8].stated = [340, 180, 140];
    expect(decideCompany(releases)[8]).toMatchObject({ quarter: null, quarterNote: "ambiguous" });
    // where it states one of them only, it decides
    releases[8].stated = [180, 140];
    expect(decideCompany(releases)[8].quarter).toMatchObject({ value: 1.8, byText: true });
  });

  it("never takes for the quarter a figure the release prints for a longer period ending the same day, whatever that row's label", () => {
    // Zimmer's third quarter of 2015: the nine months' figure, which a header took for the quarter, stated too; GE's
    // fourth quarters of 2012 and 2013: the year's figure in a row labelled "per share" under an operating heading
    const releases = company(FIGURES, undefined, (index) => (index === 8 ? [row(ENDS[index], 5.2, { tableIndex: 23 }), row(ENDS[index], 5.2, { months: 9, label: "per share", tableIndex: 23 })] : []))
      .map((release) => ({ ...release, readings: release.readings.map((reading) => ({ ...reading, how: "period_header" as const })) }));
    releases[8].stated = [520, 180];
    expect(decideCompany(releases)[8].quarter).toMatchObject({ value: 1.8, byText: true });
  });

  it("moves the trusted row's figure only onto a figure the GAAP line placed, never onto another trusted measure the text states", () => {
    // Mid-America's 2021 quarters: Core FFO and Core AFFO per share, both trusted, both placed by their headers; the
    // text states the Core AFFO figure, the Core FFO one stands in the tables only
    const affo = (end: string, value: number) => row(end, value, { label: "Core adjusted funds from operations per Share - diluted", rowIndex: 14 });
    const releases = company(FIGURES, undefined, (index) => [affo(ENDS[index], FIGURES[index] - 0.1), ...(index >= 4 ? [affo(ENDS[index - 4], FIGURES[index - 4] - 0.1)] : [])])
      .map((release, index) => ({ ...release, stated: [Math.round((FIGURES[index] - 0.1) * 100)], readings: release.readings.map((reading) => ({ ...reading, how: "period_header" as const })) }));
    const out = decideCompany(releases);
    expect(out[0].quarter).toMatchObject({ value: 1, label: "Adjusted diluted EPS" });
    expect(out[0].quarter?.byText).toBeUndefined();
  });

  it("never lets the text make a basic figure of a release that prints a diluted one", () => {
    // Regeneron's fourth quarter of 2012 states "$1.79 per basic share and $1.47 per diluted share", the diluted half
    // cut off by a line break; both rows placed by their headers, both trusted
    const basic = (end: string, value: number) => row(end, value, { label: "Non-GAAP net income per share - basic", diluted: false, basic: true, rowIndex: 12 });
    const releases = company(FIGURES, undefined, (index) => [basic(ENDS[index], FIGURES[index] + 0.3), ...(index >= 4 ? [basic(ENDS[index - 4], FIGURES[index - 4] + 0.3)] : [])])
      .map((release, index) => ({ ...release, stated: [Math.round((FIGURES[index] + 0.3) * 100)], readings: release.readings.map((reading) => ({ ...reading, how: "period_header" as const })) }));
    const out = decideCompany(releases);
    expect(out[0].quarter).toMatchObject({ value: 1, label: "Adjusted diluted EPS" });
    expect(out[0].quarter?.byText).toBeUndefined();
  });

  it("takes no year far from the sum of its four quarters, and of two years the one that agrees with them", () => {
    // Assurant's 2025 release: the year-ago quarter a header took for the year; Kimberly-Clark's: the continuing
    // operations beside the headline measure its quarters are read from
    const releases = company(FIGURES);
    releases[7].readings.push(row("2025-12-31", 1.3, { months: 12 }));
    expect(decideCompany(releases)[7]).toMatchObject({ year: null, yearNote: "not_the_quarters" });
    releases[7].readings.push(row("2025-12-31", 6.2, { months: 12, label: "Adjusted diluted EPS from continuing operations", rowIndex: 30 }));
    expect(decideCompany(releases)[7].year).toMatchObject({ value: 6.2 });
  });

  it("sets a year against its quarters on the year's own share basis, across a split", () => {
    // McCormick's two-for-one of November 2020: three quarters reported before it, the fourth quarter and the year after
    const split = [{ date: "2025-12-15", ratio: 2 }];
    // the releases after the split print the year-ago quarters at half
    const releases = company([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 0.85, 0.9], (index, original) => (index >= 7 ? original / 2 : original));
    releases[7].readings.push(row("2025-12-31", 3.1, { months: 12 }));
    // (1.4 + 1.5 + 1.6) / 2 + 0.85 = 3.1
    expect(decideCompany(releases, split)[7].year).toMatchObject({ value: 3.1 });
    // the quarters added up on their old basis (5.35) are no year of this release
    releases[7].readings[releases[7].readings.length - 1] = row("2025-12-31", 5.35, { months: 12 });
    expect(decideCompany(releases, split)[7]).toMatchObject({ year: null, yearNote: "not_the_quarters" });
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
