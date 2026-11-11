import { auditAnswerKeyDates, auditPrintedValues, evaluateGolden, type GoldenDocument } from "./flash-golden";
import type { ProcessReleaseResult, ReleaseContext } from "./flash-pipeline";

const ratio = (part: number, total: number) => total ? part / total : null;
const byName = <T extends string>(values: T[]) => [...new Set(values)].sort();

interface GroupInput {
  releases: ReleaseContext[];
  results: ProcessReleaseResult[];
}

function coverage(entries: GroupInput) {
  const releases = entries.releases.length;
  const income = entries.results.filter((result) => result.coverage.income).length;
  const balance = entries.results.filter((result) => result.coverage.balance).length;
  const cashflow = entries.results.filter((result) => result.coverage.cashflow).length;
  const periodTotal = entries.results.filter((result) => result.coverage.income && result.coverage.expectedPeriodEnd !== null).length;
  const periodMatched = entries.results.filter((result) => result.coverage.income && result.coverage.expectedPeriodEnd !== null && result.coverage.periodMatch === true).length;
  const periodUnpaired = entries.results.filter((result) => result.coverage.income && result.coverage.expectedPeriodEnd === null).length;
  return { releases, income, balance, cashflow, incomeShare: ratio(income, releases), balanceShare: ratio(balance, releases), cashflowShare: ratio(cashflow, releases), periodTotal, periodMatched, periodUnpaired, periodShare: ratio(periodMatched, periodTotal) };
}

function naming(entries: GroupInput) {
  const dataRows = entries.results.reduce((total, result) => total + result.coverage.dataRows, 0);
  const namedRows = entries.results.reduce((total, result) => total + result.coverage.namedRows, 0);
  return { dataRows, namedRows, share: ratio(namedRows, dataRows), values: entries.results.reduce((total, result) => total + result.values.length, 0), residual: entries.results.reduce((total, result) => total + result.residual.length, 0) };
}

function grading(entries: GroupInput) {
  const grades = entries.results.flatMap((result) => result.grades);
  const matches = grades.filter((grade) => grade.status === "match").length;
  const mismatches = grades.filter((grade) => grade.status === "mismatch").length;
  const gradable = matches + mismatches;
  const notGradable = grades.filter((grade) => grade.status === "not_gradable").length;
  return { gradable, matches, mismatches, matchShare: ratio(matches, gradable), notGradable, total: grades.length };
}

function groups(releases: ReleaseContext[], results: ProcessReleaseResult[], key: "year" | "company") {
  const keys = byName(releases.map((release) => key === "year" ? release.filingDate.slice(0, 4) : release.ticker));
  return Object.fromEntries(keys.map((value) => {
    const selected = releases.map((release, index) => ({ release, result: results[index] })).filter(({ release }) => (key === "year" ? release.filingDate.slice(0, 4) : release.ticker) === value);
    return [value, { releases: selected.map((entry) => entry.release), results: selected.map((entry) => entry.result) }];
  }));
}

function namingByStatement(releases: ReleaseContext[], results: ProcessReleaseResult[], key: "year" | "company") {
  return Object.fromEntries(Object.entries(groups(releases, results, key)).map(([group, entries]) => [group, Object.fromEntries((["income", "balance", "cashflow"] as const).map((statement) => {
    const rows = entries.results.flatMap((result) => result.statements.filter((row) => row.statement === statement));
    const dataRows = rows.reduce((total, row) => total + row.dataRows, 0);
    const namedRows = rows.reduce((total, row) => total + row.namedRows, 0);
    return [statement, { dataRows, namedRows, share: ratio(namedRows, dataRows) }];
  }))]));
}

