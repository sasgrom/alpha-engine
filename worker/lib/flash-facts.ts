import { addMonths, daysBetween, isCurrentPeriod, previousDate, rowUnit, type RawTable, type StatementColumn, type StatementKind, type StatementRow } from "./flash-html";

export interface SecFact {
  cik: number;
  concept: string;
  unit: string;
  startDate: string | null;
  endDate: string;
  val: number;
  form: string | null;
  filed: string | null;
  accn: string | null;
}

export interface FactIndex {
  byPeriod: Map<number, Map<string, SecFact[]>>;
}

export interface AnswerKeyMatch {
  concept: string;
  unit: string;
  startDate: string | null;
  endDate: string;
  filed: string;
  form: string | null;
  accn: string | null;
  signFlipped: boolean;
}

export interface AnswerKeyEvidence extends AnswerKeyMatch {
  columnIndex: number;
}

export interface NamedValue {
  columnIndex: number;
  sourceCol: number;
  months: number;
  periodEnd: string;
  current: boolean;
  value: number | null;
  raw: string;
  unitMultiplier: number;
  perShare: boolean;
  factMonths: number;
  instant: boolean;
}

export interface NamedRow extends Omit<StatementRow, "values"> {
  values: NamedValue[];
  matchedConcepts: string[];
  evidence: AnswerKeyEvidence[];
  named: boolean;
  nameReason: string | null;
  signNote: "as_printed" | "flipped" | "mixed";
  unitMultiplier: number;
  perShare: boolean;
  shares: boolean;
  percent: boolean;
}

export function isInstantRow(row: StatementRow): boolean {
  return /cash and cash equivalents.*\b(?:beginning|end) of (?:the )?(?:year|period)\b|^(?:beginning|end) of (?:the )?(?:year|period)\b/i.test(row.label);
}

export function factDurationMonths(startDate: string | null, endDate: string): number | null {
  if (!startDate) return 0;
  for (const months of [3, 6, 9, 12]) if (Math.abs(daysBetween(addMonths(startDate, months), endDate)) <= 3) return months;
  return null;
}

export function buildFactIndex(facts: SecFact[]): FactIndex {
  const byPeriod = new Map<number, Map<string, SecFact[]>>();
  for (const fact of facts) {
    if (!Number.isFinite(fact.val)) continue;
    const endDate = fact.endDate.slice(0, 10);
    const months = factDurationMonths(fact.startDate, endDate);
    if (months === null) continue;
    const byDate = byPeriod.get(months) ?? new Map<string, SecFact[]>();
    const rows = byDate.get(endDate);
    if (rows) rows.push(fact);
    else byDate.set(endDate, [fact]);
    byPeriod.set(months, byDate);
  }
  return { byPeriod };
}

export function significantDigits(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [whole, fraction = ""] = cleaned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+/, "");
  if (!digits) return 1;
  return fraction ? digits.length : Math.max(1, digits.replace(/0+$/, "").length);
}

export function printedTolerance(raw: string, multiplier: number, perShare: boolean): number {
  if (perShare) return 0.005;
  const decimals = raw.includes(".") ? raw.split(".")[1].replace(/[^0-9].*$/, "").length : 0;
  return 0.5 * Math.pow(10, -decimals) * multiplier;
}

function expectedUnits(perShare: boolean, shares: boolean, percent: boolean): string[] {
  if (percent) return [];
  if (perShare) return ["usd/shares"];
  if (shares) return ["shares"];
  return ["usd"];
}

