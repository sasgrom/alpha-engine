import { createHash } from "node:crypto";
import { daysBetween, extractCandidateRows, findStatementCandidates, isCurrentPeriod, joinStatementCandidates, parseExhibitHtml, rowUnit, type RawTable, type StatementCandidate, type StatementColumn, type StatementKind, type StatementRow } from "./flash-html";
import { gradeValue, nameStatementRows, type AnswerKeyEvidence, type FactIndex, type GradeResult, type NamedRow } from "./flash-facts";

export interface ReleaseContext {
  cik: number;
  ticker: string;
  accessionNo: string;
  filingDate: string;
  acceptedEt: string | null;
  fiscalPeriodEnd: string | null;
  periodicAccession: string | null;
  periodicForm: string | null;
}

export interface ExhibitInput {
  file: string;
  sha256: string;
  html: string;
}

export interface StatementRecord {
  cik: number;
  ticker: string;
  releaseAccession: string;
  acceptedEt: string | null;
  statement: StatementKind;
  sourceFile: string;
  sourceSha256: string;
  tableIndices: number[];
  title: string;
  units: { multiplier: number; shareMultiplier: number; perShareMultiplier: number };
  columns: (StatementColumn & { current: boolean })[];
  dataRows: number;
  namedRows: number;
  alignedRows: number;
  candidates: {
    sourceFile: string;
    tableIndices: number[];
    title: string;
    score: number;
    namedRows: number;
    dataRows: number;
    alignedRows: number;
    columns: StatementColumn[];
  }[];
  currentPeriodEnd: string | null;
  periodMatch: boolean | null;
}

export interface ValueRecord {
  valueId: string;
  cik: number;
  ticker: string;
  releaseAccession: string;
  acceptedEt: string | null;
  statement: StatementKind;
  rowLabel: string;
  headingPath: string[];
  matchedConcepts: string[];
  months: number;
  factMonths: number;
  instant: boolean;
  periodEnd: string;
  current: boolean;
  value: number | null;
  rawPrinted: string;
  unitMultiplier: number;
  perShare: boolean;
  shares: boolean;
  percent: boolean;
  signNote: NamedRow["signNote"];
  howNamed: "answer_key";
  source: { file: string; sha256: string; tableIndex: number; rowIndex: number; columnIndex: number; sourceCol: number };
  evidence: AnswerKeyEvidence[];
}

export interface ResidualRecord {
  cik: number;
  ticker: string;
  releaseAccession: string;
  acceptedEt: string | null;
  statement: StatementKind;
  rowLabel: string;
  headingPath: string[];
  reason: string;
  rowKind: StatementRow["kind"];
  printedValues: { months: number | null; periodEnd: string | null; raw: string; value: number | null; sourceCol: number }[];
  source: { file: string; sha256: string; tableIndex: number; rowIndex: number };
}

export interface GradeRecord extends GradeResult {
  cik: number;
  ticker: string;
  releaseAccession: string;
  acceptedEt: string | null;
  rowLabel: string;
  headingPath: string[];
  months: number;
  periodEnd: string;
}

export interface ReleaseCoverage {
  income: boolean;
  balance: boolean;
  cashflow: boolean;
  currentPeriodEnd: string | null;
  expectedPeriodEnd: string | null;
  periodMatch: boolean | null;
  periodDeltaDays: number | null;
  exhibits: number;
  tables: number;
  candidates: number;
  dataRows: number;
  namedRows: number;
  values: number;
  grades: number;
  answerKeyFacts: number;
  pitViolations: number;
}

export interface ProcessReleaseResult {
  statements: StatementRecord[];
  values: ValueRecord[];
  grades: GradeRecord[];
  residual: ResidualRecord[];
  coverage: ReleaseCoverage;
  errors: string[];
}

const statementOrder: Record<StatementKind, number> = { income: 0, balance: 1, cashflow: 2 };
const latestColumnDate = (columns: StatementColumn[]) => columns.length ? columns.map((column) => column.periodEnd).sort().at(-1)! : null;

function candidateReport(candidate: StatementCandidate, rows: NamedRow[], currentPeriodEnd: string | null, release: ReleaseContext): StatementRecord {
  const table = candidate.tables[0];
  const unitTable = candidate.tables.find((item) => item.tableIndex === rows.find((row) => row.kind === "data")?.tableIndex) ?? table;
  return {
    cik: release.cik,
    ticker: release.ticker,
    releaseAccession: release.accessionNo,
    acceptedEt: release.acceptedEt,
    statement: candidate.kind,
    sourceFile: table.sourceFile,
    sourceSha256: table.sourceSha256,
    tableIndices: candidate.tables.map((item) => item.tableIndex),
    title: table.title,
    units: { multiplier: unitTable.unitMultiplier, shareMultiplier: unitTable.shareMultiplier, perShareMultiplier: 1 },
    columns: candidate.columns.map((column) => ({ ...column, current: isCurrentPeriod(column, currentPeriodEnd) })),
    dataRows: rows.filter((row) => row.kind === "data").length,
    namedRows: rows.filter((row) => row.named).length,
    alignedRows: rows.filter((row) => row.kind === "data" && row.alignable).length,
    candidates: [],
    currentPeriodEnd,
    periodMatch: currentPeriodEnd && release.fiscalPeriodEnd ? Math.abs(daysBetween(currentPeriodEnd, release.fiscalPeriodEnd)) <= 7 : null,
  };
}

