/**
 * Corporate event stream (iteration 4a, D28) — materialized from OUR OWN
 * filings, no external earnings calendar needed.
 *
 * v1 event type: "earnings" = an 8-K carrying Item 2.02 (Results of
 * Operations and Financial Condition) — the canonical earnings-release
 * vehicle. Point-in-time by construction: `filingDate` is when the event
 * became public, so the stream is no-lookahead out of the box and feeds
 * Stage 2 (event text), Stage 4 (changepoints) and Stage 5 (event studies).
 *
 * The builder is a cheap DB-only scan over filings.items; the runner calls
 * it after every bootstrap / filings-refresh / stream job.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { events, filings, insiderTrades } from "@db/schema";

/**
 * Item-token match (pure, tested): "2.02" must be a standalone token —
 * a substring test would false-positive on "12.02"… The SEC writes item
 * lists as "2.02,9.01" (sometimes with an "Item " prefix in older filings).
 */
export function isEarningsRelease(items: string | null | undefined): boolean {
  if (!items) return false;
  return items
    .split(",")
    .map((t) => t.trim().replace(/^item\s+/i, ""))
    .includes("2.02");
}

/** Rebuild one company's earnings events from its 8-K filings. */
export async function rebuildCompanyEvents(cik: number): Promise<{ scanned: number; added: number }> {
  const db = getDb();
  const rows = await db
    .select({
      accessionNo: filings.accessionNo,
      items: filings.items,
      filingDate: filings.filingDate,
      reportDate: filings.reportDate,
    })
    .from(filings)
    .where(and(eq(filings.cik, cik), eq(filings.form, "8-K"), isNotNull(filings.items)));

  const hits = rows.filter((r) => isEarningsRelease(r.items));
  // idempotency by explicit existence check — onDuplicateKeyUpdate counts
  // "found rows" even for no-op writes (mysql2 CLIENT_FOUND_ROWS), which
  // would misreport re-runs as new events
  const existing = await db
    .select({ accessionNo: events.accessionNo })
    .from(events)
    .where(and(eq(events.cik, cik), eq(events.type, "earnings")));
  const have = new Set(existing.map((e) => e.accessionNo));
  let added = 0;
  for (const h of hits) {
    const eventDate = h.reportDate ?? h.filingDate;
    if (!eventDate || have.has(h.accessionNo)) continue;
    await db.insert(events).values({ cik, type: "earnings", eventDate, filingDate: h.filingDate, accessionNo: h.accessionNo });
    added++;
  }
  return { scanned: rows.length, added };
}

// ---------------------------------------------------------------------------
// Insider-cluster events (4m, D46)
// ---------------------------------------------------------------------------

export interface InsiderTradeInput {
  insiderName: string | null;
  code: string;
  tradeDate: string | null;
  filingDate: string;
  is10b5: boolean;
  shares: number | null;
  price: number | null;
}

export interface InsiderCluster {
  endDate: string;    // last trade date in the window (the event date)
  filingDate: string; // max filingDate in the window — when it became PUBLIC
  insiders: string[];
  totalDollars: number | null;
}

/**
 * Cluster-buying detector (pure, unit-tested): only open-market PURCHASES
 * count (code P) and planned 10b5-1 trades never do — Cohen–Malloy–Pomorski
 * (2012, "Decoding Inside Information"): routine/planned trades carry no
 * information. A cluster = ≥ minInsiders DISTINCT insiders buying within a
 * sliding windowDays window. Overlapping windows merge (we keep the maximal
 * span per contiguous run). Honest note: mega-caps may show zero purchases
 * for years — the detector fires when it fires, never on noise.
 */
export function detectInsiderClusters(
  trades: InsiderTradeInput[],
  windowDays = 30,
  minInsiders = 3
): InsiderCluster[] {
  const buys = trades
    .filter((t) => t.code === "P" && !t.is10b5 && t.tradeDate)
    .sort((a, b) => (a.tradeDate as string).localeCompare(b.tradeDate as string));
  const clusters: InsiderCluster[] = [];
  let i = 0;
  while (i < buys.length) {
    const start = Date.parse(buys[i].tradeDate as string);
    let j = i;
    while (j + 1 < buys.length && Date.parse(buys[j + 1].tradeDate as string) - start <= windowDays * 86_400_000) j++;
    // window [i..j]: collect the maximal run with ≥minInsiders distinct buyers
    const insiders = new Set<string>();
    let dollars = 0;
    let hasDollars = false;
    let maxFiled = buys[i].filingDate;
    for (let k = i; k <= j; k++) {
      insiders.add(buys[k].insiderName ?? "?");
      if (buys[k].shares !== null && buys[k].price !== null) {
        dollars += (buys[k].shares as number) * (buys[k].price as number);
        hasDollars = true;
      }
      if (buys[k].filingDate > maxFiled) maxFiled = buys[k].filingDate;
    }
    if (insiders.size >= minInsiders) {
      clusters.push({
        endDate: buys[j].tradeDate as string,
        filingDate: maxFiled,
        insiders: [...insiders].sort(),
        totalDollars: hasDollars ? dollars : null,
      });
      i = j + 1; // merged: skip past the cluster
    } else {
      i++;
    }
  }
  return clusters;
}

/** Rebuild one company's insider-cluster events from its insider_trades. */
export async function rebuildCompanyInsiderClusters(cik: number): Promise<{ scanned: number; added: number }> {
  const db = getDb();
  const rows = await db
    .select({
      insiderName: insiderTrades.insiderName,
      code: insiderTrades.code,
      tradeDate: insiderTrades.tradeDate,
      filingDate: insiderTrades.filingDate,
      is10b5: insiderTrades.is10b5,
      shares: insiderTrades.shares,
      price: insiderTrades.price,
    })
    .from(insiderTrades)
    .where(eq(insiderTrades.cik, cik));
  const clusters = detectInsiderClusters(rows);
  // idempotency by explicit existence check (the 4a mysql2 found-rows lesson)
  const existing = await db
    .select({ accessionNo: events.accessionNo })
    .from(events)
    .where(and(eq(events.cik, cik), eq(events.type, "insider_cluster")));
  const have = new Set(existing.map((e) => e.accessionNo));
  let added = 0;
  for (const cl of clusters) {
    const key = `cluster:${cik}:${cl.endDate}`;
    if (have.has(key)) continue;
    await db.insert(events).values({ cik, type: "insider_cluster", eventDate: cl.endDate, filingDate: cl.filingDate, accessionNo: key });
    added++;
  }
  return { scanned: rows.length, added };
}

/** Rebuild events for every company that has any itemized 8-K. */
export async function rebuildAllEvents(): Promise<{ companies: number; scanned: number; added: number }> {
  const db = getDb();
  const ciks: any = await db.execute(
    sql`SELECT DISTINCT cik FROM filings WHERE form='8-K' AND items IS NOT NULL`
  );
  // 4m: companies with insider trades join the rebuild set too
  const insCiks: any = await db.execute(sql`SELECT DISTINCT cik FROM insider_trades`);
  const allCiks = new Set<number>([
    ...(ciks[0] ?? []).map((r: any) => Number(r.cik)),
    ...(insCiks[0] ?? []).map((r: any) => Number(r.cik)),
  ]);
  let scanned = 0, added = 0;
  for (const cik of allCiks) {
    const r = await rebuildCompanyEvents(cik);
    scanned += r.scanned;
    added += r.added;
    const ic = await rebuildCompanyInsiderClusters(cik);
    added += ic.added;
  }
  return { companies: allCiks.size, scanned, added };
}