export function queryAnswerKey(index: FactIndex, options: {
  months: number;
  periodEnd: string;
  printedValue: number;
  raw: string;
  multiplier: number;
  perShare: boolean;
  shares: boolean;
  percent: boolean;
  releaseDate: string;
}): AnswerKeyMatch[] {
  const units = expectedUnits(options.perShare, options.shares, options.percent);
  if (!units.length) return [];
  const tolerance = printedTolerance(options.raw, options.multiplier, options.perShare);
  const magnitude = Math.abs(options.printedValue);
  const matches: AnswerKeyMatch[] = [];
  for (let offset = -3; offset <= 3; offset++) {
    const date = previousDate(options.periodEnd, -offset);
    for (const fact of index.byPeriod.get(options.months)?.get(date) ?? []) {
      if (!fact.filed || fact.filed >= options.releaseDate || !units.includes(fact.unit.toLowerCase())) continue;
      if (Math.abs(Math.abs(fact.val) - magnitude) > tolerance + 1e-9) continue;
      matches.push({ concept: fact.concept, unit: fact.unit, startDate: fact.startDate, endDate: fact.endDate, filed: fact.filed, form: fact.form, accn: fact.accn, signFlipped: fact.val !== 0 && options.printedValue !== 0 && Math.sign(fact.val) !== Math.sign(options.printedValue) });
    }
  }
  const unique = new Map<string, AnswerKeyMatch>();
  for (const match of matches) unique.set(`${match.concept}|${match.accn}|${match.filed}|${match.startDate}|${match.endDate}|${match.signFlipped}`, match);
  return [...unique.values()].sort((a, b) => a.concept.localeCompare(b.concept) || a.filed.localeCompare(b.filed) || (a.accn ?? "").localeCompare(b.accn ?? ""));
}

export function nameStatementRows(options: {
  rows: StatementRow[];
  columns: StatementColumn[];
  table: RawTable;
  currentPeriodEnd: string | null;
  releaseDate: string;
  factIndex: FactIndex;
}): NamedRow[] {
  const { rows, columns, table, currentPeriodEnd, releaseDate, factIndex } = options;
  return rows.map((row) => {
    const unit = rowUnit(row, table);
    if (row.kind === "heading") return { ...row, values: [], matchedConcepts: [], evidence: [], named: false, nameReason: "heading", signNote: "as_printed", unitMultiplier: unit.multiplier, ...unit };
    if (!row.alignable || !columns.length || row.values.length !== columns.length) return { ...row, values: [], matchedConcepts: [], evidence: [], named: false, nameReason: "column_alignment", signNote: "as_printed", unitMultiplier: unit.multiplier, ...unit };
    if (unit.percent) return { ...row, values: [], matchedConcepts: [], evidence: [], named: false, nameReason: "percent_or_ratio_not_answer_keyed", signNote: "as_printed", unitMultiplier: unit.multiplier, ...unit };
    const instant = isInstantRow(row);
    const matchesByColumn = new Map<number, AnswerKeyMatch[]>();
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const column = columns[columnIndex];
      const printed = row.values[columnIndex];
      if (currentPeriodEnd && column.periodEnd >= currentPeriodEnd) continue;
      if (printed.value === null) continue;
      const scaled = printed.value * unit.multiplier;
      const matches = queryAnswerKey(factIndex, { months: instant ? 0 : column.months, periodEnd: column.periodEnd, printedValue: scaled, raw: printed.raw, multiplier: unit.multiplier, perShare: unit.perShare, shares: unit.shares, percent: unit.percent, releaseDate });
      matchesByColumn.set(columnIndex, matches);
    }
    const conceptColumns = new Map<string, Set<number>>();
    for (const [columnIndex, matches] of matchesByColumn) {
      for (const match of matches) conceptColumns.set(match.concept, new Set([...(conceptColumns.get(match.concept) ?? []), columnIndex]));
    }
    const acceptedConcepts = new Set<string>();
    const evidence: AnswerKeyEvidence[] = [];
    for (const [columnIndex, matches] of matchesByColumn) {
      const raw = row.values[columnIndex].raw;
      const sufficientDigits = significantDigits(raw) >= 3;
      for (const match of matches) {
        if (sufficientDigits || (conceptColumns.get(match.concept)?.size ?? 0) >= 2) {
          acceptedConcepts.add(match.concept);
          evidence.push({ ...match, columnIndex });
        }
      }
    }
    const matchedConcepts = [...acceptedConcepts].sort();
    const values = columns.map((column, columnIndex): NamedValue => ({
      columnIndex,
      sourceCol: row.values[columnIndex].sourceCol,
      months: column.months,
      factMonths: instant ? 0 : column.months,
      instant,
      periodEnd: column.periodEnd,
      current: isCurrentPeriod(column, currentPeriodEnd),
      value: row.values[columnIndex].value === null ? null : row.values[columnIndex].value * unit.multiplier,
      raw: row.values[columnIndex].raw,
      unitMultiplier: unit.multiplier,
      perShare: unit.perShare,
    }));
    const signNote = evidence.some((match) => match.signFlipped) && evidence.some((match) => !match.signFlipped) ? "mixed" : evidence.some((match) => match.signFlipped) ? "flipped" : "as_printed";
    const nameReason = matchedConcepts.length ? null : matchesByColumn.size ? "no_significant_answer_key_match" : "no_comparative_values";
    return { ...row, values, matchedConcepts, evidence, named: matchedConcepts.length > 0, nameReason, signNote, unitMultiplier: unit.multiplier, ...unit };
  });
}