export function buildFlashSummary(options: {
  releases: ReleaseContext[];
  results: ProcessReleaseResult[];
  generatedAt: string;
  codeCommit: string;
  codeHash: string;
  goldenDocuments: GoldenDocument[];
  run: { expectedReleases: number; cacheHits: number; processedThisRun: number; exhibits: number; duplicateExhibits: number; missingExhibitReleases: number };
  artifacts: Record<string, { path: string; bytes: number; sha256: string }>;
}) {
  const { releases, results } = options;
  const values = results.flatMap((result) => result.values);
  const releaseDates = new Map(releases.map((release) => [release.accessionNo, release.filingDate]));
  const companyGroups = groups(releases, results, "company");
  const mismatchMap = new Map<string, { pattern: string; count: number; example: unknown }>();
  for (const result of results) {
    for (const grade of result.grades.filter((row) => row.status === "mismatch")) {
      const concepts = grade.comparisons.map((comparison) => comparison.concept).sort().join(",") || "no_comparison";
      const pattern = `${grade.statement}|${grade.reason}|${concepts}`;
      const example = { valueId: grade.valueId, ticker: grade.ticker, releaseAccession: grade.releaseAccession, rowLabel: grade.rowLabel, releaseValue: grade.releaseValue, comparisons: grade.comparisons };
      const current = mismatchMap.get(pattern);
      if (current) current.count++;
      else mismatchMap.set(pattern, { pattern, count: 1, example });
    }
  }
  const errors = results.flatMap((result, index) => result.errors.map((error) => ({ ticker: releases[index].ticker, releaseAccession: releases[index].accessionNo, error })));
  const periodMismatches = results.flatMap((result, index) => result.coverage.income && result.coverage.expectedPeriodEnd !== null && result.coverage.periodMatch !== true ? [{ ticker: releases[index].ticker, releaseAccession: releases[index].accessionNo, expectedPeriodEnd: result.coverage.expectedPeriodEnd, actualPeriodEnd: result.coverage.currentPeriodEnd, deltaDays: result.coverage.periodDeltaDays }] : []);
  const notGradableReasons = new Map<string, number>();
  for (const result of results) for (const grade of result.grades) if (grade.status === "not_gradable") notGradableReasons.set(grade.reason ?? "unknown", (notGradableReasons.get(grade.reason ?? "unknown") ?? 0) + 1);
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    codeCommit: options.codeCommit,
    codeHash: options.codeHash,
    run: { ...options.run, processedReleases: results.length, errors: errors.length },
    coverage: {
      overall: coverage({ releases, results }),
      byYear: Object.fromEntries(Object.entries(groups(releases, results, "year")).map(([key, entries]) => [key, coverage(entries)])),
      byCompany: Object.fromEntries(Object.entries(companyGroups).map(([key, entries]) => [key, coverage(entries)])),
      companiesWithoutStatements: Object.entries(companyGroups).filter(([, entries]) => entries.results.every((result) => !result.statements.length)).map(([ticker]) => ticker),
      companiesWithoutIncome: Object.entries(companyGroups).filter(([, entries]) => entries.results.every((result) => !result.coverage.income)).map(([ticker]) => ticker),
      companiesWithoutBalance: Object.entries(companyGroups).filter(([, entries]) => entries.results.every((result) => !result.coverage.balance)).map(([ticker]) => ticker),
      companiesWithoutCashflow: Object.entries(companyGroups).filter(([, entries]) => entries.results.every((result) => !result.coverage.cashflow)).map(([ticker]) => ticker),
    },
    naming: { overall: naming({ releases, results }), byStatementByYear: namingByStatement(releases, results, "year"), byStatementByCompany: namingByStatement(releases, results, "company") },
    periods: { overall: coverage({ releases, results }), mismatches: periodMismatches },
    grades: {
      overall: grading({ releases, results }),
      byYear: Object.fromEntries(Object.entries(groups(releases, results, "year")).map(([key, entries]) => [key, grading(entries)])),
      byCompany: Object.fromEntries(Object.entries(companyGroups).map(([key, entries]) => [key, grading(entries)])),
      mismatchPatterns: [...mismatchMap.values()].sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)).slice(0, 30),
      notGradableReasons: Object.fromEntries([...notGradableReasons.entries()].sort(([a], [b]) => a.localeCompare(b))),
    },
    golden: evaluateGolden(values, options.goldenDocuments),
    pointInTime: { printedValues: auditPrintedValues(values), answerKeyFacts: auditAnswerKeyDates(values, releaseDates) },
    errors,
    artifacts: options.artifacts,
    knownLimits: [
      "Only HTML EX-99 exhibits in the local cache are processed; page images and 8-K-body text are out of scope",
      "Non-GAAP, guidance, segment and comparison/change tables are excluded",
      "Rows without a supported answer-key match remain in residual.jsonl; percent/ratio rows are not answer-keyed in this version",
      "Fourth-quarter three-month values and releases without a periodic pairing are not gradable",
      "No model calls, production writes or schema changes",
    ],
  };
}


