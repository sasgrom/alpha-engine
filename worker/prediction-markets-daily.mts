/** Daily, keyless prediction-market collection. Public data stays on D:; production promotion is out of scope. */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDb } from "../api/queries/connection";
import type { CompanyMapping, CompanyMappingEntry, PredictionSnapshot } from "../contracts/prediction-markets";
import { AuthRequiredError, publicHttp } from "./lib/prediction-market-http";
import { classifyCompanySeries, companyNameKeys, marketWideSeries, namesIn, tickerGuess, type CompanyRegistry } from "./lib/prediction-market-mapping";
import { buildPredictionExpectations, dailyExpectationState, excludedMarket, jsonArray, kalshiSnapshot, numericMarket, polyOutcome, polymarketSnapshot, settled, type JsonObject } from "./lib/prediction-markets";
import { httpPredictionSources, type PredictionSources } from "./lib/prediction-market-sources";
import { appendSnapshots, mergePolySettlement, nodePredictionStore, previousFedUpper, readSnapshots, updateDailyState, type PredictionStore } from "./lib/prediction-market-storage";

const MACRO_SERIES = ["KXFED", "KXCPI", "KXCPICORE", "KXCPIYOY", "KXPAYROLLS", "KXU3", "KXRECSSNBER", "JOBLESS", "KXJOBLESS", "GDP", "KXGDP", "KXPCECORE", "KXECONSTATU3", "KXQRECESS", "KXRATECUT", "KXFEDCUT"];
const POLY_TOPICS = ["fed", "cpi", "recession", "payrolls", "unemployment"];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);
const fileName = (ticker: string) => ticker.replace(/[^A-Za-z0-9._-]/g, "_");

export interface DailyRunOptions {
  root: string;
  sources: PredictionSources;
  store: PredictionStore;
  registry: CompanyRegistry;
  now?: () => Date;
  day?: string;
  scheduledStyle?: boolean;
  publicReportFile?: string;
  network?: { requests: number; retries: number };
}

export interface DailyRunManifest {
  schemaVersion: 1;
  runId: string;
  invocation: "manual" | "scheduled-style";
  status: "complete" | "partial" | "failed" | "key_required";
  startedAt: string;
  finishedAt: string;
  counts: Record<string, number>;
  series: Record<string, number>;
  mapping: { file: string; acceptedSeries: number; companies: number; rejectedSeries: number; sha256: string | null; status: string };
  artifacts: Record<string, string>;
  errors: { scope: string; error: string }[];
  quarantine: { market: string; reason: string }[];
  network?: { requests: number; retries: number };
}

