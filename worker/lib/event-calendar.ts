export interface CalendarFiling {
  cik: number;
  ticker: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  primaryDoc: string | null;
  acceptedEt: string | null;
  acceptedUtc: string | null;
  acceptedSource: string;
  items: string | null;
  itemsSource: string;
  isEarningsRelease: boolean | null;
  earningsFlagBasis: "item_2.02" | "item_12" | "text_rule" | "none";
  cachedFiles: { name: string; bytes: number }[];
}

export interface CalendarQuarter {
  cik: number;
  ticker: string;
  fiscalPeriodEnd: string;
  periodicForm: string;
  periodicAccession: string;
  periodicAcceptedEt: string | null;
  earningsAccession: string | null;
  earningsAcceptedEt: string | null;
  firstPublicationEt: string | null;
  pairingBasis: "earnings_8k" | "periodic_only";
  amendmentAccessions: string[];
  earningsFilings: { accessionNo: string; acceptedEt: string | null }[];
  nextFirstPublicationEt: string | null;
  windowSessions: number | null;
}

export function newYorkToUtc(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid New York timestamp: ${value}`);
  const [, year, month, day, hour, minute, second] = match;
  const naive = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(naive)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(naive - (zonedAsUtc - naive)).toISOString();
}

export function utcToNewYork(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid UTC timestamp: ${value}`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function acceptanceEt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.includes("T")) return utcToNewYork(raw);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
}

