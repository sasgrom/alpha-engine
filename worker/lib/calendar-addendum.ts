/**
 * The quarters reported since the release calendar was built. The calendar (worker/lib/event-calendar*.ts, files under
 * D:\research\alpha-engine\engine\events) is a pinned research file; the nightly SEC cache keeps arriving. This module
 * gives the later quarters in the calendar's own shape, so the steps that read the calendar (guidance extraction, the
 * release readers) can read the addendum the same way:
 *   paired     a new 10-Q or 10-K and the earnings releases accepted between its period end and its own acceptance:
 *              the calendar's own rule (buildQuarters), nothing inferred
 *   inferred   an earnings release whose 10-Q or 10-K is not filed yet: its quarter ends one quarter after the
 *              company's last known period end (nextPeriodEnd); replaced by the paired row once the report is filed
 * The pinned files are never changed.
 */
import { buildQuarters, earningsFlag, newYorkToUtc, type CalendarFiling, type CalendarQuarter } from "./event-calendar";

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** A filing as the nightly cache's manifest lists it (worker/edgar-fetch.mts). */
export interface CachedManifestFiling {
  accessionNo: string;
  form: string;
  filingDate: string;
  reportDate?: string | null;
  primaryDoc?: string | null;
  acceptedEt?: string | null;
  items?: string | null;
}

/** The calendar's row for a filing the nightly cache holds. Null for a form the calendar does not list. */
export function calendarFilingFromCache(company: { cik: number; ticker: string }, entry: CachedManifestFiling): CalendarFiling | null {
  if (!/^(10-K|10-Q|8-K)(\/A)?$/.test(entry.form) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.filingDate)) return null;
  const acceptedEt = entry.acceptedEt ?? null, items = entry.items?.trim() ? entry.items.trim() : null;
  return {
    cik: company.cik, ticker: company.ticker, accessionNo: entry.accessionNo, form: entry.form, filingDate: entry.filingDate,
    reportDate: entry.reportDate?.trim() ? entry.reportDate : null, primaryDoc: entry.primaryDoc?.trim() ? entry.primaryDoc : null,
    acceptedEt, acceptedUtc: acceptedEt ? newYorkToUtc(acceptedEt) : null, acceptedSource: acceptedEt ? "nightly_cache" : "missing",
    items, itemsSource: items ? "nightly_cache" : "unavailable", ...earningsFlag(entry.form, items, entry.filingDate, null), cachedFiles: [],
  };
}

/**
 * The period end one quarter after a known one: three months on for a period that ends on the last day of a month,
 * 91 days (13 weeks) on otherwise. Companies on 52/53-week years move by 13 weeks, occasionally 14; the build measures
 * how often this rule lands on the company's real next period end.
 */