export async function runDailyCollection(options: DailyRunOptions): Promise<DailyRunManifest> {
  const { root, sources, store, registry } = options;
  const current = () => (options.now?.() ?? new Date()).toISOString();
  const startedAt = current();
  const day = options.day ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(options.now?.() ?? new Date()), invocation = options.scheduledStyle ? "scheduled-style" as const : "manual" as const;
  const errors: { scope: string; error: string }[] = [], quarantine: { market: string; reason: string }[] = [];
  const companySnapshots: PredictionSnapshot[] = [], kalshiMacroSnapshots: PredictionSnapshot[] = [], polySnapshots: PredictionSnapshot[] = [];
  let mappingAccepted: CompanyMappingEntry[] = [], mappingRejected: CompanyMapping["rejected"] = [], mappingStatus = "complete";
  let settledHistories = 0, cachedHistories = 0, missingHistories = 0;
  const fail = (scope: string, error: unknown) => {
    if (error instanceof AuthRequiredError) throw error;
    errors.push({ scope, error: errorText(error) });
  };
  try {
    const keys = companyNameKeys(registry), rawSeries = await sources.series();
    const companyMarkets = new Map<string, JsonObject[]>(), mappingErrors: string[] = [];
    for (const series of rawSeries) {
      if (series.category !== "Companies" && series.category !== "Financials") continue;
      const code = text(series.ticker), title = text(series.title);
      if (marketWideSeries(code, title)) continue;
      if (!tickerGuess(code, registry) && !namesIn(title, keys).size) continue;
      if (excludedMarket(title, text(series.category))) continue;
      try {
        const markets = await sources.markets(code);
        companyMarkets.set(code, markets);
        const result = classifyCompanySeries(series, markets, registry, keys);
        if (result.entry) mappingAccepted.push(result.entry);
        if (result.rejected) mappingRejected.push(result.rejected);
      } catch (error) {
        mappingErrors.push(code);
        fail(`company series ${code}`, error);
      }
    }
    const mappingFile = path.join(root, "kalshi", "companies", "mapping.json");
    if (mappingErrors.length) {
      mappingStatus = "previous_preserved";
      mappingAccepted = store.exists(mappingFile) ? (store.readJson(mappingFile) as CompanyMapping).accepted : [];
      mappingRejected = store.exists(mappingFile) ? (store.readJson(mappingFile) as CompanyMapping).rejected : [];
      for (const entry of mappingAccepted) if (!companyMarkets.has(entry.series)) {
        try { companyMarkets.set(entry.series, await sources.markets(entry.series)); } catch (error) { fail(`previous company series ${entry.series}`, error); }
      }
    } else {
      for (const entry of mappingAccepted) for (const [key, value] of Object.entries(entry)) if (value === undefined) throw new Error(`Incomplete company mapping for ${entry.series}`);
    }
    const macroMarkets = new Map<string, JsonObject[]>();
    for (const series of MACRO_SERIES) {
      try { macroMarkets.set(series, await sources.markets(series)); } catch (error) { fail(`macro series ${series}`, error); }
    }

    const kalshiHistory = async (series: string, market: JsonObject, company: boolean): Promise<string | null> => {
      const folder = company ? path.join("companies", series) : series;
      const relative = path.join("kalshi", folder, "candles", `${fileName(text(market.ticker))}.json`), file = path.join(root, relative);
      if (store.exists(file)) {
        const stored = store.readJson(file);
        if (stored.ticker !== market.ticker || !Array.isArray(stored.candles)) throw new Error(`Invalid cached candles for ${text(market.ticker)}`);
        cachedHistories++;
        return relative;
      }
      const candles = await sources.candles(series, market);
      if (candles === null) { missingHistories++; return null; }
      store.writeJson(file, { ticker: market.ticker, fetchedAt: current(), candles });
      settledHistories++;
      return relative;
    };
    const capture = async (market: JsonObject, series: string, company: boolean, entry?: CompanyMappingEntry) => {
      if (!text(market.ticker) || !text(market.event_ticker) || !text(market.title)) {
        quarantine.push({ market: `${series}/${text(market.ticker)}`, reason: "missing ticker, event or title" });
        return;
      }
      let historyFile: string | undefined;
      if (settled(market)) {
        try { historyFile = await kalshiHistory(series, market, company) ?? undefined; } catch (error) {
          if (entry) entry.failedCandles++;
          fail(`candles ${text(market.ticker)}`, error);
        }
      }
      const snapshot = kalshiSnapshot(market, current(), company ? { series, ticker: entry!.ticker, cik: entry!.cik, kind: entry!.kind } : { series });
      if (historyFile) snapshot.historyFile = historyFile;
      (company ? companySnapshots : kalshiMacroSnapshots).push(snapshot);
    };

    for (const entry of mappingAccepted) {
      const markets = companyMarkets.get(entry.series) ?? [];
      store.writeJson(path.join(root, "kalshi", "companies", entry.series, "markets.json"), { series: entry.series, ticker: entry.ticker, cik: entry.cik, kind: entry.kind, fetchedAt: current(), markets });
      for (const market of markets) if (numericMarket(market)) await capture(market, entry.series, true, entry);
    }
    for (const series of MACRO_SERIES) {
      const markets = macroMarkets.get(series) ?? [];
      store.writeJson(path.join(root, "kalshi", series, "markets.json"), { series, fetchedAt: current(), markets });
      for (const market of markets) {
        if (!numericMarket(market) && !["KXRECSSNBER", "KXQRECESS"].includes(series)) continue;
        await capture(market, series, false);
      }
    }
    if (!mappingErrors.length) store.writeJson(mappingFile, { date: day, rule: "any numeric contract on one of our companies", accepted: mappingAccepted, rejected: mappingRejected });

    const polyHistoryFile = async (topic: string, event: JsonObject, market: JsonObject, snapshot: PredictionSnapshot): Promise<string> => {
      const slug = text(event.slug), file = path.join(root, "polymarket", `${topic}-decisions.json`);
      if (store.exists(file) && (store.readJson(file) as unknown[]).some((row: any) => row.event === slug && row.question === snapshot.title)) {
        cachedHistories++;
        return file;
      }
      const token = text(jsonArray(market.clobTokenIds)[0]);
      if (!token) throw new Error(`No CLOB token for ${snapshot.market}`);
      const history = await sources.polyHistory(token), outcome = polyOutcome(snapshot.title ?? "");
      const result = mergePolySettlement(store, file, { event: slug, decisionDay: text(event.endDate).slice(0, 10), question: snapshot.title ?? "", change: outcome?.change ?? null, orMore: outcome?.orMore ?? false, resolvedYes: snapshot.result === "yes", volume: snapshot.volume, history });
      if (result.wrote) settledHistories++;
      return file;
    };
    for (const topic of POLY_TOPICS) {
      try {
        const events = await sources.polyEvents(topic);
        const active = events.filter(event => event.closed !== true && event.resolved !== true && text(event.endDate) >= current()).sort((a, b) => text(a.endDate).localeCompare(text(b.endDate))).slice(0, topic === "fed" ? 4 : 1);
        const closed = events.filter(event => event.closed === true || event.resolved === true).sort((a, b) => text(b.endDate).localeCompare(text(a.endDate))).slice(0, 2);
        for (const found of [...active, ...closed]) {
          const event = Array.isArray(found.markets) ? found : await sources.polyEvent(text(found.slug));
          for (const market of event.markets as JsonObject[]) {
            try {
              const snapshot = polymarketSnapshot({ ...market, closed: market.closed === true || event.closed === true || event.resolved === true }, event, topic, current());
              if (market.closed === true || market.resolved === true || event.closed === true || event.resolved === true) {
                if (snapshot.result === null) { quarantine.push({ market: snapshot.market, reason: "closed without a binary outcome" }); continue; }
                snapshot.historyFile = await polyHistoryFile(topic, event, market, snapshot);
              }
              polySnapshots.push(snapshot);
            } catch (error) {
              if (error instanceof AuthRequiredError) throw error;
              quarantine.push({ market: text(market.conditionId ?? market.id ?? market.slug), reason: errorText(error) });
            }
          }
        }
      } catch (error) { fail(`polymarket ${topic}`, error); }
    }

    const dayFolder = path.join(root, "daily", day), artifacts: Record<string, string> = {};
    for (const [name, snapshots] of [["kalshi-companies.jsonl", companySnapshots], ["kalshi-macro.jsonl", kalshiMacroSnapshots], ["polymarket-macro.jsonl", polySnapshots]] as const) {
      const file = path.join(dayFolder, name), result = appendSnapshots(store, file, snapshots);
      artifacts[name] = result.sha256;
      console.log(`[prediction-markets] ${name}: ${result.appended} appended, ${result.skipped} unchanged`);
    }
    const stateFile = path.join(root, "kalshi", "daily-state.jsonl"), reportInput = [
      ...readSnapshots(store, path.join(dayFolder, "kalshi-companies.jsonl")),
      ...readSnapshots(store, path.join(dayFolder, "kalshi-macro.jsonl")),
      ...readSnapshots(store, path.join(dayFolder, "polymarket-macro.jsonl")),
    ];
    const report = buildPredictionExpectations(reportInput, current(), previousFedUpper(store, stateFile));
    const state = dailyExpectationState(report, day);
    artifacts["daily-state.jsonl"] = updateDailyState(store, stateFile, state);
    const partial = errors.length > 0 || quarantine.length > 0 || missingHistories > 0;
    if (partial) {
      report.status = "partial";
      report.notes.push("Some required markets or histories are unavailable; see the run manifest before using the values.");
    }
    const publicReportFile = options.publicReportFile ?? path.resolve("public/reports/prediction-markets.json");
    store.writeJson(publicReportFile, report);
    artifacts["prediction-markets.json"] = createHash("sha256").update(store.readText(publicReportFile)).digest("hex");
    const counts: Record<string, number> = {
      kalshiCompany: companySnapshots.length,
      kalshiMacro: kalshiMacroSnapshots.length,
      polymarketMacro: polySnapshots.length,
      settledHistories,
      cachedHistories,
      missingHistories,
      errors: errors.length,
      quarantine: quarantine.length,
    };
    const series: Record<string, number> = {};
    for (const row of [...companySnapshots, ...kalshiMacroSnapshots, ...polySnapshots]) series[row.series] = (series[row.series] ?? 0) + 1;
    const mapping = {
      file: mappingFile, acceptedSeries: mappingAccepted.length, companies: new Set(mappingAccepted.map(entry => entry.ticker)).size,
      rejectedSeries: mappingRejected.length, sha256: store.exists(mappingFile) ? createHash("sha256").update(store.readText(mappingFile)).digest("hex") : null, status: mappingStatus,
    };
    return writeManifest(store, dayFolder, { schemaVersion: 1, runId: "", invocation, status: partial ? "partial" : "complete", startedAt, finishedAt: current(), counts, series, mapping, artifacts, errors, quarantine, network: options.network });
  } catch (error) {
    return writeManifest(store, path.join(root, "daily", day), { schemaVersion: 1, runId: "", invocation, status: error instanceof AuthRequiredError ? "key_required" : "failed", startedAt, finishedAt: current(), counts: { errors: errors.length + 1 }, series: {}, mapping: { file: path.join(root, "kalshi", "companies", "mapping.json"), acceptedSeries: 0, companies: 0, rejectedSeries: 0, sha256: null, status: mappingStatus }, artifacts: {}, errors: [...errors, { scope: "run", error: errorText(error) }], quarantine, network: options.network });
  }
}

