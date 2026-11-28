import { R1000_EDGAR_FORMS } from "./r1000-edgar-scope";

export function r1000LatestFiling<T extends { accessionNo: string; form: string; filingDate: string; acceptedEt?: string | null; eventTs?: string }>(filings: T[]): T | null {
  return filings.filter(row => (R1000_EDGAR_FORMS as readonly string[]).includes(row.form) && row.filingDate >= "2019-01-01").sort((a, b) =>
    a.filingDate.localeCompare(b.filingDate) || String(a.acceptedEt ?? a.eventTs ?? "").localeCompare(String(b.acceptedEt ?? b.eventTs ?? "")) || a.accessionNo.localeCompare(b.accessionNo)
  ).at(-1) ?? null;
}

export function r1000CompanyFactsPeriod(payload: any): string | null {
  let latest: string | null = null;
  for (const taxonomy of Object.values(payload?.facts ?? {}) as any[]) {
    for (const concept of Object.values(taxonomy) as any[]) {
      for (const rows of Object.values(concept.units ?? {}) as any[][]) {
        for (const row of rows) if (typeof row.end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.end) && (!latest || row.end > latest)) latest = row.end;
      }
    }
  }
  return latest;
}

export function r1000DeterministicSample<T extends { cik: number }>(rows: T[], count: number, seed: number): T[] {
  const result = [...rows].sort((a, b) => a.cik - b.cik);
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const other = (state >>> 0) % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result.slice(0, Math.min(count, result.length));
}

export function r1000LastCandle(payload: any): { date: string; close: number | null } | null {
  const row = payload?.candles?.at(-1);
  if (!row || !Number.isFinite(row.datetime)) return null;
  return { date: new Date(row.datetime).toISOString().slice(0, 10), close: typeof row.close === "number" && Number.isFinite(row.close) ? row.close : null };
}

export function r1000ReusablePanelFreshness(previous: any, panel: string, date: string): boolean {
  return previous?.pass === true && previous.panel === panel && previous.date === date && previous.benchmark?.date === date;
}