export function acceptanceUtc(raw: unknown, acceptedEt: string | null): string | null {
  if (typeof raw === "string" && raw.includes("T")) {
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return acceptedEt ? newYorkToUtc(acceptedEt) : null;
}

export function earningsFlag(form: string, items: string | null, filingDate: string, primaryText: string | null): Pick<CalendarFiling, "isEarningsRelease" | "earningsFlagBasis"> {
  if (!/^(8-K|8-K\/A)$/i.test(form)) return { isEarningsRelease: false, earningsFlagBasis: "none" };
  const normalized = (items ?? "").replace(/\s/g, "").toLowerCase();
  if (filingDate >= "2004-08-23" && items !== null) return { isEarningsRelease: /(^|,)2\.02(,|$)/.test(normalized), earningsFlagBasis: "item_2.02" };
  if (filingDate >= "2003-03-28" && filingDate <= "2004-08-22" && items !== null) return { isEarningsRelease: /(^|,)12(,|$)/.test(normalized), earningsFlagBasis: "item_12" };
  if (primaryText !== null) return { isEarningsRelease: /results of operations and financial condition/i.test(primaryText), earningsFlagBasis: "text_rule" };
  return { isEarningsRelease: null, earningsFlagBasis: "none" };
}

function isOriginalPeriodic(row: CalendarFiling): boolean {
  return /^(10-K|10-Q)$/i.test(row.form) && row.reportDate !== null;
}

function isPeriodicAmendment(row: CalendarFiling): boolean {
  return /^(10-K\/A|10-Q\/A)$/i.test(row.form) && row.reportDate !== null;
}

export function buildQuarters(filings: CalendarFiling[], spyDates: string[]): CalendarQuarter[] {
  const byCompany = new Map<number, CalendarFiling[]>();
  for (const filing of filings) byCompany.set(filing.cik, [...(byCompany.get(filing.cik) ?? []), filing]);
  const output: CalendarQuarter[] = [];
  for (const rows of byCompany.values()) {
    const periodic = rows.filter(isOriginalPeriodic).sort((a, b) => a.reportDate!.localeCompare(b.reportDate!) || (a.acceptedUtc ?? "").localeCompare(b.acceptedUtc ?? "") || a.accessionNo.localeCompare(b.accessionNo));
    const amendments = new Map<string, CalendarFiling[]>();
    const sortedAmendments = rows.filter(isPeriodicAmendment).sort((a, b) => (a.acceptedUtc ?? "").localeCompare(b.acceptedUtc ?? "") || a.accessionNo.localeCompare(b.accessionNo));
    for (const row of sortedAmendments) amendments.set(row.reportDate!, [...(amendments.get(row.reportDate!) ?? []), row]);
    const earnings = rows.filter((row) => row.isEarningsRelease === true && row.acceptedUtc).sort((a, b) => a.acceptedUtc!.localeCompare(b.acceptedUtc!) || a.accessionNo.localeCompare(b.accessionNo));
    const companyQuarters: CalendarQuarter[] = [];
    const seenPeriods = new Set<string>();
    for (const row of periodic) {
      const periodEnd = row.reportDate!;
      if (seenPeriods.has(periodEnd)) throw new Error(`Multiple original periodic filings for ${row.ticker}/${periodEnd}`);
      seenPeriods.add(periodEnd);
      const candidates = earnings.filter((release) => release.acceptedUtc! > periodEnd && release.acceptedUtc! <= (row.acceptedUtc ?? periodEnd));
      const release = candidates[0];
      companyQuarters.push({
        cik: row.cik,
        ticker: row.ticker,
        fiscalPeriodEnd: periodEnd,
        periodicForm: row.form,
        periodicAccession: row.accessionNo,
        periodicAcceptedEt: row.acceptedEt,
        earningsAccession: release?.accessionNo ?? null,
        earningsAcceptedEt: release?.acceptedEt ?? null,
        firstPublicationEt: release?.acceptedEt ?? row.acceptedEt,
        pairingBasis: release ? "earnings_8k" : "periodic_only",
        amendmentAccessions: (amendments.get(periodEnd) ?? []).map((amendment) => amendment.accessionNo),
        earningsFilings: candidates.map((candidate) => ({ accessionNo: candidate.accessionNo, acceptedEt: candidate.acceptedEt })),
        nextFirstPublicationEt: null,
        windowSessions: null,
      });
    }
    for (let index = 0; index < companyQuarters.length; index++) {
      const current = companyQuarters[index];
      const next = companyQuarters[index + 1]?.firstPublicationEt ?? null;
      current.nextFirstPublicationEt = next;
      if (current.firstPublicationEt && next) {
        if (next <= current.firstPublicationEt) throw new Error(`Quarter nextFirstPublicationEt must be strictly later than firstPublicationEt: ${current.ticker}/${current.fiscalPeriodEnd} ${current.firstPublicationEt} -> ${next}`);
        const firstDate = current.firstPublicationEt.slice(0, 10), nextDate = next.slice(0, 10);
        current.windowSessions = spyDates.filter((date) => date > firstDate && date < nextDate).length;
      }
    }
    output.push(...companyQuarters);
  }
  return output.sort((a, b) => a.cik - b.cik || a.fiscalPeriodEnd.localeCompare(b.fiscalPeriodEnd) || a.periodicAccession.localeCompare(b.periodicAccession));
}

export function acceptanceChecks(filings: CalendarFiling[], quarters: CalendarQuarter[]) {
  const recent = filings.filter((row) => row.filingDate >= "2004-01-01");
  const items8k = filings.filter((row) => /^(8-K|8-K\/A)$/i.test(row.form) && row.filingDate >= "2004-08-23");
  const originals = filings.filter(isOriginalPeriodic);
  const amendments = filings.filter(isPeriodicAmendment);
  const originalPeriods = new Set(originals.map((row) => `${row.cik}|${row.reportDate}`));
  const amendmentOnly = amendments.filter((row) => !originalPeriods.has(`${row.cik}|${row.reportDate}`));
  const quarterPeriods = new Set(quarters.map((row) => `${row.cik}|${row.fiscalPeriodEnd}`));
  const quarterOriginals = new Set(quarters.map((row) => `${row.cik}|${row.periodicAccession}`));
  const originalsSince2005 = originals.filter((row) => row.filingDate >= "2005-01-01");
  const originalSince2005Accessions = new Set(originalsSince2005.map((row) => `${row.cik}|${row.accessionNo}`));
  const withSeparateRelease = quarters.filter((row) => row.earningsAccession !== null);
  const lags = withSeparateRelease.map((row) => Math.round((Date.parse(row.periodicAcceptedEt!) - Date.parse(row.earningsAcceptedEt!)) / 86_400_000));
  const bounded = quarters.filter((row) => row.firstPublicationEt !== null && row.nextFirstPublicationEt !== null);
  const calendarWindows = bounded.map((row) => ({
    cik: row.cik,
    ticker: row.ticker,
    fiscalPeriodEnd: row.fiscalPeriodEnd,
    firstPublicationEt: row.firstPublicationEt,
    nextFirstPublicationEt: row.nextFirstPublicationEt,
    calendarDays: Math.round((Date.parse(`${row.nextFirstPublicationEt!.slice(0, 10)}T00:00:00Z`) - Date.parse(`${row.firstPublicationEt!.slice(0, 10)}T00:00:00Z`)) / 86_400_000),
  }));
  const quantile = (values: number[], q: number) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))] : null;
  const lagQuantile = (q: number) => quantile([...lags].sort((a, b) => a - b), q);
  const windowStatistics = (values: number[]) => {
    const windows = [...values].sort((a, b) => a - b);
    return {
      count: windows.length,
      median: quantile(windows, 0.5),
      p05: quantile(windows, 0.05),
      p95: quantile(windows, 0.95),
      share20: windows.length ? windows.filter((value) => value >= 20).length / windows.length : 0,
      share30: windows.length ? windows.filter((value) => value >= 30).length / windows.length : 0,
      share45: windows.length ? windows.filter((value) => value >= 45).length / windows.length : 0,
    };
  };
  const companyYears = new Map<string, number>();
  for (const row of filings.filter((row) => row.isEarningsRelease === true && row.filingDate >= "2005-01-01")) {
    const key = `${row.ticker}|${row.filingDate.slice(0, 4)}`;
    companyYears.set(key, (companyYears.get(key) ?? 0) + 1);
  }
  return {
    filingsTotal: filings.length,
    acceptedSince2004: { total: recent.length, present: recent.filter((row) => row.acceptedEt).length, share: recent.length ? recent.filter((row) => row.acceptedEt).length / recent.length : 0 },
    itemLists8k: { total: items8k.length, present: items8k.filter((row) => row.items !== null).length, share: items8k.length ? items8k.filter((row) => row.items !== null).length / items8k.length : 0 },
    companyYearOutliers: [...companyYears.entries()].filter(([, count]) => count < 3 || count > 5).map(([key, count]) => ({ companyYear: key, count })),
    periodicAmendments: {
      filings: amendments.length,
      linkedToQuarters: quarters.reduce((total, row) => total + row.amendmentAccessions.length, 0),
      amendmentOnlyFilings: amendmentOnly.length,
      amendmentOnlyPeriods: [...new Set(amendmentOnly.map((row) => `${row.ticker}/${row.reportDate}`))].sort(),
    },
    quarters: {
      total: quarters.length,
      originalPeriodicRows: originals.length,
      uniqueCompanyPeriods: quarterPeriods.size,
      duplicateCompanyPeriods: quarters.length - quarterPeriods.size,
      originalsSince2005: originalsSince2005.length,
      rowsSince2005: quarters.filter((row) => originalSince2005Accessions.has(`${row.cik}|${row.periodicAccession}`)).length,
      missingOriginalAccessionsSince2005: originalsSince2005.filter((row) => !quarterOriginals.has(`${row.cik}|${row.accessionNo}`)).map((row) => row.accessionNo),
      withSeparateRelease: withSeparateRelease.length,
      shareWithSeparateRelease: quarters.length ? withSeparateRelease.length / quarters.length : 0,
      lagDays: { min: lags.length ? Math.min(...lags) : null, median: lagQuantile(0.5), p90: lagQuantile(0.9), max: lags.length ? Math.max(...lags) : null, negative: lags.filter((value) => value < 0).length },
      nonIncreasingNextPublications: bounded.filter((row) => row.nextFirstPublicationEt! <= row.firstPublicationEt!).map((row) => `${row.ticker}/${row.fiscalPeriodEnd}`),
      windowsUnder20: calendarWindows.filter((row) => row.calendarDays < 20),
      windowsOver120: calendarWindows.filter((row) => row.calendarDays > 120),
      multipleEarningsSince2009_06: quarters.filter((row) => row.fiscalPeriodEnd >= "2009-06-01" && row.earningsFilings.length > 1).length,
      earningsFilingLinks: quarters.reduce((total, row) => total + row.earningsFilings.length, 0),
      chosenReleaseIsFirst: quarters.every((row) => row.earningsAccession === null ? row.earningsFilings.length === 0 : row.earningsFilings[0]?.accessionNo === row.earningsAccession),
    },
    windowSessions: windowStatistics(quarters.flatMap((row) => row.windowSessions === null ? [] : [row.windowSessions])),
    windowSessionsFrom2009_06: windowStatistics(quarters.flatMap((row) => row.fiscalPeriodEnd >= "2009-06-01" && row.windowSessions !== null ? [row.windowSessions] : [])),
  };
}
