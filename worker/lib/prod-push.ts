import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { reportFilePolicy } from "../../contracts/report-files";
import { fetchJson } from "./http";
import { PROD_INGEST_URL } from "./ingest";
import { latestCompleteOfficialDailyBars } from "./schwab-daily";
import { MACRO_SERIES } from "./macro-sources";
import { auditNormalizedMacroSeries } from "./macro-manifest-qa";
import type { NormalizedMacroPoint } from "./fred";

export type OperationalPushKind = "pricesDaily" | "macroPoints" | "reportFile";
export type OperationalJobStatus = "done" | "error" | "killed" | "running";

const JOB_OUTPUTS: Record<string, { kind: OperationalPushKind; name?: string }[]> = {
  "schwab-fetch-daily": [{ kind: "pricesDaily" }, { kind: "reportFile", name: "daily-prices-schwab.json" }],
  "schwab-daily-prices": [{ kind: "pricesDaily" }, { kind: "reportFile", name: "daily-prices-schwab.json" }],
  "schwab-snapshot": [{ kind: "reportFile", name: "schwab-market-data.json" }],
  "schwab-context-hourly": [{ kind: "reportFile", name: "schwab-context.json" }],
  "macro-fred-weekly": [{ kind: "macroPoints" }],
  "daily-operations-report": [{ kind: "reportFile", name: "daily-operations.json" }, { kind: "reportFile", name: "daily-operations.md" }],
};

export function shouldPushOperationalJob(jobId: string, status: OperationalJobStatus, trigger: string): boolean {
  return status === "done" && trigger !== "manual" && Boolean(JOB_OUTPUTS[jobId]?.length);
}

function ingestUrl(): string {
  const value = process.env.INGEST_URL ?? PROD_INGEST_URL;
  const url = new URL(value);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("INGEST_URL must use HTTPS outside the local worker");
  return value;
}