export function nextPeriodEnd(previous: string): string {
  const date = new Date(`${previous}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() === date.getUTCDate();
  if (monthEnd) return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 4, 0)));
  return iso(new Date(date.getTime() + 91 * DAY));
}

/** How the rule did on consecutive quarters whose real ends are known: exact, within a week, and how many were tried. */
export function periodEndAccuracy(quarters: { cik: number; fiscalPeriodEnd: string }[]): { pairs: number; exact: number; withinWeek: number } {
  const byCompany = new Map<number, string[]>();
  for (const quarter of quarters) byCompany.set(quarter.cik, [...(byCompany.get(quarter.cik) ?? []), quarter.fiscalPeriodEnd]);
  let pairs = 0, exact = 0, withinWeek = 0;
  for (const ends of byCompany.values()) {
    const sorted = [...new Set(ends)].sort();
    for (let index = 1; index < sorted.length; index++) {
      const gap = (Date.parse(sorted[index]) - Date.parse(sorted[index - 1])) / DAY;
      if (gap < 80 || gap > 105) continue; // not consecutive quarters (a missing report, a changed fiscal year)
      const off = Math.abs(Date.parse(nextPeriodEnd(sorted[index - 1])) - Date.parse(sorted[index])) / DAY;
      pairs++;
      if (off === 0) exact++;
      if (off <= 7) withinWeek++;
    }
  }
  return { pairs, exact, withinWeek };
}

export type AddendumQuarter = Omit<CalendarQuarter, "pairingBasis" | "periodicForm" | "periodicAccession"> & {
  pairingBasis: CalendarQuarter["pairingBasis"] | "earnings_8k_inferred";
  periodicForm: string | null;
  periodicAccession: string | null;
};

export interface CompanyAddendum {
  filings: CalendarFiling[];
  quarters: AddendumQuarter[];
  /** Earnings releases that fit no quarter (too long after the inferred period end, or no period is known). */
  unplaced: { accessionNo: string; acceptedEt: string | null; reason: string }[];
}

/**
 * One company's addendum. `pinned` are the calendar's own rows and quarter ends; `cached` the nightly cache's
 * manifest. A cached filing is new when the calendar does not list its accession and it was filed on or after the
 * calendar file's last day (before that day the calendar is complete and is the only source).
 */
export function buildCompanyAddendum(params: {
  company: { cik: number; ticker: string };
  pinnedFilings: CalendarFiling[];
  pinnedQuarterEnds: string[];
  cached: CachedManifestFiling[];
  calendarAsOf: string;
  /** How long after a period end a release may still report it. */
  maxDaysAfterPeriod?: number;
}): CompanyAddendum {
  const listed = new Set(params.pinnedFilings.map((row) => row.accessionNo));
  const filings: CalendarFiling[] = [];
  for (const entry of params.cached) {
    if (listed.has(entry.accessionNo) || entry.filingDate < params.calendarAsOf) continue;
    const row = calendarFilingFromCache(params.company, entry);
    if (!row) continue;
    listed.add(entry.accessionNo);
    filings.push(row);
  }
  if (!filings.length) return { filings, quarters: [], unplaced: [] };
  const lastPinned = [...params.pinnedQuarterEnds].sort().at(-1) ?? "";
  const all = buildQuarters([...params.pinnedFilings, ...filings], []);
  const quarters: AddendumQuarter[] = all.filter((quarter) => quarter.fiscalPeriodEnd > lastPinned);
  const paired = new Set(all.flatMap((quarter) => quarter.earningsFilings.map((filing) => filing.accessionNo)));
  const unplaced: CompanyAddendum["unplaced"] = [];
  const waiting = filings.filter((row) => row.isEarningsRelease === true && !paired.has(row.accessionNo)).sort((a, b) => (a.acceptedEt ?? "").localeCompare(b.acceptedEt ?? ""));
  const lastKnown = all.map((quarter) => quarter.fiscalPeriodEnd).sort().at(-1) ?? "";
  const inferred: typeof waiting = [];
  const end = lastKnown ? nextPeriodEnd(lastKnown) : "";
  for (const release of waiting) {
    if (!release.acceptedEt) { unplaced.push({ accessionNo: release.accessionNo, acceptedEt: null, reason: "no acceptance time" }); continue; }
    if (!end) { unplaced.push({ accessionNo: release.accessionNo, acceptedEt: release.acceptedEt, reason: "no period end is known for the company" }); continue; }
    const days = (Date.parse(`${release.acceptedEt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`)) / DAY;
    if (days <= 0) { unplaced.push({ accessionNo: release.accessionNo, acceptedEt: release.acceptedEt, reason: `accepted before the next period end ${end}` }); continue; }
    if (days > (params.maxDaysAfterPeriod ?? 120)) { unplaced.push({ accessionNo: release.accessionNo, acceptedEt: release.acceptedEt, reason: `${Math.round(days)} days after the next period end ${end}` }); continue; }
    inferred.push(release);
  }
  if (inferred.length) {
    quarters.push({
      cik: params.company.cik, ticker: params.company.ticker, fiscalPeriodEnd: end, periodicForm: null, periodicAccession: null, periodicAcceptedEt: null,
      earningsAccession: inferred[0].accessionNo, earningsAcceptedEt: inferred[0].acceptedEt, firstPublicationEt: inferred[0].acceptedEt, pairingBasis: "earnings_8k_inferred",
      amendmentAccessions: [], earningsFilings: inferred.map((row) => ({ accessionNo: row.accessionNo, acceptedEt: row.acceptedEt })), nextFirstPublicationEt: null, windowSessions: null,
    });
  }
  return { filings, quarters, unplaced };
}

export function calendarAddendumSets(value?: string | null): string[] {
  if (value === undefined || value === null) return ["50", "rest", "six"];
  const sets = [...new Set(value.split(",").map(row => row.trim()).filter(Boolean))];
  if (!sets.length || sets.some(row => !/^[a-z0-9_-]+$/i.test(row))) throw new Error(`Invalid --sets ${value}`);
  return sets;
}
