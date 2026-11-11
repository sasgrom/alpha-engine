import { canonicalLabel, parsePrintedNumber } from "./flash-html";
import type { ValueRecord } from "./flash-pipeline";

export interface GoldenAssertion {
  statement: "income" | "balance" | "cashflow";
  label: string;
  months: number;
  periodEnd: string;
  value: number;
  headingContains?: string;
  perShare?: boolean;
}

export interface GoldenDocument {
  id: string;
  cik: number;
  accessionNo: string;
  file: string;
  currentPeriodEnd: string;
  expect: GoldenAssertion[];
}

export function evaluateGolden(values: ValueRecord[], documents: GoldenDocument[]) {
  const documentsResult = documents.map((document) => {
    const rows = values.filter((row) => row.cik === document.cik && row.releaseAccession === document.accessionNo);
    const failed = document.expect.filter((expected) => !rows.some((row) =>
      row.statement === expected.statement &&
      canonicalLabel(row.rowLabel) === canonicalLabel(expected.label) &&
      (!expected.headingContains || canonicalLabel(row.headingPath.join(" ")).includes(canonicalLabel(expected.headingContains))) &&
      row.months === expected.months &&
      row.periodEnd === expected.periodEnd &&
      (!expected.perShare || row.perShare) &&
      Object.is(row.value, expected.value),
    ));
    return { id: document.id, total: document.expect.length, passed: document.expect.length - failed.length, failed };
  });
  const failed = documentsResult.flatMap((document) => document.failed.map((expected) => ({ document: document.id, ...expected })));
  return { total: documentsResult.reduce((total, document) => total + document.total, 0), passed: documentsResult.reduce((total, document) => total + document.passed, 0), failed, documents: documentsResult };
}

export function auditPrintedValues(values: ValueRecord[]) {
  const violations = values.flatMap((row) => {
    const printed = parsePrintedNumber(row.rawPrinted);
    if (!printed) return [{ valueId: row.valueId, reason: "unparseable_printed_value", raw: row.rawPrinted, value: row.value }];
    const expected = printed.value === null ? null : printed.value * row.unitMultiplier;
    if (expected === null || row.value === null ? expected !== row.value : Math.abs(expected - row.value) > 1e-6) return [{ valueId: row.valueId, reason: "value_not_derived_from_print", raw: row.rawPrinted, expected, value: row.value, unitMultiplier: row.unitMultiplier }];
    return [];
  });
  return { total: values.length, violations };
}

export function auditAnswerKeyDates(values: ValueRecord[], releaseDates: Map<string, string>) {
  const evidence = new Set<string>();
  const violations: { valueId: string; filed: string; releaseDate: string }[] = [];
  for (const row of values) {
    const releaseDate = releaseDates.get(row.releaseAccession);
    for (const match of row.evidence) {
      evidence.add(`${match.concept}|${match.accn}|${match.filed}|${match.startDate}|${match.endDate}|${match.signFlipped}`);
      if (!releaseDate || match.filed >= releaseDate) violations.push({ valueId: row.valueId, filed: match.filed, releaseDate: releaseDate ?? "missing" });
    }
  }
  return { facts: evidence.size, violations };
}
