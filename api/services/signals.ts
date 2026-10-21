/**
 * Signals collector (4j/4k, D43) — the pipeline the local worker will run on
 * a schedule. v1 source: GDELT DOC 2.0 API (free, native Goldstein tone,
 * history to 2017 for backfills). Network-reality note (proven 2026-10-19):
 * datacenter IPs get hard-throttled (429) — the collector belongs to the
 * home worker; the sandbox proves the path with fixtures in tests.
 *
 * Discipline: GDELT ≤ 1 req / 5 s; every signal carries eventTs (content
 * time) + ingestedAt (arrival) — the no-lookahead pair (D43).
 */
import { getDb } from "../queries/connection";
import { signals } from "@db/schema";

export interface GdeltArticle { seendate?: string; tone?: number; title?: string; url?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GDELT artlist query → articles. 429 gets a long backoff (their limit). */
export async function gdeltArticles(query: string, timespan = "1month", maxrecords = 250): Promise<GdeltArticle[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${maxrecords}&format=json&timespan=${timespan}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(url, { headers: { "User-Agent": "AlphaEngine research" } });
    if (resp.status === 429 && attempt < 3) {
      await sleep(30_000);
      continue;
    }
    if (!resp.ok) throw new Error(`GDELT HTTP ${resp.status}`);
    const json: any = await resp.json();
    return json?.articles ?? [];
  }
  throw new Error("GDELT 429 persisted");
}

/** GDELT seendate "20261019T123000Z" → "2026-10-19 12:30:00" (datetime col). */
export function parseSeenDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
}

/** GDELT Goldstein-scaled tone → our [−1, +1] clamp. */
export function toneToScore(tone: number | undefined): number | null {
  if (typeof tone !== "number" || !Number.isFinite(tone)) return null;
  return Math.max(-1, Math.min(1, tone / 10));
}

/**
 * Ingest one company's articles: per-article tone rows + per-day buzz rows.
 * Idempotent via the UQ key; returns counts for the log.
 */
export async function ingestGdeltSignals(
  cik: number,
  articles: GdeltArticle[],
  src: "live" | "backfill" = "live"
): Promise<{ tone: number; buzzDays: number }> {
  const db = getDb();
  const ingestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  let tone = 0;
  const byDay = new Map<string, number>();
  for (const a of articles) {
    const ts = parseSeenDate(a.seendate);
    if (!ts) continue;
    const day = ts.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const score = toneToScore(a.tone);
    await db
      .insert(signals)
      .values({ cik, source: "gdelt", signalType: "tone", eventTs: ts, ingestedAt, score, magnitude: 1, src })
      .onDuplicateKeyUpdate({ set: { score } });
    tone++;
  }
  for (const [day, n] of byDay) {
    await db
      .insert(signals)
      .values({ cik, source: "gdelt", signalType: "buzz", eventTs: `${day} 00:00:00`, ingestedAt, score: null, magnitude: n, src })
      .onDuplicateKeyUpdate({ set: { magnitude: n } });
  }
  return { tone, buzzDays: byDay.size };
}
