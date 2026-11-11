import { describe, expect, it } from "vitest";
import { buildFactIndex, factDurationMonths, gradeValue, nameStatementRows, printedTolerance, queryAnswerKey, significantDigits, type GradeInput, type SecFact } from "./flash-facts";
import type { RawTable, StatementColumn, StatementRow } from "./flash-html";

const fact = (overrides: Partial<SecFact>): SecFact => ({
  cik: 1,
  concept: "Revenue",
  unit: "USD",
  startDate: "2025-06-29",
  endDate: "2025-09-27",
  val: 102466000000,
  form: "10-Q",
  filed: "2025-10-30",
  accn: "old-periodic",
  ...overrides,
});

const column = (months: number, periodEnd: string, startCol = 1): StatementColumn => ({ months, periodEnd, headerRow: 0, startCol, endCol: startCol, confidence: "full_date" });

const row = (label: string, entries: [number | null, string][], headings: string[] = []): StatementRow => ({
  label,
  headingPath: headings,
  footnotes: [],
  sourceFile: "fixture",
  sourceSha256: "fixture",
  tableIndex: 0,
  rowIndex: 5,
  values: entries.map(([value, raw], index) => ({ value, raw, sourceCol: index + 1, percent: false, footnotes: [] })),
  alignable: true,
  kind: "data",
});

const table: RawTable = { sourceFile: "fixture", sourceSha256: "fixture", tableIndex: 0, grid: [], context: "", title: "", unitMultiplier: 1e6, shareMultiplier: 1e3 };
const releaseDate = "2026-10-01";
const currentPeriodEnd = "2026-09-26";
const columns = [column(3, currentPeriodEnd), column(3, "2025-09-27", 2)];

const gradeInput = (overrides: Partial<GradeInput>): GradeInput => ({
  valueId: "v1",
  statement: "income",
  matchedConcepts: ["Revenue"],
  months: 3,
  periodEnd: currentPeriodEnd,
  value: 114477000000,
  raw: "114,477",
  perShare: false,
  shares: false,
  percent: false,
  unitMultiplier: 1e6,
  signNote: "as_printed",
  ...overrides,
});

describe("flash fact periods and tolerances", () => {
  it("derives duration months and printed precision without confusing units", () => {
    expect(factDurationMonths(null, "2026-09-26")).toBe(0);
    expect(factDurationMonths("2025-06-29", "2025-09-27")).toBe(3);
    expect(factDurationMonths("2024-09-29", "2025-09-27")).toBe(12);
    expect(factDurationMonths("2025-01-01", "2025-09-27")).toBeNull();
    expect(significantDigits("114,477")).toBe(6);
    expect(significantDigits("10")).toBe(1);
    expect(significantDigits("0.80")).toBe(2);
    expect(significantDigits("1.85")).toBe(3);
    expect(printedTolerance("114,477", 1e6, false)).toBe(500000);
    expect(printedTolerance("2.10", 1, true)).toBe(0.005);
  });
});

