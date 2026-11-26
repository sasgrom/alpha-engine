export interface AvQuarter {
  periodEnd: string;
  reportedDate: string;
  reportedEPS: number | null;
  reportTime: string | null;
  source: { file: string; sha256: string };
}
export interface AdjustedFigure {
  value: number;
  grade: string;
  acceptedEt: string;
  accession: string;
  source: Record<string, unknown>;
}
export interface GaapFigure {
  value: number;
  filed: string;
  source: Record<string, unknown>;
}
export interface ReleaseFiling {
  acceptedEt: string;
  accessionNo: string;
}
export interface SplitEvent { date: string; ratio: number }

export interface EpsComparison {
  periodEnd: string;
  ourPeriodEnd: string;
  periodDistanceDays: number;
  matchType: "exact" | "near";
  series: "adjusted" | "gaap";
  alphaVantage: number;
  ours: number;
  oursRestated: number;
  splitFactor: number;
  originalMatch: boolean;
  restatedMatch: boolean;
  bestMatch: boolean;
  alphaSource: AvQuarter["source"];
  ourSource: Record<string, unknown>;
  grade?: string;
}
export interface DateCheck {
  periodEnd: string;
  reportedDate: string;
  reportTime: string | null;
  releaseDate: string | null;
  acceptedEt: string | null;
  accessionNo: string | null;
  dateMatch: boolean;
  timeMatch: boolean | null;
  nearestRelease: ReleaseFiling | null;
  nearestReleaseDate: string | null;
  dateOffsetDays: number | null;
  releaseTimeBand: "pre-market" | "market-hours" | "post-market" | null;
  nextSessionPostCloseConvention: boolean;
  coverage: "within-10-days" | "outside-coverage";
  coverageReason: "before-calendar" | "after-calendar" | "gap" | null;
  alphaSource: AvQuarter["source"];
}
export interface OneSidedQuarter {
  periodEnd: string;
  side: "alphaVantage" | "ours";
  reason: "av-before-ours" | "av-after-ours" | "ours-before-av" | "ours-after-av" | "true-gap";
  ourSources: string[];
  alphaSource?: AvQuarter["source"];
}
export interface CompanyCheck {
  cik: number;
  ticker: string;
  comparisons: EpsComparison[];
  exactComparisons: EpsComparison[];
  disagreements: EpsComparison[];
  dateChecks: DateCheck[];
  dateDisagreements: DateCheck[];
  oneSided: OneSidedQuarter[];
  oneSidedExact: OneSidedQuarter[];
  basis: ReturnType<typeof inferBasis>;
}

export function epsAgree(alpha: number, ours: number): boolean {
  const difference = Math.abs(alpha - ours);
  return difference <= 0.01 + 1e-12 || difference <= Math.abs(ours) * 0.01 + 1e-12;
}

export function splitFactorAfter(date: string, splits: SplitEvent[]): number {
  return splits.filter(split => split.date > date.slice(0, 10) && Number.isFinite(split.ratio) && split.ratio > 0).reduce((product, split) => product * split.ratio, 1);
}

export function newYorkDate(value: string): string {
  const local = value.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/);
  if (local) return local[1];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid release timestamp: ${value.slice(0, 50)}`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function acceptanceSession(acceptedEt: string): "pre-market" | "market-hours" | "post-market" {
  const local = acceptedEt.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
  const minutes = local ? Number(local[1]) * 60 + Number(local[2]) : (() => {
    const date = new Date(acceptedEt);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid acceptance timestamp: ${acceptedEt.slice(0, 50)}`);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    return Number(parts.find(part => part.type === "hour")?.value) * 60 + Number(parts.find(part => part.type === "minute")?.value);
  })();
  if (minutes < 9 * 60 + 30) return "pre-market";
  if (minutes >= 16 * 60) return "post-market";
  return "market-hours";
}

export function reportTimeAgrees(reportTime: string | null, acceptedEt: string | null): boolean | null {
  if (!acceptedEt || !reportTime || !["pre-market", "post-market"].includes(reportTime)) return null;
  return acceptanceSession(acceptedEt) === reportTime;
}

