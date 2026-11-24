/**
 * The Operations page's "Sources" table: for each data source the newest day its data holds, read from the files the
 * desk itself serves, with the last run of the job that refreshes it (worker/lib/source-freshness.ts judges the age).
 * Read only; small files, kept while their modification time and size are unchanged.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadOperationsState } from "../../worker/lib/operations-scheduler";
import { sortSources, sourceFreshness, type SourceInput, type SourceRow } from "../../worker/lib/source-freshness";
import { readDeskSnapshot } from "./desk-snapshot";

const cache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();
function readJson<T>(relative: string, root: string): T | null {
  const file = path.join(root, relative);
  if (!existsSync(file)) return null;
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.value as T;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as T;
    cache.set(file, { mtimeMs, size, value });
    return value;
  } catch { return null; } // a file being rewritten: the row says unknown, the next request reads it
}

interface RefreshSummary { status?: string; finishedAt?: string; startedAt?: string; error?: string; note?: string }
type Runs = Record<string, { status?: string | null; endedAt?: string | null; error?: string | null } | undefined>;

/** The rows' inputs from what is on disk. `runs` are the scheduler's last runs by job id. */
export function sourceInputs(root: string, runs: Runs, snapshotSession: string | null): SourceInput[] {
  const index = readJson<{ builtAt: string; filingsAsOf: string; insidersAsOf: string; insidersVersion: string; guidanceVersion: string; standard: string; standardGeneratedAt: string; holdersPeriod: string; holdersVersion: string; pricesAsOf: string }>("worker/.runs/desk-company/index.json", root);
  const guidance = readJson<{ asOf: string }>("worker/.runs/desk-company/guidance-market.json", root);
  const macro = readJson<{ archiveGeneratedAt: string; series: { seriesId: string; date: string }[] }>("worker/.runs/desk-macro.json", root);
  const short = readJson<{ asOf: string; settlements: string[] }>("worker/.runs/desk-short-interest.json", root);
  const markets = readJson<{ asOf: string }>("public/reports/prediction-markets.json", root);
  const refresh = (name: string): SourceInput["run"] => {
    const summary = readJson<RefreshSummary>(`worker/.runs/local-generated/${name}.json`, root);
    return summary ? { status: summary.status ?? null, endedAt: summary.finishedAt ?? summary.startedAt ?? null, error: summary.error ?? summary.note ?? null } : null;
  };
  const run = (jobId: string): SourceInput["run"] => { const last = runs[jobId]; return last ? { status: last.status ?? null, endedAt: last.endedAt ?? null, error: last.error ?? null } : null; };
  const dailyMacro = macro?.series.filter((point) => ["DGS10", "DGS2", "VIXCLS", "BAMLH0A0HYM2"].includes(point.seriesId)).map((point) => point.date).sort().at(-1) ?? null;
  return [
    { id: "filings", label: "SEC filings (10-K, 10-Q, 8-K)", newest: index?.filingsAsOf ?? null, what: "newest filing on the desk", arrives: "nightly 02:00, then the desk files", maxAgeDays: 4, run: run("desk-company-statements") ?? run("edgar-fetch-daily") },
    { id: "insiders", label: "Insider forms (3, 4, 5)", newest: index?.insidersAsOf ?? null, what: "newest form in the standard", arrives: "nightly 03:35, gated refresh", maxAgeDays: 5, run: refresh("std-insiders-refresh"), detail: index?.insidersVersion ?? null },
    { id: "guidance", label: "Guidance from earnings releases", newest: guidance?.asOf ?? null, what: "newest release with guidance", arrives: "nightly 02:25, local model, gated refresh", maxAgeDays: 7, run: refresh("std-guidance-refresh"), detail: index?.guidanceVersion ?? null },
    { id: "fundamentals", label: "Fundamentals (company statements)", newest: index?.standardGeneratedAt ?? null, what: "day the standard was built", arrives: "nightly 03:12, gated refresh", maxAgeDays: 4, run: refresh("std-fundamentals-refresh"), detail: index?.standard ?? null },
    { id: "prices", label: "Prices (closes on the desk)", newest: snapshotSession, what: "last session", arrives: "weekdays 16:10 and 16:45, live every 5 minutes", maxAgeDays: 4, run: run("schwab-daily-bars") },
    { id: "standard-prices", label: "Standard prices, splits and dividends", newest: index?.pricesAsOf ?? null, what: "last session in the standard", arrives: "Sundays 02:00, gated refresh", maxAgeDays: 10, run: refresh("std-prices-refresh") },
    { id: "holders", label: "Fund holdings (13F)", newest: index?.holdersPeriod ?? null, what: "newest quarter", arrives: "quarterly filings, 45 days after quarter end; standard built by hand", maxAgeDays: 140, run: run("13f-refresh"), detail: index?.holdersVersion ?? null },
    { id: "short-interest", label: "Short interest (FINRA)", newest: short?.asOf ?? null, what: "newest settlement", arrives: "twice a month, about seven business days after settlement; checked daily 06:25", maxAgeDays: 30, run: run("finra-short-interest") },
    { id: "macro", label: "Macro (FRED daily series)", newest: dailyMacro, what: "newest daily observation", arrives: "daily 05:30", maxAgeDays: 6, run: run("desk-macro") ?? run("macro-fred-weekly") },
    { id: "prediction-markets", label: "Prediction markets (Kalshi, Polymarket)", newest: markets?.asOf ?? null, what: "last capture", arrives: "daily 16:15", maxAgeDays: 2, run: run("prediction-markets-daily") },
  ];
}

export function readSourceFreshness(now: Date = new Date(), root: string = process.cwd()): { checkedAt: string; sources: SourceRow[] } {
  const state = loadOperationsState();
  return { checkedAt: now.toISOString(), sources: sortSources(sourceFreshness(sourceInputs(root, (state.lastRuns ?? {}) as Runs, readDeskSnapshot()?.session ?? null), now.toISOString())) };
}