describe("answer-key naming", () => {
  it("uses only pre-release facts with matching units and keeps printed current values", () => {
    const index = buildFactIndex([
      fact({}),
      fact({ concept: "OtherRevenue" }),
      fact({ concept: "FutureRevenue", filed: "2026-10-10" }),
      fact({ concept: "WrongUnit", unit: "shares" }),
    ]);
    const [named] = nameStatementRows({ rows: [row("Total net sales", [[114477, "114,477"], [102466, "102,466"]])], columns, table, currentPeriodEnd, releaseDate, factIndex: index });
    expect(named.named).toBe(true);
    expect(named.matchedConcepts).toEqual(["OtherRevenue", "Revenue"]);
    expect(named.matchedConcepts).not.toContain("FutureRevenue");
    expect(named.matchedConcepts).not.toContain("WrongUnit");
    expect(named.values.map((value) => value.value)).toEqual([114477000000, 102466000000]);
    expect(named.values.map((value) => value.current)).toEqual([true, false]);
    expect(named.evidence.every((match) => match.filed < releaseDate)).toBe(true);
  });

  it("records sign flips and grades against the paired periodic filing", () => {
    const index = buildFactIndex([
      fact({ concept: "PaymentsToAcquirePropertyPlantAndEquipment", startDate: "2024-09-29", val: 9041000000 }),
      fact({ concept: "PaymentsToAcquirePropertyPlantAndEquipment", startDate: "2025-09-28", endDate: currentPeriodEnd, val: 9041000000, filed: "2026-11-03", accn: "2026-10-K", form: "10-K" }),
    ]);
    const [named] = nameStatementRows({ rows: [row("Payments for acquisition of property, plant and equipment", [[-9041, "(9,041)"], [-9041, "(9,041)"]])], columns: [column(12, currentPeriodEnd), column(12, "2025-09-27", 2)], table, currentPeriodEnd, releaseDate, factIndex: index });
    expect(named.signNote).toBe("flipped");
    expect(named.values[0].value).toBe(-9041000000);
    const result = gradeValue(gradeInput({ matchedConcepts: named.matchedConcepts, months: 12, value: named.values[0].value, raw: "(9,041)", signNote: named.signNote }), index, "2026-10-K", "10-K");
    expect(result).toMatchObject({ status: "match", releaseValue: -9041000000, factValue: 9041000000 });
    const mismatch = gradeValue(gradeInput({ matchedConcepts: named.matchedConcepts, months: 12, value: -9000000000, raw: "(9,000)", signNote: "flipped" }), index, "2026-10-K", "10-K");
    expect(mismatch).toMatchObject({ status: "mismatch", reason: "value_mismatch", releaseValue: -9000000000, factValue: 9041000000 });
  });

  it("requires three significant digits or a second-column confirmation", () => {
    const index = buildFactIndex([
      fact({ concept: "SmallConcept", val: 10000000 }),
      fact({ concept: "SmallConcept", startDate: "2026-06-29", endDate: currentPeriodEnd, val: 20000000, filed: "2026-10-30" }),
    ]);
    const [single] = nameStatementRows({ rows: [row("Small item", [[10, "10"]])], columns: [columns[1]], table, currentPeriodEnd, releaseDate, factIndex: index });
    expect(single.named).toBe(false);
    const [confirmed] = nameStatementRows({ rows: [row("Small item", [[20, "20"], [10, "10"]])], columns, table, currentPeriodEnd: "2027-09-25", releaseDate: "2027-10-01", factIndex: index });
    expect(confirmed.named).toBe(true);
    expect(confirmed.matchedConcepts).toEqual(["SmallConcept"]);
  });

  it("does not name ratios or discard heading rows", () => {
    const ratio = row("Return on tangible common equity", [[20, "20"], [18, "18"]], ["NET INCOME PER COMMON SHARE DATA"]);
    const heading: StatementRow = { ...row("Earnings per share", []), kind: "heading", alignable: false };
    const [ratioResult, headingResult] = nameStatementRows({ rows: [ratio, heading], columns, table, currentPeriodEnd, releaseDate, factIndex: buildFactIndex([]) });
    expect(ratioResult.named).toBe(false);
    expect(ratioResult.nameReason).toBe("percent_or_ratio_not_answer_keyed");
    expect(headingResult.nameReason).toBe("heading");
    expect(headingResult.values).toEqual([]);
  });
});

