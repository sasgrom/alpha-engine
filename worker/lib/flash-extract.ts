import type { ProcessReleaseResult, ReleaseContext, ValueRecord } from "./flash-pipeline";

const METRICS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "SalesRevenueGoodsNet"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  epsDiluted: ["EarningsPerShareDiluted"],
  operatingIncome: ["OperatingIncomeLoss"],
} as const;

type MetricName = keyof typeof METRICS;

interface SelectedMetric {
  concept: string;
  current: ValueRecord;
  yearAgo: ValueRecord | null;
  grade: string | null;
}

const days = (left: string, right: string) => Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86400000);
const shiftYear = (date: string, years: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() + years);
  return value.toISOString().slice(0, 10);
};
const rowKey = (value: ValueRecord) => `${value.source.file}|${value.source.tableIndex}|${value.source.rowIndex}`;

function selectMetric(result: ProcessReleaseResult, release: ReleaseContext, concepts: readonly string[]): SelectedMetric | null {
  const expected = result.coverage.currentPeriodEnd ?? release.fiscalPeriodEnd;
  const rows = new Map<string, ValueRecord[]>();
  for (const value of result.values) {
    if (value.statement !== "income" || value.instant || value.months !== 3 || value.value === null) continue;
    rows.set(rowKey(value), [...(rows.get(rowKey(value)) ?? []), value]);
  }
  const grades = new Map(result.grades.map((grade) => [grade.valueId, grade.status]));
  for (const concept of concepts) {
    const candidates: { current: ValueRecord; yearAgo: ValueRecord | null }[] = [];
    for (const values of rows.values()) {
      if (!values.some((value) => value.matchedConcepts.includes(concept))) continue;
      for (const current of values) {
        if (!current.current || (expected && Math.abs(days(expected, current.periodEnd)) > 7)) continue;
        const expectedYearAgo = shiftYear(current.periodEnd, -1);
        const yearAgo = values.find((value) => !value.current && Math.abs(days(expectedYearAgo, value.periodEnd)) <= 10) ?? null;
        candidates.push({ current, yearAgo });
      }
    }
    candidates.sort((a, b) => Number(b.yearAgo !== null) - Number(a.yearAgo !== null) || a.current.valueId.localeCompare(b.current.valueId));
    const selected = candidates[0];
    if (selected) return { concept, ...selected, grade: grades.get(selected.current.valueId) ?? null };
  }
  return null;
}

export function flashQuarterRecord(release: ReleaseContext, result: ProcessReleaseResult): Record<string, unknown> {
  const selected = Object.fromEntries(Object.entries(METRICS).map(([name, concepts]) => [name, selectMetric(result, release, concepts)])) as Record<MetricName, SelectedMetric | null>;
  const currentPeriod = selected.revenue?.current.periodEnd ?? selected.netIncome?.current.periodEnd ?? selected.epsDiluted?.current.periodEnd ?? selected.operatingIncome?.current.periodEnd ?? release.fiscalPeriodEnd;
  const record: Record<string, unknown> = {
    cik: release.cik,
    ticker: release.ticker,
    accession: release.accessionNo,
    acceptedEt: release.acceptedEt,
    fiscalPeriodEnd: release.fiscalPeriodEnd,
    periodEnd: currentPeriod,
  };
  for (const name of Object.keys(METRICS) as MetricName[]) {
    const metric = selected[name];
    record[name] = metric?.current.value ?? null;
    record[`${name}YearAgo`] = metric?.yearAgo?.value ?? null;
    record[`${name}Concept`] = metric?.concept ?? null;
    record[`${name}YearAgoConcept`] = metric?.yearAgo ? metric.concept : null;
    record[`${name}Grade`] = metric?.grade ?? null;
    record[`${name}YearAgoGrade`] = null;
    record[`${name}Evidence`] = metric ? {
      rawPrinted: metric.current.rawPrinted,
      source: metric.current.source,
      yearAgoRawPrinted: metric.yearAgo?.rawPrinted ?? null,
      yearAgoSource: metric.yearAgo?.source ?? null,
    } : null;
  }
  return record;
}

interface ExtractGroup {
  releases: number;
  revenue: number;
  revenueYearAgo: number;
  revenueGradable: number;
  revenueMatches: number;
}

const emptyGroup = (): ExtractGroup => ({ releases: 0, revenue: 0, revenueYearAgo: 0, revenueGradable: 0, revenueMatches: 0 });
const ratio = (part: number, total: number) => total ? part / total : null;

function finishGroup(group: ExtractGroup) {
  return {
    ...group,
    revenueShare: ratio(group.revenue, group.releases),
    revenueYearAgoShare: ratio(group.revenueYearAgo, group.releases),
    revenueGradeMatchShare: ratio(group.revenueMatches, group.revenueGradable),
    revenueMatchReleaseShare: ratio(group.revenueMatches, group.releases),
  };
}

export function buildFlashExtractSummary(options: {
  releases: ReleaseContext[];
  readResult: (release: ReleaseContext) => ProcessReleaseResult;
  sectorByCik: Map<number, string>;
}) {
  const overall = emptyGroup();
  const byYear = new Map<string, ExtractGroup>();
  const bySector = new Map<string, ExtractGroup>();
  const byCompany = new Map<string, ExtractGroup>();
  for (const release of options.releases) {
    const record = flashQuarterRecord(release, options.readResult(release));
    const groups = [overall];
    for (const [map, key] of [[byYear, release.filingDate.slice(0, 4)], [bySector, options.sectorByCik.get(release.cik) ?? "Unclassified"], [byCompany, release.ticker]] as const) {
      const group = map.get(key) ?? emptyGroup();
      groups.push(group);
      map.set(key, group);
    }
    for (const group of groups) {
      group.releases++;
      if (typeof record.revenue === "number") group.revenue++;
      if (typeof record.revenueYearAgo === "number") group.revenueYearAgo++;
      if (record.revenueGrade === "match" || record.revenueGrade === "mismatch") group.revenueGradable++;
      if (record.revenueGrade === "match") group.revenueMatches++;
    }
  }
  const finishMap = (input: Map<string, ExtractGroup>) => Object.fromEntries([...input.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, finishGroup(value)]));
  return { overall: finishGroup(overall), byYear: finishMap(byYear), bySector: finishMap(bySector), byCompany: finishMap(byCompany) };
}
