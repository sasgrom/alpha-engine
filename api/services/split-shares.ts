import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  isFinancialStatementFactForm,
  isReportedQuarterDuration,
} from "./series";

const ratioConcepts = [
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "CommonStockSharesOutstanding",
  "EarningsPerShareDiluted",
  "EarningsPerShareBasic",
] as const;
const shareConcepts = [
  "CommonStockSharesOutstanding",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfSharesOutstandingBasic",
] as const;
const splitTagConcept = "StockholdersEquityNoteStockSplitConversionRatio1";
const splitRatios = [1, 2, 3, 4, 5, 10, 20, 1.5, 1.25];
const splitCandidates = [
  ...splitRatios,
  ...splitRatios.filter(value => value !== 1).map(value => 1 / value),
];

interface FactVersion {
  value: number;
  filed: string;
  accession: string;
}

export interface SplitFact {
  concept: string;
  endDate: string;
  val: number;
  filed: string;
  accn: string;
  form?: string | null;
  startDate?: string | null;
}

export interface SeriesFact {
  concept: string;
  periodEnd: string;
  vintage: string;
  val: number;
  sourceAccn: string | null;
  sourceFiled: string | null;
}

export interface SplitEvent {
  ratio: number;
  firstNewBasisFiled: string;
  evidence: {
    concept: string;
    periodEnd: string;
    first: FactVersion;
    latest: FactVersion;
    rawRatio: number;
    error: number;
  }[];
  tagValues: number[];
}

export interface SplitRejection {
  concept: string;
  periodEnd: string;
  rawRatio: number;
  candidateRatio: number | null;
  reason: string;
  first: FactVersion;
  latest: FactVersion;
}

export interface SplitProfile {
  events: SplitEvent[];
  rejected: SplitRejection[];
  cover: SplitFact[];
  series: SeriesFact[];
  reportedQuarterPeriods: Set<string>;
}

export interface ShareEvidence {
  shares: number;
  rawShares: number;
  ratio: number;
  source:
    | "cover_page"
    | "common_stock"
    | "weighted_diluted"
    | "weighted_basic"
    | "schwab_instrument";
  periodEnd: string;
  filed: string;
  accession: string;
  sourceHash?: string | null;
  events: SplitEvent[];
}

export function nearestSplitRatio(
  value: number,
  tolerance = 0.01
): { ratio: number; error: number } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const match = splitCandidates
    .map(candidate => ({
      candidate,
      error: Math.abs(value - candidate) / candidate,
    }))
    .sort((a, b) => a.error - b.error || a.candidate - b.candidate)[0];
  return match.error <= tolerance
    ? { ratio: match.candidate, error: match.error }
    : null;
}

function isEps(concept: string): boolean {
  return (
    concept === "EarningsPerShareDiluted" || concept === "EarningsPerShareBasic"
  );
}

function versions(rows: SplitFact[]): {
  first: FactVersion;
  latest: FactVersion;
} {
  const ordered = [...rows].sort(
    (a, b) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn)
  );
  const first = ordered[0],
    latest = ordered[ordered.length - 1];
  return {
    first: { value: first.val, filed: first.filed, accession: first.accn },
    latest: { value: latest.val, filed: latest.filed, accession: latest.accn },
  };
}