interface GroupTotals {
  coverage: { releases: number; income: number; balance: number; cashflow: number; periodTotal: number; periodMatched: number; periodUnpaired: number };
  naming: { dataRows: number; namedRows: number; values: number; residual: number };
  grading: { gradable: number; matches: number; mismatches: number; notGradable: number; total: number };
}

const emptyGroup = (): GroupTotals => ({
  coverage: { releases: 0, income: 0, balance: 0, cashflow: 0, periodTotal: 0, periodMatched: 0, periodUnpaired: 0 },
  naming: { dataRows: 0, namedRows: 0, values: 0, residual: 0 },
  grading: { gradable: 0, matches: 0, mismatches: 0, notGradable: 0, total: 0 },
});

function addGroup(target: GroupTotals, source: GroupInput): void {
  const coverageValue = coverage(source);
  const namingValue = naming(source);
  const gradingValue = grading(source);
  target.coverage.releases += coverageValue.releases;
  target.coverage.income += coverageValue.income;
  target.coverage.balance += coverageValue.balance;
  target.coverage.cashflow += coverageValue.cashflow;
  target.coverage.periodTotal += coverageValue.periodTotal;
  target.coverage.periodMatched += coverageValue.periodMatched;
  target.coverage.periodUnpaired += coverageValue.periodUnpaired;
  target.naming.dataRows += namingValue.dataRows;
  target.naming.namedRows += namingValue.namedRows;
  target.naming.values += namingValue.values;
  target.naming.residual += namingValue.residual;
  target.grading.gradable += gradingValue.gradable;
  target.grading.matches += gradingValue.matches;
  target.grading.mismatches += gradingValue.mismatches;
  target.grading.notGradable += gradingValue.notGradable;
  target.grading.total += gradingValue.total;
}

function finishGroup(group: GroupTotals) {
  return {
    coverage: {
      ...group.coverage,
      incomeShare: ratio(group.coverage.income, group.coverage.releases),
      balanceShare: ratio(group.coverage.balance, group.coverage.releases),
      cashflowShare: ratio(group.coverage.cashflow, group.coverage.releases),
      periodShare: ratio(group.coverage.periodMatched, group.coverage.periodTotal),
    },
    naming: { ...group.naming, share: ratio(group.naming.namedRows, group.naming.dataRows) },
    grading: { ...group.grading, matchShare: ratio(group.grading.matches, group.grading.gradable) },
  };
}

