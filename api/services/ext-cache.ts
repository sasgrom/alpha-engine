/**
 * DB-backed cache for slow external payloads (iteration 3l, D27).
 *
 * Owner principle: "fetched once → stored in the DB → nobody waits for a
 * refetch". Before this, every cold process (each redeploy!) re-hit SEC for
 * the 12k-row company directory and Wikipedia for index constituents, and
 * the first user of the day paid seconds of latency.
 *
 * Semantics = stale-while-revalidate:
 *   - fresh row (age < ttl)  → served from DB;
 *   - stale row              → served IMMEDIATELY, background refresh fired;
 *   - no row                 → live fetch, then persisted.
 * A failed refresh never breaks reads — stale data keeps being served.
 * Single-instance deployment by design (the runner is in-process); a double
 * background refresh across instances would be harmless anyway (upsert).
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { externalCache } from "@db/schema";

export interface CachedPayload<T> {
  data: T;
  /** ISO time the payload was fetched (staleness honesty for the UI) */
  asOf: string;
  /** true = within TTL; false = stale data served while a refresh runs */
  fresh: boolean;
  source: string;
}

/** Pure TTL decision — unit-tested. */
export function cacheState(fetchedAtMs: number | null, nowMs: number, ttlMs: number): "miss" | "fresh" | "stale" {
  if (fetchedAtMs === null) return "miss";
  return nowMs - fetchedAtMs <= ttlMs ? "fresh" : "stale";
}

/** one background refresh per key at a time */
const refreshing = new Map<string, Promise<void>>();

async function persist(key: string, data: unknown, source: string): Promise<void> {
  const db = getDb();
  await db
    .insert(externalCache)
    .values({ key, payload: JSON.stringify(data), source })
    .onDuplicateKeyUpdate({
      set: { payload: sql`VALUES(\`payload\`)`, fetchedAt: sql`VALUES(\`fetchedAt\`)`, source: sql`VALUES(\`source\`)` },
    });
}

function refreshInBackground<T>(key: string, fetcher: () => Promise<T>): void {
  if (refreshing.has(key)) return;
  const p = (async () => {
    try {
      const data = await fetcher();
      await persist(key, data, "live");
    } catch (e) {
      // stale data keeps being served; the failure is logged, never fatal
      console.warn(`[ext-cache] background refresh failed for ${key}:`, String(e));
    } finally {
      refreshing.delete(key);
    }
  })();
  refreshing.set(key, p);
}

/**
 * Read-through cache. `fetcher` performs the live external call and must
 * return a JSON-serializable payload. On a total miss the fetcher error
 * propagates (callers keep their existing fallbacks, e.g. the GICS snapshot).
 */
export async function cachedExternal<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<CachedPayload<T>> {
  const db = getDb();
  const [row] = await db.select().from(externalCache).where(eq(externalCache.key, key));
  const fetchedAtMs = row ? new Date(row.fetchedAt).getTime() : null;
  const state = cacheState(fetchedAtMs, Date.now(), ttlMs);

  if (state === "fresh" && row) {
    return { data: JSON.parse(row.payload) as T, asOf: row.fetchedAt.toISOString(), fresh: true, source: row.source };
  }
  if (state === "stale" && row) {
    refreshInBackground(key, fetcher);
    return { data: JSON.parse(row.payload) as T, asOf: row.fetchedAt.toISOString(), fresh: false, source: row.source };
  }
  // miss — the only path that pays the external latency
  const data = await fetcher();
  await persist(key, data, "live");
  const now = new Date().toISOString();
  return { data, asOf: now, fresh: true, source: "live" };
}