export function buildSplitProfile(
  facts: SplitFact[],
  series: SeriesFact[] = []
): SplitProfile {
  const usable = facts.filter(
    row =>
      isFinancialStatementFactForm(row.form ?? "10-Q") &&
      Number.isFinite(row.val) &&
      row.val !== 0 &&
      row.filed &&
      row.endDate
  );
  const groups = new Map<string, SplitFact[]>();
  for (const concept of ratioConcepts) {
    for (const row of usable.filter(fact => fact.concept === concept)) {
      const key = `${concept}|${row.startDate ?? ""}|${row.endDate}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  }
  const candidates: {
    key: string;
    concept: string;
    periodEnd: string;
    first: FactVersion;
    latest: FactVersion;
    rawRatio: number;
    ratio: number;
    error: number;
  }[] = [];
  const rejected: SplitRejection[] = [];
  for (const [key, rows] of groups) {
    const [concept, , periodEnd] = key.split("|");
    const { first, latest } = versions(rows);
    if (first.value <= 0 || latest.value <= 0) continue;
    const rawRatio = isEps(concept)
      ? first.value / latest.value
      : latest.value / first.value;
    if (Math.abs(rawRatio - 1) < 1e-12) continue;
    const match = nearestSplitRatio(rawRatio, isEps(concept) ? 0.03 : 0.01);
    if (!match || match.ratio === 1) {
      rejected.push({
        concept,
        periodEnd,
        rawRatio,
        candidateRatio: match?.ratio ?? null,
        reason: "unclean_ratio",
        first,
        latest,
      });
    } else {
      candidates.push({
        key,
        concept,
        periodEnd,
        first,
        latest,
        rawRatio,
        ratio: match.ratio,
        error: match.error,
      });
    }
  }
  const tags = usable.filter(row => row.concept === splitTagConcept);
  const events: SplitEvent[] = [];
  const eventCandidates = candidates.map(candidate => {
    let firstNewBasisFiled = "";
    const rows = groups.get(candidate.key)!;
    for (const row of rows) {
      const rawRatio = isEps(candidate.concept)
        ? candidate.first.value / row.val
        : row.val / candidate.first.value;
      const match = nearestSplitRatio(
        rawRatio,
        isEps(candidate.concept) ? 0.03 : 0.01
      );
      if (
        match?.ratio === candidate.ratio &&
        (!firstNewBasisFiled || row.filed < firstNewBasisFiled)
      )
        firstNewBasisFiled = row.filed;
    }
    return { ...candidate, firstNewBasisFiled };
  });
  for (const candidate of eventCandidates.filter(
    candidate => !candidate.firstNewBasisFiled
  )) {
    rejected.push({
      concept: candidate.concept,
      periodEnd: candidate.periodEnd,
      rawRatio: candidate.rawRatio,
      candidateRatio: candidate.ratio,
      reason: "missing_new_basis_filing",
      first: candidate.first,
      latest: candidate.latest,
    });
  }
  const acceptEvent = (
    counts: typeof eventCandidates,
    all: typeof eventCandidates
  ) => {
    const firstNewBasisFiled = counts[0].firstNewBasisFiled;
    const ratio = counts[0].ratio;
    const evidence = all.filter(
      candidate =>
        Math.abs(
          Date.parse(candidate.firstNewBasisFiled) -
            Date.parse(firstNewBasisFiled)
        ) <=
        365 * 86400_000
    );
    const tagValues = [
      ...new Set(
        tags
          .filter(
            tag =>
              nearestSplitRatio(tag.val / ratio, 0.001)?.ratio === 1 &&
              Math.abs(
                Date.parse(tag.filed) - Date.parse(firstNewBasisFiled)
              ) <=
                365 * 86400_000
          )
          .map(tag => tag.val)
      ),
    ];
    if (evidence.length + (tagValues.length > 0 ? 1 : 0) < 2) {
      rejected.push(
        ...evidence.map(row => ({
          concept: row.concept,
          periodEnd: row.periodEnd,
          rawRatio: row.rawRatio,
          candidateRatio: ratio,
          reason: "uncorroborated_ratio",
          first: row.first,
          latest: row.latest,
        }))
      );
      return;
    }
    events.push({
      ratio,
      firstNewBasisFiled,
      evidence: evidence.map(row => ({
        concept: row.concept,
        periodEnd: row.periodEnd,
        first: row.first,
        latest: row.latest,
        rawRatio: row.rawRatio,
        error: row.error,
      })),
      tagValues,
    });
  };
  for (const ratio of [
    ...new Set(eventCandidates.map(candidate => candidate.ratio)),
  ].sort((a, b) => a - b)) {
    const all = eventCandidates.filter(
      candidate => candidate.ratio === ratio && candidate.firstNewBasisFiled
    );
    const counts = all
      .filter(candidate => !isEps(candidate.concept))
      .sort((a, b) => a.firstNewBasisFiled.localeCompare(b.firstNewBasisFiled));
    if (counts.length === 0) {
      rejected.push(
        ...all.map(row => ({
          concept: row.concept,
          periodEnd: row.periodEnd,
          rawRatio: row.rawRatio,
          candidateRatio: ratio,
          reason: "no_share_count_evidence",
          first: row.first,
          latest: row.latest,
        }))
      );
      continue;
    }
    let countsForEvent: typeof eventCandidates = [];
    for (const candidate of counts) {
      if (
        countsForEvent.length &&
        Date.parse(candidate.firstNewBasisFiled) -
          Date.parse(countsForEvent[0].firstNewBasisFiled) >
          365 * 86400_000
      ) {
        acceptEvent(countsForEvent, all);
        countsForEvent = [];
      }
      countsForEvent.push(candidate);
    }
    if (countsForEvent.length) acceptEvent(countsForEvent, all);
  }
  events.sort(
    (a, b) =>
      a.firstNewBasisFiled.localeCompare(b.firstNewBasisFiled) ||
      a.ratio - b.ratio
  );
  const reportedQuarterPeriods = new Set(
    usable
      .filter(
        row =>
          shareConcepts.includes(
            row.concept as (typeof shareConcepts)[number]
          ) && isReportedQuarterDuration(row.startDate ?? null, row.endDate)
      )
      .map(row => `${row.concept}|${row.endDate}`)
  );
  return {
    events,
    rejected,
    cover: usable.filter(
      row => row.concept === "EntityCommonStockSharesOutstanding" && row.val > 0
    ),
    series,
    reportedQuarterPeriods,
  };
}

export function applySplitEvents(
  value: number,
  filed: string,
  events: SplitEvent[]
): { shares: number; ratio: number; events: SplitEvent[] } {
  let shares = value,
    ratio = 1;
  const applied: SplitEvent[] = [];
  for (const event of events) {
    if (filed >= event.firstNewBasisFiled) continue;
    shares *= event.ratio;
    ratio *= event.ratio;
    applied.push(event);
  }
  return { shares, ratio, events: applied };
}

export function selectShareCount(
  profile: SplitProfile,
  date: string
): ShareEvidence | null {
  const lastQuarterEnd = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3,
      0
    )
  )
    .toISOString()
    .slice(0, 10);
  const earliestDate = new Date(Date.parse(lastQuarterEnd) - 183 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const candidates: {
    source: ShareEvidence["source"];
    periodEnd: string;
    filed: string;
    accession: string;
    value: number;
    first: FactVersion;
    latest: FactVersion;
  }[] = [];
  for (const row of profile.cover) {
    if (row.endDate > date || row.filed > date || row.endDate < earliestDate)
      continue;
    const version = { value: row.val, filed: row.filed, accession: row.accn };
    candidates.push({
      source: "cover_page",
      periodEnd: row.endDate,
      filed: row.filed,
      accession: row.accn,
      value: row.val,
      first: version,
      latest: version,
    });
  }
  const groups = new Map<string, { first: SeriesFact; latest: SeriesFact }>();
  for (const row of profile.series) {
    if (
      !shareConcepts.includes(row.concept as (typeof shareConcepts)[number]) ||
      row.val <= 0 ||
      !row.sourceFiled ||
      row.periodEnd > date ||
      row.sourceFiled > date ||
      row.periodEnd < earliestDate
    )
      continue;
    const key = `${row.concept}|${row.periodEnd}`;
    if (
      row.concept !== "CommonStockSharesOutstanding" &&
      !profile.reportedQuarterPeriods.has(key)
    )
      continue;
    const group = groups.get(key);
    if (
      !group ||
      (row.vintage === "first" && row.sourceFiled < group.first.sourceFiled!)
    ) {
      groups.set(key, { first: row, latest: group?.latest ?? row });
    } else if (
      row.vintage === "latest" &&
      row.sourceFiled > group.latest.sourceFiled!
    ) {
      group.latest = row;
    }
  }
  for (const [key, group] of groups) {
    const [concept, periodEnd] = key.split("|");
    const source =
      concept === "CommonStockSharesOutstanding"
        ? "common_stock"
        : concept === "WeightedAverageNumberOfDilutedSharesOutstanding"
          ? "weighted_diluted"
          : "weighted_basic";
    candidates.push({
      source,
      periodEnd,
      filed: group.first.sourceFiled!,
      accession: group.first.sourceAccn ?? "",
      value: group.first.val,
      first: {
        value: group.first.val,
        filed: group.first.sourceFiled!,
        accession: group.first.sourceAccn ?? "",
      },
      latest: {
        value: group.latest.val,
        filed: group.latest.sourceFiled!,
        accession: group.latest.sourceAccn ?? "",
      },
    });
  }
  const sourceRank: Record<ShareEvidence["source"], number> = {
    cover_page: 0,
    common_stock: 1,
    weighted_basic: 2,
    weighted_diluted: 3,
    schwab_instrument: 4,
  };
  candidates.sort(
    (a, b) =>
      b.periodEnd.localeCompare(a.periodEnd) ||
      sourceRank[a.source] - sourceRank[b.source] ||
      b.filed.localeCompare(a.filed) ||
      a.accession.localeCompare(b.accession)
  );
  for (const candidate of candidates) {
    const rawRatio = candidate.latest.value / candidate.first.value;
    if (Math.abs(rawRatio - 1) > 1e-12) {
      const match = nearestSplitRatio(rawRatio, 0.01);
      if (!match) continue;
      if (
        match.ratio !== 1 &&
        !profile.events.some(event => event.ratio === match.ratio)
      )
        continue;
    }
    const adjusted = applySplitEvents(
      candidate.value,
      candidate.filed,
      profile.events
    );
    if (Number.isFinite(adjusted.shares) && adjusted.shares > 0) {
      return {
        shares: adjusted.shares,
        rawShares: candidate.value,
        ratio: adjusted.ratio,
        source: candidate.source,
        periodEnd: candidate.periodEnd,
        filed: candidate.filed,
        accession: candidate.accession,
        events: adjusted.events,
      };
    }
  }
  return null;
}

export function hasShareCandidate(
  profile: SplitProfile,
  date: string
): boolean {
  const lastQuarterEnd = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3,
      0
    )
  )
    .toISOString()
    .slice(0, 10);
  const earliestDate = new Date(Date.parse(lastQuarterEnd) - 183 * 86400_000)
    .toISOString()
    .slice(0, 10);
  if (
    profile.cover.some(
      row =>
        row.endDate <= date && row.filed <= date && row.endDate >= earliestDate
    )
  )
    return true;
  return profile.series.some(row => {
    if (
      !shareConcepts.includes(row.concept as (typeof shareConcepts)[number]) ||
      row.val <= 0 ||
      !row.sourceFiled ||
      row.periodEnd > date ||
      row.sourceFiled > date ||
      row.periodEnd < earliestDate
    )
      return false;
    return (
      row.concept === "CommonStockSharesOutstanding" ||
      profile.reportedQuarterPeriods.has(`${row.concept}|${row.periodEnd}`)
    );
  });
}

export async function createSplitShareProvider(cik: number) {
  const db = getDb();
  const conceptList = [
    ...ratioConcepts,
    splitTagConcept,
    "EntityCommonStockSharesOutstanding",
  ];
  const [facts, series]: [any, any] = await Promise.all([
    db.execute(
      sql`SELECT concept, startDate, endDate, val, filed, accn, form FROM facts WHERE cik=${cik} AND concept IN (${sql.join(
        conceptList.map(concept => sql`${concept}`),
        sql`,`
      )}) AND val IS NOT NULL`
    ),
    db.execute(
      sql`SELECT concept, periodEnd, vintage, val, sourceAccn, sourceFiled FROM series_points WHERE cik=${cik} AND concept IN (${sql.join(
        shareConcepts.map(concept => sql`${concept}`),
        sql`,`
      )}) AND derivation='reported'`
    ),
  ]);
  const profile = buildSplitProfile(
    (facts[0] ?? []).map((row: any) => ({
      ...row,
      startDate: row.startDate ? String(row.startDate).slice(0, 10) : null,
      endDate: String(row.endDate).slice(0, 10),
      filed: String(row.filed).slice(0, 10),
      val: Number(row.val),
    })),
    (series[0] ?? []).map((row: any) => ({
      ...row,
      periodEnd: String(row.periodEnd).slice(0, 10),
      sourceFiled: row.sourceFiled
        ? String(row.sourceFiled).slice(0, 10)
        : null,
      val: Number(row.val),
    }))
  );
  return { profile, at: (date: string) => selectShareCount(profile, date) };
}
