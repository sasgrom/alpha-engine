export const FIGI_MAX_JOBS_PER_REQUEST = 10;
export const FIGI_MAX_429_RETRIES = 2;

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
