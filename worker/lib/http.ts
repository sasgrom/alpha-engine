/**
 * Tiny HTTP helper for home workers: fetch JSON with a hard timeout and
 * retry with exponential backoff + jitter. Residential-network honest:
 * timeouts and 5xx are retried, 4xx are fatal (they won't heal).
 */
export async function fetchJson<T = unknown>(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string>; method?: string; body?: string } = {}
): Promise<T> {
  const { timeoutMs = 20_000, retries = 3, headers = {}, method = "GET", body } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, body, headers, signal: ctrl.signal });
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        throw Object.assign(new Error(`HTTP ${res.status} (fatal): ${text.slice(0, 300)}`), { fatal: true });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e: any) {
      lastErr = e;
      if (e?.fatal) throw e;
      if (attempt < retries) {
        const wait = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
        await new Promise((r) => setTimeout(r, wait));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
