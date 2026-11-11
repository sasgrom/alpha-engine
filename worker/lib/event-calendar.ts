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
  otherEarningsAccessions: string[];
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

export function buildQuarters(filings: CalendarFiling[], spyDates: string[]): CalendarQuarter[] {
  const byCompany = new Map<number, CalendarFiling[]>();
  for (const filing of filings) byCompany.set(filing.cik, [...(byCompany.get(filing.cik) ?? []), filing]);
  const output: CalendarQuarter[] = [];
  for (const rows of byCompany.values()) {
    const periodic = rows.filter((row) => /^(10-K|10-K\/A|10-Q|10-Q\/A)$/i.test(row.form) && row.reportDate).sort((a, b) => (a.acceptedUtc ?? "").localeCompare(b.acceptedUtc ?? "") || a.accessionNo.localeCompare(b.accessionNo));
    const earnings = rows.filter((row) => row.isEarningsRelease === true && row.acceptedUtc).sort((a, b) => a.acceptedUtc!.localeCompare(b.acceptedUtc!));
    const firstPublications: (string | null)[] = [];
    for (let index = 0; index < periodic.length; index++) {
      const row = periodic[index];
      const periodEnd = row.reportDate!;
      const candidates = earnings.filter((release) => release.acceptedUtc! > periodEnd && release.acceptedUtc! <= (row.acceptedUtc ?? periodEnd));
      const release = candidates[0];
      const first = release?.acceptedEt ?? row.acceptedEt;
      firstPublications.push(first);
      output.push({
        cik: row.cik,
        ticker: row.ticker,
        fiscalPeriodEnd: periodEnd,
        periodicForm: row.form,
        periodicAccession: row.accessionNo,
        periodicAcceptedEt: row.acceptedEt,
        earningsAccession: release?.accessionNo ?? null,
        earningsAcceptedEt: release?.acceptedEt ?? null,
        firstPublicationEt: first,
        pairingBasis: release ? "earnings_8k" : "periodic_only",
        otherEarningsAccessions: candidates.slice(1).map((candidate) => candidate.accessionNo),
        nextFirstPublicationEt: null,
        windowSessions: null,
      });
    }
    const start = output.length - periodic.length;
    for (let index = 0; index < periodic.length; index++) {
      const current = output[start + index];
      const next = firstPublications[index + 1] ?? null;
      current.nextFirstPublicationEt = next;
      if (current.firstPublicationEt && next) {
        const firstDate = current.firstPublicationEt.slice(0, 10), nextDate = next.slice(0, 10);
        current.windowSessions = spyDates.filter((date) => date > firstDate && date < nextDate).length;
      }
    }
  }
  return output.sort((a, b) => a.cik - b.cik || a.fiscalPeriodEnd.localeCompare(b.fiscalPeriodEnd) || a.periodicAccession.localeCompare(b.periodicAccession));
}

export function acceptanceChecks(filings: CalendarFiling[], quarters: CalendarQuarter[]) {
  const recent = filings.filter((row) => row.filingDate >= "2004-01-01");
  const items8k = filings.filter((row) => /^(8-K|8-K\/A)$/i.test(row.form) && row.filingDate >= "2004-08-23");
  const withSeparateRelease = quarters.filter((row) => row.earningsAccession !== null);
  const lags = withSeparateRelease.map((row) => Math.round((Date.parse(row.periodicAcceptedEt!) - Date.parse(row.earningsAcceptedEt!)) / 86_400_000));
  const windows = quarters.map((row) => row.windowSessions).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const quantile = (values: number[], q: number) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))] : null;
  const lagQuantile = (q: number) => quantile([...lags].sort((a, b) => a - b), q);
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
    quarters: {
      total: quarters.length,
      withSeparateRelease: withSeparateRelease.length,
      shareWithSeparateRelease: quarters.length ? withSeparateRelease.length / quarters.length : 0,
      lagDays: { min: lags.length ? Math.min(...lags) : null, median: lagQuantile(0.5), p90: lagQuantile(0.9), max: lags.length ? Math.max(...lags) : null, negative: lags.filter((value) => value < 0).length },
      under20: withSeparateRelease.filter((row) => Math.round((Date.parse(row.periodicAcceptedEt!) - Date.parse(row.earningsAcceptedEt!)) / 86_400_000) < 20).map((row) => `${row.ticker}/${row.fiscalPeriodEnd}`),
      over120: withSeparateRelease.filter((row) => Math.round((Date.parse(row.periodicAcceptedEt!) - Date.parse(row.earningsAcceptedEt!)) / 86_400_000) > 120).map((row) => `${row.ticker}/${row.fiscalPeriodEnd}`),
    },
    windowSessions: {
      count: windows.length,
      median: quantile(windows, 0.5),
      p05: quantile(windows, 0.05),
      p95: quantile(windows, 0.95),
      share20: windows.length ? windows.filter((value) => value === 20).length / windows.length : 0,
      share30: windows.length ? windows.filter((value) => value === 30).length / windows.length : 0,
      share45: windows.length ? windows.filter((value) => value === 45).length / windows.length : 0,
    },
  };
}