function valueRecord(row: NamedRow, value: NamedRow["values"][number], release: ReleaseContext, kind: StatementKind): ValueRecord {
  const valueId = `${release.cik}|${release.accessionNo}|${kind}|${row.sourceFile}|${row.tableIndex}|${row.rowIndex}|${value.columnIndex}`;
  return {
    valueId,
    cik: release.cik,
    ticker: release.ticker,
    releaseAccession: release.accessionNo,
    acceptedEt: release.acceptedEt,
    statement: kind,
    rowLabel: row.label,
    headingPath: row.headingPath,
    matchedConcepts: row.matchedConcepts,
    months: value.months,
    factMonths: value.factMonths,
    instant: value.instant,
    periodEnd: value.periodEnd,
    current: value.current,
    value: value.value,
    rawPrinted: value.raw,
    unitMultiplier: value.unitMultiplier,
    perShare: value.perShare,
    shares: row.shares,
    percent: row.percent,
    signNote: row.signNote,
    howNamed: "answer_key",
    source: { file: row.sourceFile, sha256: row.sourceSha256, tableIndex: row.tableIndex, rowIndex: row.rowIndex, columnIndex: value.columnIndex, sourceCol: value.sourceCol },
    evidence: value.current ? row.evidence : row.evidence.filter((match) => match.columnIndex === value.columnIndex),
  };
}

function residualRecord(row: NamedRow, original: StatementRow, table: RawTable, release: ReleaseContext, kind: StatementKind, columns: StatementColumn[]): ResidualRecord {
  const unit = rowUnit(original, table);
  return {
    cik: release.cik,
    ticker: release.ticker,
    releaseAccession: release.accessionNo,
    acceptedEt: release.acceptedEt,
    statement: kind,
    rowLabel: original.label,
    headingPath: original.headingPath,
    reason: row.nameReason ?? "no_answer_key",
    rowKind: original.kind,
    printedValues: original.values.map((value, index) => ({
      months: original.alignable && columns[index] ? columns[index].months : null,
      periodEnd: original.alignable && columns[index] ? columns[index].periodEnd : null,
      raw: value.raw,
      value: value.value === null ? null : value.value * unit.multiplier,
      sourceCol: value.sourceCol,
    })),
    source: { file: original.sourceFile, sha256: original.sourceSha256, tableIndex: original.tableIndex, rowIndex: original.rowIndex },
  };
}

function chooseCurrentPeriodEnd(candidates: StatementCandidate[], expectedPeriodEnd: string | null): string | null {
  const income = candidates.filter((candidate) => candidate.kind === "income" && candidate.columns.length);
  if (expectedPeriodEnd) {
    const ranked = income.map((candidate) => {
      const end = latestColumnDate(candidate.columns)!;
      return { end, difference: Math.abs(daysBetween(end, expectedPeriodEnd)), score: candidate.score, sourceFile: candidate.tables[0].sourceFile, tableIndex: candidate.tables[0].tableIndex };
    }).sort((a, b) => a.difference - b.difference || b.score - a.score || a.sourceFile.localeCompare(b.sourceFile) || a.tableIndex - b.tableIndex);
    return ranked[0]?.end ?? null;
  }
  return income.map((candidate) => latestColumnDate(candidate.columns)).filter((date): date is string => date !== null).sort().at(-1) ?? null;
}

