import { createHash } from "node:crypto";
import { acceptanceChecks, acceptanceEt, acceptanceUtc, buildQuarters, earningsFlag, type CalendarFiling, type CalendarQuarter } from "./event-calendar";

export interface RestCompany {
  cik: number;
  ticker: string;
  name: string;
}

export interface ExhibitOutcome {
  accessionNo: string;
  status: "complete" | "no_exhibit" | "error";
  files: { name: string; size: number; sha256: string }[];
  reason: string | null;
  bytesDownloaded: number;
}

const forms = new Set(["10-Q", "10-K", "8-K", "10-Q/A", "10-K/A", "8-K/A"]);
const text = (value: unknown): string | null => typeof value === "string" && value.length ? value : null;

export function calendarRowsFromSubmissions(company: RestCompany, pages: any[], from = "2005-01-01"): CalendarFiling[] {
  const byAccession = new Map<string, CalendarFiling>();
  const signatures = new Map<string, string>();
  for (const page of pages) {
    for (let index = 0; index < (page?.accessionNumber?.length ?? 0); index++) {
      const form = String(page.form?.[index] ?? "");
      const filingDate = String(page.filingDate?.[index] ?? "");
      if (!forms.has(form) || filingDate < from) continue;
      const accessionNo = String(page.accessionNumber[index]);
      const rawAcceptance = page.acceptanceDateTime?.[index];
      const items = text(page.items?.[index]);
      const primaryDoc = text(page.primaryDocument?.[index]);
      const signature = JSON.stringify({ form, filingDate, reportDate: text(page.reportDate?.[index]), rawAcceptance: text(rawAcceptance), items, primaryDoc });
      if (byAccession.has(accessionNo)) {
        if (signatures.get(accessionNo) !== signature) throw new Error(`Inconsistent submissions metadata for ${company.ticker}/${accessionNo}`);
        continue;
      }
      const accepted = acceptanceEt(rawAcceptance);
      byAccession.set(accessionNo, {
        cik: company.cik,
        ticker: company.ticker,
        accessionNo,
        form,
        filingDate,
        reportDate: text(page.reportDate?.[index]),
        acceptedEt: accepted,
        acceptedUtc: acceptanceUtc(rawAcceptance, accepted),
        acceptedSource: rawAcceptance ? "sec_submissions" : "missing",
        items,
        itemsSource: items ? "sec_submissions" : "unavailable",
        ...earningsFlag(form, items, filingDate, null),
        primaryDoc,
        cachedFiles: [],
      });
      signatures.set(accessionNo, signature);
    }
  }
  return [...byAccession.values()].sort((a, b) => a.accessionNo.localeCompare(b.accessionNo));
}

export function parseIndexAcceptanceEt(html: string): string | null {
  const header = html.match(/<ACCEPTANCE-DATETIME>(\d{14})/i);
  if (header) return acceptanceEt(header[1]);
  const plain = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
  const match = plain.match(/\bAccepted\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\b/i);
  return match ? `${match[1]}T${match[2]}` : null;
}

export function seededQuarterSample(quarters: CalendarQuarter[], count: number, seed: string): CalendarQuarter[] {
  return quarters.filter((row) => row.earningsAccession !== null && row.earningsAcceptedEt !== null).map((row) => ({
    row,
    key: createHash("sha256").update(`${seed}|${row.cik}|${row.fiscalPeriodEnd}|${row.periodicAccession}`).digest("hex"),
  })).sort((a, b) => a.key.localeCompare(b.key) || a.row.cik - b.row.cik || a.row.fiscalPeriodEnd.localeCompare(b.row.fiscalPeriodEnd)).slice(0, count).map(({ row }) => row);
}

export function companyPilotChecks(filings: CalendarFiling[], quarters: CalendarQuarter[], outcomes: ExhibitOutcome[]) {
  const checks = acceptanceChecks(filings, quarters);
  const earnings = filings.filter((row) => row.isEarningsRelease === true);
  const byAccession = new Map(outcomes.map((outcome) => [outcome.accessionNo, outcome]));
  const missingOutcome = earnings.filter((row) => !byAccession.has(row.accessionNo)).map((row) => row.accessionNo);
  const unexplained = outcomes.filter((outcome) => outcome.files.length === 0 && !outcome.reason).map((outcome) => outcome.accessionNo);
  const issues: string[] = [];
  if (checks.acceptedSince2004.share < 0.995) issues.push(`acceptedEt share ${checks.acceptedSince2004.share} < 0.995`);
  if (checks.itemLists8k.share < 0.99) issues.push(`8-K item-list share ${checks.itemLists8k.share} < 0.99`);
  if (checks.quarters.duplicateCompanyPeriods) issues.push(`${checks.quarters.duplicateCompanyPeriods} duplicate company-periods`);
  if (checks.quarters.missingOriginalAccessionsSince2005.length) issues.push(`${checks.quarters.missingOriginalAccessionsSince2005.length} original filings missing from quarters`);
  if (checks.quarters.lagDays.negative) issues.push(`${checks.quarters.lagDays.negative} negative release lags`);
  if (checks.quarters.nonIncreasingNextPublications.length) issues.push(`${checks.quarters.nonIncreasingNextPublications.length} non-increasing next publications`);
  if (!checks.quarters.chosenReleaseIsFirst) issues.push("chosen release is not the earliest release");
  if (missingOutcome.length) issues.push(`${missingOutcome.length} earnings releases have no exhibit outcome`);
  if (unexplained.length) issues.push(`${unexplained.length} earnings releases have no exhibit or reason`);
  return {
    pass: issues.length === 0,
    issues,
    checks,
    exhibits: {
      releases: earnings.length,
      outcomes: outcomes.length,
      withFiles: outcomes.filter((outcome) => outcome.files.length > 0).length,
      withoutFilesWithReason: outcomes.filter((outcome) => outcome.files.length === 0 && outcome.reason !== null).length,
      missingOutcome,
      unexplained,
    },
  };
}

export function projectRestRun(options: { eligibleCompanies: number; pilotCompanies: number; bytesDownloaded: number; elapsedSeconds: number; freeBytes: number }) {
  const minimumFreeBytes = 100 * 2 ** 30;
  if (options.pilotCompanies <= 0) return { projectedRemainingBytes: null, projectedRemainingSeconds: null, projectedFreeBytes: null, minimumFreeBytes, storagePass: false };
  const remaining = Math.max(0, options.eligibleCompanies - options.pilotCompanies);
  const projectedRemainingBytes = Math.round(options.bytesDownloaded / options.pilotCompanies * remaining);
  const projectedRemainingSeconds = options.elapsedSeconds / options.pilotCompanies * remaining;
  const projectedFreeBytes = options.freeBytes - projectedRemainingBytes;
  return { projectedRemainingBytes, projectedRemainingSeconds, projectedFreeBytes, minimumFreeBytes, storagePass: projectedFreeBytes >= minimumFreeBytes };
}
