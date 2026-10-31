/**
 * Short interest service (4m, D46) — settlement-dated short interest.
 *
 * Sources by honesty rank: FINRA biweekly files (official, worker-collected)
 * and yahoo_gw (Yahoo via the agent gateway — carries the settlement date
 * plus the prior month's value, so one pull yields two honest points).
 * The plugin call happens sandbox/worker-side (no python in the prod
 * container); this module owns parsing + storage.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { shortInterest, type ShortInterest } from "@db/schema";

/** One settlement-dated SI point, parsed from the yahoo stock-info CSV row. */
export interface SiPoint {
  settlementDate: string; // YYYY-MM-DD
  sharesShort: number | null;
  shortRatio: number | null;
  shortPercentOfFloat: number | null;
}

/** Yahoo CSV field → epoch or number, null-safe (""/"None" → null). */
export function siField(row: Record<string, string>, key: string): number | null {
  const v = row[key];
  if (v === undefined || v === "" || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** epoch seconds → YYYY-MM-DD (UTC) — Yahoo's dateShortInterest arrives as epoch. */
export function epochToDate(epoch: number | null): string | null {
  if (epoch === null || !Number.isFinite(epoch)) return null;
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

/** One CSV row split that respects quoted fields ("a,b" inside quotes stays whole). */
export function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse the yahoo stock-info CSV into SI points: the current settlement AND
 * the prior month's (Yahoo carries both — one pull = two honest points).
 */
export function parseSiCsv(csvText: string): SiPoint[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const header = splitCsvRow(lines[0]).map((h) => h.trim());
  const values = splitCsvRow(lines[1]);
  const row: Record<string, string> = {};
  header.forEach((h, i) => (row[h] = (values[i] ?? "").trim()));

  const out: SiPoint[] = [];
  const curDate = epochToDate(siField(row, "dateShortInterest"));
  if (curDate) {
    out.push({
      settlementDate: curDate,
      sharesShort: siField(row, "sharesShort"),
      shortRatio: siField(row, "shortRatio"),
      shortPercentOfFloat: siField(row, "shortPercentOfFloat"),
    });
  }
  const prevDate = epochToDate(siField(row, "sharesShortPreviousMonthDate"));
  if (prevDate) {
    out.push({
      settlementDate: prevDate,
      sharesShort: siField(row, "sharesShortPriorMonth"),
      shortRatio: null, // Yahoo carries no prior-month ratio/cover
      shortPercentOfFloat: null,
    });
  }
  return out;
}

/** Store SI points (idempotent via the UQ key). Returns rows written. */
export async function ingestShortInterest(cik: number, points: SiPoint[], source: "yahoo_gw" | "finra"): Promise<number> {
  const db = getDb();
  let n = 0;
  for (const p of points) {
    await db
      .insert(shortInterest)
      .values({ cik, settlementDate: p.settlementDate, sharesShort: p.sharesShort, shortRatio: p.shortRatio, shortPercentOfFloat: p.shortPercentOfFloat, source })
      .onDuplicateKeyUpdate({ set: { sharesShort: p.sharesShort, shortRatio: p.shortRatio, shortPercentOfFloat: p.shortPercentOfFloat } });
    n++;
  }
  return n;
}

/** Latest SI state per company: current row + prior + delta. */
export async function latestShortInterest(cik: number): Promise<{
  current: ShortInterest | null;
  prior: ShortInterest | null;
  deltaShares: number | null;
} | null> {
  const rows = await getDb()
    .select()
    .from(shortInterest)
    .where(eq(shortInterest.cik, cik))
    .orderBy(desc(shortInterest.settlementDate))
    .limit(2);
  if (rows.length === 0) return null;
  const [current, prior] = rows;
  return {
    current,
    prior: prior ?? null,
    deltaShares: current.sharesShort !== null && prior?.sharesShort != null ? current.sharesShort - prior.sharesShort : null,
  };
}