describe("grading guards", () => {
  it("marks fourth-quarter three-month values and unpaired releases not gradable", () => {
    const index = buildFactIndex([fact({ accn: "2026-10-K", form: "10-K" })]);
    expect(gradeValue(gradeInput({}), index, "2026-10-K", "10-K")).toMatchObject({ status: "not_gradable", reason: "fourth_quarter_three_month" });
    expect(gradeValue(gradeInput({}), index, null, null)).toMatchObject({ status: "not_gradable", reason: "release_not_paired" });
  });

  it("keeps both values when candidate concepts conflict", () => {
    const index = buildFactIndex([
      fact({ concept: "A", startDate: null, endDate: currentPeriodEnd, val: 100, accn: "periodic" }),
      fact({ concept: "B", startDate: null, endDate: currentPeriodEnd, val: 110, accn: "periodic" }),
    ]);
    const result = gradeValue(gradeInput({ matchedConcepts: ["A", "B"], months: 0, value: 100, raw: "100", unitMultiplier: 1 }), index, "periodic", "10-Q");
    expect(result).toMatchObject({ status: "match", reason: "multiple_concepts_one_match", releaseValue: 100, factValue: 100 });
    expect(result.comparisons.map((comparison) => comparison.factValue)).toEqual([100, 110]);
  });

  it("checks exact per-share cents and does not silently use a different unit", () => {
    const index = buildFactIndex([fact({ concept: "EarningsPerShareDiluted", unit: "USD/shares", startDate: "2026-06-28", endDate: currentPeriodEnd, val: 2.1, accn: "periodic" })]);
    const match = gradeValue(gradeInput({ matchedConcepts: ["EarningsPerShareDiluted"], value: 2.1, raw: "2.10", perShare: true, unitMultiplier: 1 }), index, "periodic", "10-Q");
    expect(match.status).toBe("match");
    const mismatch = gradeValue(gradeInput({ matchedConcepts: ["EarningsPerShareDiluted"], value: 2.11, raw: "2.11", perShare: true, unitMultiplier: 1 }), index, "periodic", "10-Q");
    expect(mismatch).toMatchObject({ status: "mismatch", reason: "value_mismatch" });
    const wrongUnit = gradeValue(gradeInput({ matchedConcepts: ["EarningsPerShareDiluted"], value: 2.1, raw: "2.10", perShare: false, unitMultiplier: 1 }), index, "periodic", "10-Q");
    expect(wrongUnit).toMatchObject({ status: "not_gradable", reason: "no_such_fact" });
  });

  it("uses the value and sign of a pre-release answer-key fact only for naming", () => {
    const index = buildFactIndex([fact({})]);
    const matches = queryAnswerKey(index, { months: 3, periodEnd: "2025-09-27", printedValue: 102466000000, raw: "102,466", multiplier: 1e6, perShare: false, shares: false, percent: false, releaseDate });
    expect(matches).toHaveLength(1);
    expect(matches[0]).not.toHaveProperty("val");
    expect(matches[0].filed).toBe("2025-10-30");
  });

  it("uses instant facts for end-of-period cash inside a duration column", () => {
    const index = buildFactIndex([
      fact({ concept: "CashAndCashEquivalentsAtCarryingValue", startDate: null, endDate: "2025-07-27", val: 11639000000, filed: "2025-08-27" }),
      fact({ concept: "CashAndCashEquivalentsAtCarryingValue", startDate: null, endDate: currentPeriodEnd, val: 22443000000, filed: "2026-08-26", accn: "periodic" }),
    ]);
    const [named] = nameStatementRows({ rows: [row("Cash and cash equivalents at end of period", [[22443, "22,443"], [11639, "11,639"]])], columns: [column(6, currentPeriodEnd), column(6, "2025-07-27", 2)], table, currentPeriodEnd, releaseDate: "2026-08-20", factIndex: index });
    expect(named.named).toBe(true);
    expect(named.values[0]).toMatchObject({ months: 6, factMonths: 0, instant: true, value: 22443000000 });
    const result = gradeValue(gradeInput({ matchedConcepts: named.matchedConcepts, months: 3, factMonths: 0, instant: true, value: named.values[0].value, raw: "22,443" }), index, "periodic", "10-K");
    expect(result.status).toBe("match");
  });
});