function compareSeries(av: AvQuarter[], ours: Map<string, AdjustedFigure | GaapFigure>, series: "adjusted" | "gaap", splits: SplitEvent[]): EpsComparison[] {
  const candidates = av.filter(quarter => quarter.reportedEPS !== null).flatMap(quarter => [...ours].map(([periodEnd, figure]) => ({
    quarter,
    periodEnd,
    figure,
    distance: Math.abs(Date.parse(`${quarter.periodEnd}T00:00:00Z`) - Date.parse(`${periodEnd}T00:00:00Z`)) / 86_400_000,
  }))).filter(row => row.distance <= 10).sort((a, b) => a.distance - b.distance || a.quarter.periodEnd.localeCompare(b.periodEnd) || a.periodEnd.localeCompare(b.periodEnd));
  const usedAv = new Set<string>(), usedOurs = new Set<string>(), out: EpsComparison[] = [];
  for (const candidate of candidates) {
    const { quarter, periodEnd, figure, distance } = candidate;
    if (usedAv.has(quarter.periodEnd) || usedOurs.has(periodEnd)) continue;
    usedAv.add(quarter.periodEnd);
    usedOurs.add(periodEnd);
    const sourceDate = series === "adjusted" ? (figure as AdjustedFigure).acceptedEt : (figure as GaapFigure).filed;
    const factor = splitFactorAfter(sourceDate, splits);
    const restated = figure.value / factor;
    const originalMatch = epsAgree(quarter.reportedEPS!, figure.value);
    const restatedMatch = epsAgree(quarter.reportedEPS!, restated);
    out.push({
      periodEnd: quarter.periodEnd,
      ourPeriodEnd: periodEnd,
      periodDistanceDays: distance,
      matchType: distance === 0 ? "exact" : "near",
      series,
      alphaVantage: quarter.reportedEPS!,
      ours: figure.value,
      oursRestated: restated,
      splitFactor: factor,
      originalMatch,
      restatedMatch,
      bestMatch: originalMatch || restatedMatch,
      alphaSource: quarter.source,
      ourSource: figure.source,
      ...(series === "adjusted" ? { grade: (figure as AdjustedFigure).grade } : {}),
    });
  }
  return out.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

export function inferBasis(comparisons: EpsComparison[]) {
  const adjusted = comparisons.filter(row => row.series === "adjusted" && row.splitFactor !== 1);
  const affected = adjusted.length ? adjusted : comparisons.filter(row => row.series === "gaap" && row.splitFactor !== 1);
  const summarize = (rows: EpsComparison[]) => ({
    comparable: rows.length,
    splitAffected: rows.filter(row => row.splitFactor !== 1).length,
    originalAgreements: rows.filter(row => row.originalMatch).length,
    restatedAgreements: rows.filter(row => row.restatedMatch).length,
    originalShare: rows.length ? rows.filter(row => row.originalMatch).length / rows.length : null,
    restatedShare: rows.length ? rows.filter(row => row.restatedMatch).length / rows.length : null,
  });
  const originalShare = affected.length ? affected.filter(row => row.originalMatch).length / affected.length : null;
  const restatedShare = affected.length ? affected.filter(row => row.restatedMatch).length / affected.length : null;
  let inferred: "restated" | "as reported" | "mixed" | "indistinguishable" = "indistinguishable";
  if (affected.length) {
    if (restatedShare! >= 0.8 && restatedShare! > originalShare!) inferred = "restated";
    else if (originalShare! >= 0.8 && originalShare! > restatedShare!) inferred = "as reported";
    else if (originalShare !== restatedShare) inferred = "mixed";
  }
  return { inferred, basisSeries: adjusted.length ? "adjusted" : "gaap", splitAffected: summarize(affected), adjusted: summarize(comparisons.filter(row => row.series === "adjusted")), gaap: summarize(comparisons.filter(row => row.series === "gaap")) };
}

function checkDates(av: AvQuarter[], releases: ReleaseFiling[], sessions: string[]): DateCheck[] {
  return av.map(quarter => {
    const ordered = [...releases].sort((a, b) => a.acceptedEt.localeCompare(b.acceptedEt));
    const near = ordered.map(row => ({ row, days: Math.abs(Date.parse(`${newYorkDate(row.acceptedEt)}T00:00:00Z`) - Date.parse(`${quarter.reportedDate}T00:00:00Z`)) / 86_400_000 })).filter(item => item.days <= 10).sort((a, b) => a.days - b.days || a.row.acceptedEt.localeCompare(b.row.acceptedEt));
    const selected = near[0]?.row ?? null;
    const nearestDate = selected ? newYorkDate(selected.acceptedEt) : null;
    const band = selected ? acceptanceSession(selected.acceptedEt) : null;
    const nextSession = nearestDate ? sessions.find(date => date > nearestDate) ?? new Date(Date.parse(`${nearestDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null;
    const firstDate = ordered.length ? newYorkDate(ordered[0].acceptedEt) : null;
    const lastDate = ordered.length ? newYorkDate(ordered.at(-1)!.acceptedEt) : null;
    return {
      periodEnd: quarter.periodEnd,
      reportedDate: quarter.reportedDate,
      reportTime: quarter.reportTime,
      releaseDate: nearestDate,
      acceptedEt: selected?.acceptedEt ?? null,
      accessionNo: selected?.accessionNo ?? null,
      dateMatch: nearestDate === quarter.reportedDate,
      timeMatch: reportTimeAgrees(quarter.reportTime, selected?.acceptedEt ?? null),
      nearestRelease: selected,
      nearestReleaseDate: nearestDate,
      dateOffsetDays: nearestDate ? (Date.parse(`${quarter.reportedDate}T00:00:00Z`) - Date.parse(`${nearestDate}T00:00:00Z`)) / 86_400_000 : null,
      releaseTimeBand: band,
      nextSessionPostCloseConvention: Boolean(selected) && band === "post-market" && quarter.reportedDate === nextSession,
      coverage: selected ? "within-10-days" : "outside-coverage",
      coverageReason: selected ? null : firstDate && quarter.reportedDate < firstDate ? "before-calendar" : lastDate && quarter.reportedDate > lastDate ? "after-calendar" : "gap",
      alphaSource: quarter.source,
    };
  });
}

function oneSidedReason(side: OneSidedQuarter["side"], periodEnd: string, otherEnds: Set<string>): OneSidedQuarter["reason"] {
  const ordered = [...otherEnds].sort();
  if (!ordered.length) return "true-gap";
  if (periodEnd < ordered[0]) return side === "alphaVantage" ? "av-before-ours" : "ours-before-av";
  if (periodEnd > ordered.at(-1)!) return side === "alphaVantage" ? "av-after-ours" : "ours-after-av";
  return "true-gap";
}

export function checkCompany(input: {
  cik: number;
  ticker: string;
  alphaVantage: AvQuarter[];
  adjusted: AdjustedFigure[];
  gaap: GaapFigure[];
  releases: ReleaseFiling[];
  splits: SplitEvent[];
  sessions?: string[];
}): CompanyCheck {
  const av = [...input.alphaVantage].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const adjusted = new Map<string, AdjustedFigure>();
  for (const row of [...input.adjusted].sort((a, b) => a.acceptedEt.localeCompare(b.acceptedEt))) if (!adjusted.has(row.source.periodEnd as string)) adjusted.set(row.source.periodEnd as string, row);
  const gaap = new Map(input.gaap.map(row => [row.source.periodEnd as string, row]));
  const comparisons = [...compareSeries(av, adjusted, "adjusted", input.splits), ...compareSeries(av, gaap, "gaap", input.splits)];
  const dateChecks = checkDates(av, input.releases, input.sessions ?? []);
  const avEnds = new Set(av.map(row => row.periodEnd));
  const ourEnds = new Map<string, string[]>();
  for (const end of adjusted.keys()) ourEnds.set(end, [...ourEnds.get(end) ?? [], "adjusted"]);
  for (const end of gaap.keys()) ourEnds.set(end, [...ourEnds.get(end) ?? [], "gaap"]);
  const ourEndSet = new Set(ourEnds.keys());
  const buildOneSided = (matchedAv: Set<string>, matchedOurs: Set<string>) => [
    ...av.filter(row => !matchedAv.has(row.periodEnd)).map(row => ({ periodEnd: row.periodEnd, side: "alphaVantage" as const, reason: oneSidedReason("alphaVantage", row.periodEnd, ourEndSet), ourSources: [], alphaSource: row.source })),
    ...[...ourEnds].filter(([end]) => !matchedOurs.has(end)).map(([periodEnd, ourSources]) => ({ periodEnd, side: "ours" as const, reason: oneSidedReason("ours", periodEnd, avEnds), ourSources })),
  ].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const exactRows = comparisons.filter(row => row.matchType === "exact");
  const oneSidedExact = buildOneSided(new Set(exactRows.map(row => row.periodEnd)), new Set(exactRows.map(row => row.ourPeriodEnd)));
  const oneSided = buildOneSided(new Set(comparisons.map(row => row.periodEnd)), new Set(comparisons.map(row => row.ourPeriodEnd)));
  return {
    cik: input.cik,
    ticker: input.ticker,
    comparisons,
    exactComparisons: comparisons.filter(row => row.matchType === "exact"),
    disagreements: comparisons.filter(row => !row.bestMatch),
    dateChecks,
    dateDisagreements: dateChecks.filter(row => row.coverage === "within-10-days" && (!row.dateMatch || row.timeMatch === false)),
    oneSided,
    oneSidedExact,
    basis: inferBasis(comparisons),
  };
}