export interface GradeInput {
  valueId: string;
  statement: StatementKind;
  matchedConcepts: string[];
  months: number;
  factMonths?: number;
  instant?: boolean;
  periodEnd: string;
  value: number | null;
  raw: string;
  perShare: boolean;
  shares: boolean;
  percent: boolean;
  unitMultiplier: number;
  signNote: "as_printed" | "flipped" | "mixed";
}

export interface GradeComparison {
  concept: string;
  factValue: number;
  factAccession: string | null;
  factFiled: string | null;
  match: boolean;
}

export interface GradeResult {
  valueId: string;
  statement: StatementKind;
  status: "match" | "mismatch" | "not_gradable";
  reason: string | null;
  releaseValue: number | null;
  factValue: number | null;
  comparisons: GradeComparison[];
}

export function gradeValue(input: GradeInput, index: FactIndex, periodicAccession: string | null, periodicForm: string | null): GradeResult {
  const base = { valueId: input.valueId, statement: input.statement, releaseValue: input.value, comparisons: [] as GradeComparison[] };
  if (!periodicAccession) return { ...base, status: "not_gradable", reason: "release_not_paired", factValue: null };
  if (input.value === null) return { ...base, status: "not_gradable", reason: "missing_printed_value", factValue: null };
  if (input.months === 3 && periodicForm === "10-K" && !input.instant) return { ...base, status: "not_gradable", reason: "fourth_quarter_three_month", factValue: null };
  if (input.signNote === "mixed") return { ...base, status: "not_gradable", reason: "mixed_sign_convention", factValue: null };
  const units = expectedUnits(input.perShare, input.shares, input.percent);
  if (!units.length) return { ...base, status: "not_gradable", reason: "percent_or_ratio_not_graded", factValue: null };
  const tolerance = printedTolerance(input.raw, input.unitMultiplier, input.perShare);
  const factMonths = input.factMonths ?? input.months;
  const comparisons: GradeComparison[] = [];
  for (const concept of input.matchedConcepts) {
    for (let offset = -3; offset <= 3; offset++) {
      const date = previousDate(input.periodEnd, -offset);
      for (const fact of index.byPeriod.get(factMonths)?.get(date) ?? []) {
        if (fact.concept !== concept || fact.accn !== periodicAccession || !units.includes(fact.unit.toLowerCase())) continue;
        const release = input.signNote === "flipped" ? Math.abs(input.value) : input.value;
        const filed = input.signNote === "flipped" ? Math.abs(fact.val) : fact.val;
        comparisons.push({ concept, factValue: fact.val, factAccession: fact.accn, factFiled: fact.filed, match: Math.abs(release - filed) <= tolerance + 1e-9 });
      }
    }
  }
  if (!comparisons.length) return { ...base, status: "not_gradable", reason: "no_such_fact", factValue: null };
  const matches = comparisons.filter((comparison) => comparison.match);
  const factValue = comparisons.length === 1 ? comparisons[0].factValue : null;
  if (new Set(comparisons.map((comparison) => comparison.concept)).size < input.matchedConcepts.length) return { ...base, status: "not_gradable", reason: "incomplete_concept_coverage", factValue, comparisons };
  if (matches.length === comparisons.length) return { ...base, status: "match", reason: null, factValue };
  if (matches.length) return { ...base, status: "match", reason: "multiple_concepts_one_match", factValue: matches.length === 1 ? matches[0].factValue : null, comparisons };
  return { ...base, status: "mismatch", reason: "value_mismatch", factValue, comparisons };
}
