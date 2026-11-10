export const FIGI_MAX_JOBS_PER_REQUEST = 10;
export const FIGI_MAX_429_RETRIES = 2;

/** Preserve the complete provider label; company resolution still uses exact ticker matches. */
export function normalizeFigiTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

export function normalizeCusip(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{9}$/.test(value)) throw new Error("CUSIP must contain exactly nine alphanumeric characters");
  return value.toUpperCase();
}

const EXCHANGE_ALIASES: Record<string, string[]> = {
  NYSE: ["NYSE", "XNYS", "NEW YORK STOCK EXCHANGE"],
  NASDAQ: ["NASDAQ", "XNAS", "NASDAQ STOCK MARKET"],
  TSX: ["TSX", "XTSE", "TORONTO STOCK EXCHANGE"],
  TSXV: ["TSXV", "XTSX", "TSX VENTURE EXCHANGE"],
  LSE: ["LSE", "XLON", "LONDON STOCK EXCHANGE"],
};

function exchangeMatches(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  const a = normalize(left), b = normalize(right);
  return a === b || Object.values(EXCHANGE_ALIASES).some((aliases) => aliases.includes(a) && aliases.includes(b));
}

export function resolveCompanyCik(
  candidate: { ticker: unknown; exchCode?: unknown },
  companies: { cik: number; ticker: string; exchange?: string | null }[],
): { cik: number | null; reason: string | null } {
  if (typeof candidate.ticker !== "string" || !candidate.ticker.trim()) return { cik: null, reason: "missing_ticker" };
  const ticker = candidate.ticker.trim().toUpperCase();
  const matches = companies.filter((company) => company.ticker.trim().toUpperCase() === ticker);
  if (!matches.length) return { cik: null, reason: "no_ticker_match" };
  const exchCode = typeof candidate.exchCode === "string" && candidate.exchCode.trim() ? candidate.exchCode.trim() : null;
  const exchangeMatchesCandidate = (company: { exchange?: string | null }) => !exchCode || !company.exchange || exchangeMatches(exchCode, company.exchange);
  const compatible = matches.filter(exchangeMatchesCandidate);
  if (!compatible.length) return { cik: null, reason: "exchange_mismatch" };
  if (compatible.length > 1) return { cik: null, reason: "ambiguous_ticker" };
  return { cik: compatible[0].cik, reason: null };
}

/** Split mapping jobs without crossing OpenFIGI's documented request limit. */
export function chunkFigiIds<T>(ids: T[], size = FIGI_MAX_JOBS_PER_REQUEST): Array<{ start: number; items: T[] }> {
  if (!Number.isInteger(size) || size < 1 || size > FIGI_MAX_JOBS_PER_REQUEST) {
    throw new Error(`FIGI chunk size must be between 1 and ${FIGI_MAX_JOBS_PER_REQUEST}`);
  }
  const chunks: Array<{ start: number; items: T[] }> = [];
  for (let start = 0; start < ids.length; start += size) chunks.push({ start, items: ids.slice(start, start + size) });
  return chunks;
}

export function shouldRetryFigi429(attempt: number): boolean {
  return attempt < FIGI_MAX_429_RETRIES;
}

export function formatFigiError(error: unknown, context: { start: number; size: number; firstCusips: string[] }): string {
  const candidate = error as { message?: string; code?: string; errno?: number; sqlState?: string; cause?: unknown };
  const cause = (candidate?.cause ?? error) as { message?: string; code?: string; errno?: number; sqlState?: string };
  const message = cause?.message ?? String(cause);
  const metadata = [
    `chunkStart=${context.start}`,
    `chunkSize=${context.size}`,
    `firstCusips=${context.firstCusips.join(",")}`,
    cause?.code ? `code=${cause.code}` : null,
    cause?.errno !== undefined ? `errno=${cause.errno}` : null,
    cause?.sqlState ? `sqlState=${cause.sqlState}` : null,
  ].filter(Boolean).join(" ");
  return `${message} [${metadata}]`;
}
