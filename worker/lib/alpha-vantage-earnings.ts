/**
 * Alpha Vantage EARNINGS (owner's go of 2026-11-25: "key is in .env, go"): the analysts' consensus EPS for each
 * reported quarter, with the reported EPS, the report date and its time of day. Research only; the raw answers stay on
 * D: and nothing from them reaches production.
 *
 * The free key allows 25 requests a day and 5 a minute. One request returns a company's whole history, so the first
 * pass covers the registry in about 20 days; after that the oldest copies are asked again, 25 a day, so new quarters
 * arrive. Every answer is stored as received, under its own date, and never rewritten.
 */

export const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
export const DAILY_LIMIT = 25;
export const SPACING_MS = 15_000;

export interface EarningsQuarter {
  fiscalDateEnding: string; reportedDate: string; reportedEPS: number | null; estimatedEPS: number | null;
  surprise: number | null; surprisePercentage: number | null; reportTime: string | null;
}
export type Answer =
  | { kind: "data"; symbol: string; quarters: EarningsQuarter[]; annual: number }
  | { kind: "empty" }
  | { kind: "limit"; message: string }
  | { kind: "refused"; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || value === "None") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Not a number: ${String(value).slice(0, 20)}`);
  return parsed;
};

/**
 * What an answer is. Alpha Vantage answers HTTP 200 for everything: a rate limit or a premium-only notice comes as
 * {"Information": ...} or {"Note": ...}, an unknown symbol as {} or {"Error Message": ...}. The notice text is kept
 * short and never contains the key (Alpha Vantage does not echo it).
 */
export function classifyAnswer(body: unknown): Answer {
  if (!body || typeof body !== "object") throw new Error("The answer is not a JSON object");
  const doc = body as Record<string, unknown>;
  const notice = String(doc.Information ?? doc.Note ?? "");
  if (notice) return /rate limit|requests per day|per minute|frequency|spreading out/i.test(notice) ? { kind: "limit", message: notice.slice(0, 200) } : { kind: "refused", message: notice.slice(0, 200) };
  if (doc["Error Message"] !== undefined || Object.keys(doc).length === 0) return { kind: "empty" };
  const quarterly = doc.quarterlyEarnings;
  if (!Array.isArray(quarterly)) throw new Error("The answer has no quarterlyEarnings list");
  if (!quarterly.length) return { kind: "empty" };
  const quarters = quarterly.map((row: any) => {
    if (!DATE.test(String(row?.fiscalDateEnding)) || !DATE.test(String(row?.reportedDate))) throw new Error(`A quarter has no valid dates: ${JSON.stringify(row).slice(0, 120)}`);
    return {
      fiscalDateEnding: row.fiscalDateEnding, reportedDate: row.reportedDate, reportedEPS: number(row.reportedEPS), estimatedEPS: number(row.estimatedEPS),
      surprise: number(row.surprise), surprisePercentage: number(row.surprisePercentage), reportTime: typeof row.reportTime === "string" && row.reportTime ? row.reportTime : null,
    };
  });
  const ends = quarters.map(row => row.fiscalDateEnding);
  if (new Set(ends).size !== ends.length) throw new Error("The answer lists a quarter twice");
  return { kind: "data", symbol: String(doc.symbol ?? ""), quarters, annual: Array.isArray(doc.annualEarnings) ? doc.annualEarnings.length : 0 };
}

/** The symbols to try for a registry ticker: as written, then with the other class separator (BRK.B / BRK-B). */
export function symbolsFor(ticker: string): string[] {
  const upper = ticker.trim().toUpperCase();
  const other = upper.includes(".") ? upper.replace(".", "-") : upper.includes("-") ? upper.replace("-", ".") : null;
  return other ? [upper, other] : [upper];
}

export interface ManifestEntry { cik: number; ticker: string; symbol: string | null; files: { date: string; file: string; sha256: string; bytes: number; quarters: number; withEstimate: number; first: string | null; last: string | null }[]; empty?: string[] }
export interface Manifest { schemaVersion: 1; source: string; tickers: Record<string, ManifestEntry>; runs: { at: string; requests: number; stored: number; empty: number; stoppedBy: string | null }[] }

/**
 * Today's tickers: first every registry ticker without a stored answer (in ticker order), then those whose newest
 * answer is oldest. A ticker found empty under every symbol is asked again only after 30 days.
 */
export function pickTickers(registry: { cik: number; ticker: string }[], manifest: Manifest, today: string, limit: number): { cik: number; ticker: string }[] {
  const age = (entry: ManifestEntry | undefined) => entry?.files.at(-1)?.date ?? null;
  const emptyRecently = (entry: ManifestEntry | undefined) => {
    const last = entry?.empty?.at(-1);
    return Boolean(last && !entry?.files.length && (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000 < 30);
  };
  const rows = [...registry].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const missing = rows.filter(row => !age(manifest.tickers[row.ticker]) && !emptyRecently(manifest.tickers[row.ticker]));
  const stale = rows.filter(row => age(manifest.tickers[row.ticker]) && age(manifest.tickers[row.ticker])! < today)
    .sort((a, b) => age(manifest.tickers[a.ticker])!.localeCompare(age(manifest.tickers[b.ticker])!) || a.ticker.localeCompare(b.ticker));
  return [...missing, ...stale].slice(0, limit);
}