export function processRelease(release: ReleaseContext, exhibits: ExhibitInput[], factIndex: FactIndex, errors: string[] = []): ProcessReleaseResult {
  const candidates: StatementCandidate[] = [];
  let tableCount = 0;
  for (const exhibit of exhibits) {
    const tables = parseExhibitHtml(exhibit.html, exhibit.file, exhibit.sha256);
    tableCount += tables.length;
    candidates.push(...findStatementCandidates(tables, release.fiscalPeriodEnd));
  }
  const joined = joinStatementCandidates(candidates).sort((a, b) => statementOrder[a.kind] - statementOrder[b.kind] || a.tables[0].sourceFile.localeCompare(b.tables[0].sourceFile) || a.tables[0].tableIndex - b.tables[0].tableIndex);
  const currentPeriodEnd = chooseCurrentPeriodEnd(joined, release.fiscalPeriodEnd);
  const statements: StatementRecord[] = [];
  const values: ValueRecord[] = [];
  const grades: GradeRecord[] = [];
  const residual: ResidualRecord[] = [];
  let dataRows = 0;
  let namedRows = 0;
  const evidenceKeys = new Set<string>();
  for (const kind of ["income", "balance", "cashflow"] as const) {
    const group = joined.filter((candidate) => candidate.kind === kind);
    if (!group.length) continue;
    const namedCandidates = group.map((candidate) => {
      const rows = extractCandidateRows(candidate);
      const named = candidate.tables.flatMap((table) => nameStatementRows({ rows: rows.filter((row) => row.tableIndex === table.tableIndex), columns: candidate.columns, table, currentPeriodEnd, releaseDate: release.filingDate, factIndex }));
      return { candidate, rows, named, namedCount: named.filter((row) => row.named).length };
    });
    namedCandidates.sort((a, b) => b.namedCount - a.namedCount || b.candidate.score - a.candidate.score || a.candidate.tables[0].sourceFile.localeCompare(b.candidate.tables[0].sourceFile) || a.candidate.tables[0].tableIndex - b.candidate.tables[0].tableIndex);
    const chosen = namedCandidates[0];
    const statement = candidateReport(chosen.candidate, chosen.named, currentPeriodEnd, release);
    statement.candidates = namedCandidates.map(({ candidate, named, namedCount }) => ({
      sourceFile: candidate.tables[0].sourceFile,
      tableIndices: candidate.tables.map((table) => table.tableIndex),
      title: candidate.tables[0].title,
      score: candidate.score,
      namedRows: namedCount,
      dataRows: named.filter((row) => row.kind === "data").length,
      alignedRows: named.filter((row) => row.kind === "data" && row.alignable).length,
      columns: candidate.columns,
    }));
    statements.push(statement);
    dataRows += chosen.named.filter((row) => row.kind === "data").length;
    namedRows += chosen.namedCount;
    for (let index = 0; index < chosen.named.length; index++) {
      const row = chosen.named[index];
      const original = chosen.rows[index];
      if (row.named) {
        for (const evidence of row.evidence) evidenceKeys.add(`${evidence.concept}|${evidence.accn}|${evidence.filed}|${evidence.startDate}|${evidence.endDate}|${evidence.signFlipped}`);
        for (const value of row.values) {
          const record = valueRecord(row, value, release, kind);
          values.push(record);
          if (value.current) {
            const grade = gradeValue({ valueId: record.valueId, statement: kind, matchedConcepts: row.matchedConcepts, months: value.months, factMonths: value.factMonths, instant: value.instant, periodEnd: value.periodEnd, value: value.value, raw: value.raw, perShare: row.perShare, shares: row.shares, percent: row.percent, unitMultiplier: value.unitMultiplier, signNote: row.signNote }, factIndex, release.periodicAccession, release.periodicForm);
            grades.push({ ...grade, cik: release.cik, ticker: release.ticker, releaseAccession: release.accessionNo, acceptedEt: release.acceptedEt, rowLabel: row.label, headingPath: row.headingPath, months: value.months, periodEnd: value.periodEnd });
          }
        }
      } else residual.push(residualRecord(row, original, chosen.candidate.tables.find((table) => table.tableIndex === original.tableIndex) ?? chosen.candidate.tables[0], release, kind, chosen.candidate.columns));
    }
  }
  values.sort((a, b) => statementOrder[a.statement] - statementOrder[b.statement] || a.valueId.localeCompare(b.valueId));
  residual.sort((a, b) => statementOrder[a.statement] - statementOrder[b.statement] || a.source.file.localeCompare(b.source.file) || a.source.tableIndex - b.source.tableIndex || a.source.rowIndex - b.source.rowIndex);
  grades.sort((a, b) => a.valueId.localeCompare(b.valueId));
  const pitViolations = values.reduce((total, row) => total + row.evidence.filter((match) => match.filed >= release.filingDate).length, 0);
  return {
    statements,
    values,
    grades,
    residual,
    coverage: {
      income: statements.some((row) => row.statement === "income"),
      balance: statements.some((row) => row.statement === "balance"),
      cashflow: statements.some((row) => row.statement === "cashflow"),
      currentPeriodEnd,
      expectedPeriodEnd: release.fiscalPeriodEnd,
      periodMatch: currentPeriodEnd && release.fiscalPeriodEnd ? Math.abs(daysBetween(currentPeriodEnd, release.fiscalPeriodEnd)) <= 7 : null,
      periodDeltaDays: currentPeriodEnd && release.fiscalPeriodEnd ? daysBetween(currentPeriodEnd, release.fiscalPeriodEnd) : null,
      exhibits: exhibits.length,
      tables: tableCount,
      candidates: joined.length,
      dataRows,
      namedRows,
      values: values.length,
      grades: grades.length,
      answerKeyFacts: evidenceKeys.size,
      pitViolations,
    },
    errors,
  };
}

export function sourceSha256(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}
