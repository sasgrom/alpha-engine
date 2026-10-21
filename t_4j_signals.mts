/**
 * 4j (D43): signals ETL v1 — GDELT news tone for AAPL/NVDA/PLD into the
 * `signals` feature store (DDL 013). Stocktwits is honestly skipped here:
 * its API is Cloudflare-blocked from datacenter IPs (403) — worker-deferred
 * with a proper client (recorded in the manual + LLM_CONTEXT).
 *
 * GDELT discipline: ≤1 req / 5.5 s (their limit is 1/5s). eventTs = article
 * seendate, ingestedAt = now, score = GDELT tone/10 clamped to [−1,1],
 * src='live'. Idempotent via the UQ key. Run: npx tsx t_4j_signals.mts
 */
import { getDb } from "./api/queries/connection";
import { signals } from "@db/schema";
import { sql } from "drizzle-orm";

const db = getDb();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COMPANIES: { cik: number; ticker: string; query: string }[] = [
  { cik: 320193, ticker: "AAPL", query: '"Apple Inc" OR "AAPL" OR "Apple stock"' },
  { cik: 1045810, ticker: "NVDA", query: '"NVIDIA" OR "NVDA" OR "Nvidia stock"' },
  { cik: 1045609, ticker: "PLD", query: '"Prologis" OR "PLD stock"' },
];

interface GdeltArticle { seendate?: string; tone?: number; title?: string; url?: string }

async function gdeltArticles(query: string, timespan = "1month"): Promise<GdeltArticle[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=250&format=json&timespan=${timespan}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(url, { headers: { "User-Agent": "AlphaEngine research" } });
    if (resp.status === 429 && attempt < 3) {
      await sleep(30_000); // their limit is 1 req / 5 s — a 429 gets a long backoff
      continue;
    }
    if (!resp.ok) throw new Error(`GDELT HTTP ${resp.status}`);
    const json: any = await resp.json();
    return json?.articles ?? [];
  }
  throw new Error("GDELT 429 persisted");
}

/** GDELT seendate "20261019T123000Z" → "2026-10-19 12:30:00" (datetime col). */
function parseSeenDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
}

let total = 0;
for (const co of COMPANIES) {
  const articles = await gdeltArticles(co.query);
  await sleep(5600); // GDELT rate limit
  let kept = 0;
  const byDay = new Map<string, number>();
  for (const a of articles) {
    const ts = parseSeenDate(a.seendate);
    if (!ts) continue;
    const day = ts.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const tone = typeof a.tone === "number" ? Math.max(-1, Math.min(1, a.tone / 10)) : null;
    await db
      .insert(signals)
      .values({ cik: co.cik, source: "gdelt", signalType: "tone", eventTs: ts, ingestedAt: new Date().toISOString().slice(0, 19).replace("T", " "), score: tone, magnitude: 1, src: "live" })
      .onDuplicateKeyUpdate({ set: { score: tone } });
    kept++;
    total++;
  }
  // buzz rows: mention count per day
  for (const [day, n] of byDay) {
    await db
      .insert(signals)
      .values({ cik: co.cik, source: "gdelt", signalType: "buzz", eventTs: `${day} 00:00:00`, ingestedAt: new Date().toISOString().slice(0, 19).replace("T", " "), score: null, magnitude: n, src: "live" })
      .onDuplicateKeyUpdate({ set: { magnitude: n } });
  }
  const avgTone = articles.filter((a) => typeof a.tone === "number").reduce((s, a) => s + (a.tone as number), 0) / Math.max(1, articles.filter((a) => typeof a.tone === "number").length);
  console.log(`${co.ticker}: ${articles.length} articles, kept ${kept}, days with coverage ${byDay.size}, avg tone ${avgTone.toFixed(2)}`);
}
console.log(`PASS: signals ETL — ${total} tone rows`);
process.exit(0);