function writeManifest(store: PredictionStore, folder: string, manifest: Omit<DailyRunManifest, "runId"> & { runId: string }): DailyRunManifest {
  const base = manifest.finishedAt.replace(/[:.]/g, "-"), runId = manifest.runId || base;
  let file = path.join(folder, `manifest-${runId}.json`), suffix = 0;
  while (store.exists(file)) file = path.join(folder, `manifest-${runId}-${++suffix}.json`);
  const final = { ...manifest, runId: path.basename(file, ".json").replace(/^manifest-/, "") };
  store.writeJson(file, final);
  store.writeJson(path.join(folder, "latest-manifest.json"), { runId: final.runId, status: final.status, finishedAt: final.finishedAt, invocation: final.invocation, counts: final.counts, mapping: final.mapping, file: path.basename(file) });
  return final;
}

async function registryFromDatabase(): Promise<CompanyRegistry> {
  const client = getDb().$client.promise();
  try {
    const [rows] = (await client.query("SELECT cik,ticker,name FROM companies WHERE ticker IS NOT NULL AND name IS NOT NULL ORDER BY cik")) as [Array<{ cik: number; ticker: string; name: string }>, unknown];
    return Object.fromEntries(rows.map((row: any) => [String(row.ticker).toUpperCase(), { cik: Number(row.cik), name: String(row.name) }]));
  } finally {
    await client.end();
  }
}