export async function postOperationalIngest(payload: any): Promise<any> {
  const key = process.env.WORKER_KEY;
  if (!key) throw new Error("WORKER_KEY is required for operational production push");
  return fetchJson(ingestUrl(), {
    method: "POST",
    retries: 1,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function postRows(kind: "pricesDaily" | "macroPoints", rows: any[]): Promise<any[]> {
  const results = [];
  for (let offset = 0; offset < rows.length; offset += 500) results.push(await postOperationalIngest({ kind, rows: rows.slice(offset, offset + 500) }));
  return results;
}

interface DailyPriceBuild {
  rows: any[];
  report: { name: string; body: string; sha256: string; generatedAt: string };
}

export function buildDailyPricesFromRaw(options: { root?: string; universeFile?: string; from?: string; now?: Date } = {}): DailyPriceBuild {
  const root = options.root ?? path.resolve("D:/research/alpha-engine/schwab");
  const universeFile = options.universeFile ?? "worker/research-universe-50.json";
  const universe = JSON.parse(readFileSync(universeFile, "utf8")) as { cik: number; ticker: string }[];
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as { tickers: any[] };
  const now = options.now ?? new Date();
  const pacificDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const generatedAt = now.toISOString();
  const rows: any[] = [];
  const companies = [];
  for (const company of universe) {
    const file = path.join(root, "pricehistory", `${company.ticker}.json`);
    if (!existsSync(file)) throw new Error(`Official daily price history is absent for ${company.ticker}`);
    const raw = readFileSync(file, "utf8");
    const sourceSha256 = createHash("sha256").update(raw).digest("hex");
    const bars = latestCompleteOfficialDailyBars(JSON.parse(raw), pacificDate, 2).filter((bar) => !options.from || bar.date >= options.from);
    if (!bars.length) continue;
    const capture = manifest.tickers.filter((entry) => entry.ticker === company.ticker && entry.status === "complete").sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);
    if (!capture) throw new Error(`No complete manifest capture for ${company.ticker}`);
    const latest = bars.at(-1)!;
    const previous = bars.at(-2);
    const companyRows = bars.map((bar) => ({ cik: company.cik, ticker: company.ticker, date: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close, adjClose: null, volume: bar.volume, source: "schwab", fetchedAt: capture.capturedAt }));
    rows.push(...companyRows);
    companies.push({
      ...company,
      status: "collected",
      source: "schwab",
      adjustedCloseStatus: "missing_official_adjustment_policy",
      date: latest.date,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
      previousDate: previous?.date ?? null,
      previousClose: previous?.close ?? null,
      change: previous && latest.close !== null && previous.close !== null ? latest.close - previous.close : null,
      changePct: previous && latest.close !== null && previous.close !== null ? (latest.close - previous.close) / previous.close : null,
      currency: "USD",
      quality: "official_close",
      capturedAt: capture.capturedAt,
      sourceSha256,
      bars: companyRows.map((row) => ({ date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, adjClose: null, volume: row.volume, fetchedAt: row.fetchedAt })),
    });
  }
  if (!options.from && companies.length !== universe.length) throw new Error(`Daily price coverage is incomplete: ${companies.length}/${universe.length}`);
  const reportBody = JSON.stringify({ schemaVersion: 2, generatedAt, universeSize: universe.length, historyPolicy: "Latest two complete official daily candles with OHLCV; no backdating and no options-intraday spot substitution", sourcePolicy: "Schwab official closes only in the automatic lane", companies }, null, 2) + "\n";
  return { rows, report: { name: "daily-prices-schwab.json", body: reportBody, sha256: createHash("sha256").update(reportBody).digest("hex"), generatedAt } };
}

export function buildReportFilePayload(name: string, options: { root?: string; body?: string } = {}) {
  reportFilePolicy(name);
  const file = path.join(options.root ?? "public/reports", name);
  const body = options.body ?? readFileSync(file, "utf8");
  const parsed = name.endsWith(".json") ? JSON.parse(body) : null;
  const generatedAt = parsed?.generatedAt ?? body.match(/\bGenerated:\s*([^\s·]+)/i)?.[1];
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) throw new Error(`Report generatedAt is missing for ${name}`);
  return { kind: "reportFile", name, body, sha256: createHash("sha256").update(body).digest("hex"), generatedAt };
}

export function buildReportFileBackfillPayload(name: string, options: { root?: string; universeFile?: string; from?: string; now?: Date; body?: string } = {}) {
  if (name === "daily-prices-schwab.json") {
    const daily = buildDailyPricesFromRaw({ root: options.root, universeFile: options.universeFile, from: options.from, now: options.now });
    return { kind: "reportFile", ...daily.report };
  }
  return buildReportFilePayload(name, { root: options.root, body: options.body });
}

export function buildMacroPointsPayload(options: { root?: string; from?: string } = {}) {
  const root = options.root ?? path.resolve(process.platform === "win32" ? "D:/research/alpha-engine/macro" : "worker/cache/macro");
  const rows = [];
  for (const definition of MACRO_SERIES) {
    const file = path.join(root, "normalized", "fred", `${definition.seriesId}.json`);
    const seriesRows = JSON.parse(readFileSync(file, "utf8")) as NormalizedMacroPoint[];
    const issues = auditNormalizedMacroSeries(definition.seriesId, seriesRows, seriesRows.length).filter((issue) => issue.severity === "error");
    if (issues.length) throw new Error(`Macro QA failed for ${definition.seriesId}: ${issues[0].code}`);
    for (const row of seriesRows) {
      if (options.from && row.observationPeriod < options.from) continue;
      if (!row.availableAt) continue;
      rows.push({ seriesId: row.seriesId, observationPeriod: row.observationPeriod, realtimeStart: row.availableAt.slice(0, 10), realtimeEnd: row.supersededAt?.slice(0, 10) ?? null, value: row.value, sourceHash: row.sourceHash });
    }
  }
  return rows;
}

export async function pushOperationalJobOutput(jobId: string, options: { from?: string } = {}) {
  const outputs = JOB_OUTPUTS[jobId];
  if (!outputs?.length) return [];
  const results = [];
  for (const output of outputs) {
    if (output.kind === "pricesDaily") {
      const daily = buildDailyPricesFromRaw({ from: options.from });
      results.push({ kind: output.kind, response: await postRows("pricesDaily", daily.rows) });
    } else if (output.kind === "macroPoints") {
      results.push({ kind: output.kind, response: await postRows("macroPoints", buildMacroPointsPayload({ from: options.from })) });
    } else {
      if (output.name === "daily-prices-schwab.json") {
        const daily = buildDailyPricesFromRaw({ from: options.from });
        results.push({ kind: output.kind, name: output.name, response: await postOperationalIngest({ kind: "reportFile", ...daily.report }) });
      } else {
        results.push({ kind: output.kind, name: output.name, response: await postOperationalIngest(buildReportFilePayload(output.name!)) });
      }
    }
  }
  return results;
}

export async function runOperationalBackfill(options: { kind: OperationalPushKind; from?: string; name?: string; reviewed?: boolean }) {
  if (options.kind === "pricesDaily") {
    const daily = buildDailyPricesFromRaw({ from: options.from });
    return postRows("pricesDaily", daily.rows);
  }
  if (options.kind === "macroPoints") return postRows("macroPoints", buildMacroPointsPayload({ from: options.from }));
  if (!options.name) throw new Error("--name is required for reportFile backfill");
  const policy = reportFilePolicy(options.name);
  if (!policy.automatic && !options.reviewed) throw new Error("This report belongs to the reviewed/pinned channel; pass --reviewed explicitly");
  return postOperationalIngest(buildReportFileBackfillPayload(options.name, { from: options.from }));
}