export function buildFlashSummaryStreaming(options: {
  releases: ReleaseContext[];
  readResult: (release: ReleaseContext) => ProcessReleaseResult;
  generatedAt: string;
  codeCommit: string;
  codeHash: string;
  goldenDocuments: GoldenDocument[];
  run: { expectedReleases: number; cacheHits: number; processedThisRun: number; exhibits: number; duplicateExhibits: number; missingExhibitReleases: number };
  artifacts: Record<string, { path: string; bytes: number; sha256: string }>;
}) {
  const overall = emptyGroup();
  const byYear = new Map<string, GroupTotals>();
  const byCompany = new Map<string, GroupTotals>();
  const statementByYear = new Map<string, Map<string, { dataRows: number; namedRows: number }>>();
  const statementByCompany = new Map<string, Map<string, { dataRows: number; namedRows: number }>>();
  const hasStatements = new Map<string, { any: boolean; income: boolean; balance: boolean; cashflow: boolean }>();
  const mismatchMap = new Map<string, { pattern: string; count: number; example: unknown }>();
  const notGradableReasons = new Map<string, number>();
  const periodMismatches: unknown[] = [];
  const errors: unknown[] = [];
  const goldenAccessions = new Set(options.goldenDocuments.map((document) => `${document.cik}|${document.accessionNo}`));
  const goldenValues: ProcessReleaseResult["values"] = [];
  const answerKeyFacts = new Set<string>();
  const answerKeyViolations: unknown[] = [];
  const printedViolations: unknown[] = [];
  let printedTotal = 0;
  for (const release of options.releases) {
    const result = options.readResult(release);
    const single = { releases: [release], results: [result] };
    addGroup(overall, single);
    const year = release.filingDate.slice(0, 4);
    const yearGroup = byYear.get(year) ?? emptyGroup();
    addGroup(yearGroup, single);
    byYear.set(year, yearGroup);
    const companyGroup = byCompany.get(release.ticker) ?? emptyGroup();
    addGroup(companyGroup, single);
    byCompany.set(release.ticker, companyGroup);
    const has = hasStatements.get(release.ticker) ?? { any: false, income: false, balance: false, cashflow: false };
    has.any ||= result.statements.length > 0;
    has.income ||= result.coverage.income;
    has.balance ||= result.coverage.balance;
    has.cashflow ||= result.coverage.cashflow;
    hasStatements.set(release.ticker, has);
    for (const statement of result.statements) {
      const yearStatements = statementByYear.get(year) ?? new Map([["income", { dataRows: 0, namedRows: 0 }], ["balance", { dataRows: 0, namedRows: 0 }], ["cashflow", { dataRows: 0, namedRows: 0 }]]);
      const yearStatement = yearStatements.get(statement.statement) ?? { dataRows: 0, namedRows: 0 };
      yearStatement.dataRows += statement.dataRows;
      yearStatement.namedRows += statement.namedRows;
      yearStatements.set(statement.statement, yearStatement);
      statementByYear.set(year, yearStatements);
      const companyStatements = statementByCompany.get(release.ticker) ?? new Map([["income", { dataRows: 0, namedRows: 0 }], ["balance", { dataRows: 0, namedRows: 0 }], ["cashflow", { dataRows: 0, namedRows: 0 }]]);
      const companyStatement = companyStatements.get(statement.statement) ?? { dataRows: 0, namedRows: 0 };
      companyStatement.dataRows += statement.dataRows;
      companyStatement.namedRows += statement.namedRows;
      companyStatements.set(statement.statement, companyStatement);
      statementByCompany.set(release.ticker, companyStatements);
    }
    for (const grade of result.grades) {
      if (grade.status === "not_gradable") notGradableReasons.set(grade.reason ?? "unknown", (notGradableReasons.get(grade.reason ?? "unknown") ?? 0) + 1);
      if (grade.status !== "mismatch") continue;
      const concepts = grade.comparisons.map((comparison) => comparison.concept).sort().join(",") || "no_comparison";
      const pattern = `${grade.statement}|${grade.reason}|${concepts}`;
      const example = { valueId: grade.valueId, ticker: grade.ticker, releaseAccession: grade.releaseAccession, rowLabel: grade.rowLabel, releaseValue: grade.releaseValue, comparisons: grade.comparisons };
      const current = mismatchMap.get(pattern);
      if (current) current.count++;
      else mismatchMap.set(pattern, { pattern, count: 1, example });
    }
    if (result.coverage.income && result.coverage.expectedPeriodEnd !== null && result.coverage.periodMatch !== true) periodMismatches.push({ ticker: release.ticker, releaseAccession: release.accessionNo, expectedPeriodEnd: result.coverage.expectedPeriodEnd, actualPeriodEnd: result.coverage.currentPeriodEnd, deltaDays: result.coverage.periodDeltaDays });
    errors.push(...result.errors.map((error) => ({ ticker: release.ticker, releaseAccession: release.accessionNo, error })));
    const printed = auditPrintedValues(result.values);
    printedTotal += printed.total;
    printedViolations.push(...printed.violations);
    const dates = auditAnswerKeyDates(result.values, new Map([[release.accessionNo, release.filingDate]]));
    for (const match of result.values.flatMap((row) => row.evidence)) answerKeyFacts.add(`${match.concept}|${match.accn}|${match.filed}|${match.startDate}|${match.endDate}|${match.signFlipped}`);
    answerKeyViolations.push(...dates.violations);
    if (goldenAccessions.has(`${release.cik}|${release.accessionNo}`)) goldenValues.push(...result.values);
  }
  const finalOverall = finishGroup(overall);
  const finishMap = (input: Map<string, GroupTotals>) => Object.fromEntries([...input.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, finishGroup(value).coverage]));
  const finishStatementMap = (input: Map<string, Map<string, { dataRows: number; namedRows: number }>>) => Object.fromEntries([...input.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, statements]) => [key, Object.fromEntries([...statements.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([statement, value]) => [statement, { ...value, share: ratio(value.namedRows, value.dataRows) }]))]));
  const companyHasNo = (key: "any" | "income" | "balance" | "cashflow") => [...hasStatements.entries()].filter(([, value]) => !value[key]).map(([ticker]) => ticker).sort();
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    codeCommit: options.codeCommit,
    codeHash: options.codeHash,
    run: { ...options.run, processedReleases: options.releases.length, errors: errors.length },
    coverage: {
      overall: finalOverall.coverage,
      byYear: finishMap(byYear),
      byCompany: finishMap(byCompany),
      companiesWithoutStatements: companyHasNo("any"),
      companiesWithoutIncome: companyHasNo("income"),
      companiesWithoutBalance: companyHasNo("balance"),
      companiesWithoutCashflow: companyHasNo("cashflow"),
    },
    naming: { overall: finalOverall.naming, byStatementByYear: finishStatementMap(statementByYear), byStatementByCompany: finishStatementMap(statementByCompany) },
    periods: { overall: finalOverall.coverage, mismatches: periodMismatches },
    grades: {
      overall: finalOverall.grading,
      byYear: Object.fromEntries([...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => [key, finishGroup(group).grading])),
      byCompany: Object.fromEntries([...byCompany.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => [key, finishGroup(group).grading])),
      mismatchPatterns: [...mismatchMap.values()].sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)).slice(0, 30),
      notGradableReasons: Object.fromEntries([...notGradableReasons.entries()].sort(([a], [b]) => a.localeCompare(b))),
    },
    golden: evaluateGolden(goldenValues, options.goldenDocuments),
    pointInTime: { printedValues: { total: printedTotal, violations: printedViolations }, answerKeyFacts: { facts: answerKeyFacts.size, violations: answerKeyViolations } },
    errors,
    artifacts: options.artifacts,
    knownLimits: [
      "Only HTML EX-99 exhibits in the local cache are processed; page images and 8-K-body text are out of scope",
      "Non-GAAP, guidance, segment and comparison/change tables are excluded",
      "Rows without a supported answer-key match remain in residual.jsonl; percent/ratio rows are not answer-keyed in this version",
      "Fourth-quarter three-month values and releases without a periodic pairing are not gradable",
      "No model calls, production writes or schema changes",
    ],
  };
}