function archiveRoot(value: string): string {
  const root = path.resolve(value);
  if (!/^d:/i.test(root)) throw new Error("Prediction-market archives must stay on D:");
  mkdirSync(root, { recursive: true });
  if (!/^d:/i.test(realpathSync(root))) throw new Error("The prediction-market archive must resolve to D:");
  return root;
}

function collectorLock(root: string): () => void {
  const file = path.join(root, "prediction-markets-daily.lock");
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") rmSync(file, { force: true }); }
    }
    if (existsSync(file)) throw new Error(`Another prediction-market collector is active (pid ${pid})`);
  }
  const descriptor = openSync(file, "wx");
  writeSync(descriptor, String(process.pid));
  closeSync(descriptor);
  return () => { closeSyncSafe(descriptor); rmSync(file, { force: true }); };
}

function closeSyncSafe(descriptor: number): void {
  try { closeSync(descriptor); } catch { /* already closed */ }
}

function labCollectionActive(): number | null {
  const output = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*.exe' -and $_.CommandLine -like '*kalshi_companies.py*' } | Select-Object -First 1 ProcessId | ConvertTo-Json"], { encoding: "utf8" });
  if (!output.trim()) return null;
  return JSON.parse(output)?.ProcessId ?? null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const active = labCollectionActive();
  if (active) throw new Error(`The lab company collector is still active (pid ${active}); no requests were made.`);
  const root = archiveRoot(option("--root") ?? "D:/research/alpha-engine/predmarkets");
  if (!existsSync(path.join(root, "kalshi", "companies", "mapping.json"))) throw new Error("The initial company mapping is missing. Finish the lab's company-history run before starting daily collection; no requests were made.");
  const unlock = collectorLock(root);
  try {
    const http = publicHttp(), sources = httpPredictionSources(http), registry = await registryFromDatabase();
    const manifest = await runDailyCollection({ root, sources, store: nodePredictionStore, registry, scheduledStyle: args.includes("--scheduled-style"), day: option("--date"), network: { get requests() { return http.requests; }, get retries() { return http.retries; } } });
    console.log(JSON.stringify(manifest, null, 2));
    if (manifest.status !== "complete") process.exitCode = 1;
  } finally {
    unlock();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
