import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { companyFacts as defaultCompanyFacts, factsToRows, listFilings as defaultListFilings, type CompanyFactRow, type EdgarCompany, type EdgarFiling } from "./edgar";
import { postFactsSnapshot as defaultPostFactsSnapshot } from "./ingest";
import { writeJsonAtomic } from "./json-file";
import { sha256Text } from "./fred";

export const DEFAULT_FULL_RECONCILIATION_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;
const RELEVANT_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F", "10-KT", "10-QT"]);

export interface FactsManifestEntry {
  cik: number;
  ticker: string;
  lastCheckedAt: string;
  lastSuccessfulCapture: string | null;
  lastSuccessfulIngest: string | null;
  lastRelevantAccession: string | null;
  lastRelevantFilingDate: string | null;
  lastRelevantForm: string | null;
  lastRelevantSignature: string;
  lastFullReconciliation: string | null;
  rawSha256: string | null;
  status: "refreshed" | "unchanged" | "failed";
  error: string | null;
  universeHash: string;
}

interface RawSnapshot {
  payload: any;
  rows: CompanyFactRow[];
  sha256: string;
}

interface FilingSignature {
  signature: string;
  accessionNo: string | null;
  filingDate: string | null;
  form: string | null;
}

export interface FactsRunResult {
  cik: number;
  ticker: string;
  status: FactsManifestEntry["status"];
  rows: number;
  reason: string;
  error: string | null;
}

export interface FactsRunSummary {
  universeHash: string;
  checked: number;
  refreshed: number;
  unchanged: number;
  failed: number;
  rowsTotal: number;
  results: FactsRunResult[];
}

export interface FactsCollectionOptions {
  cacheRoot?: string;
  now?: () => Date;
  useCached?: boolean;
  fullReconciliationMs?: number;
  listFilings?: (cik: number) => Promise<EdgarFiling[]>;
  companyFacts?: (cik: number) => Promise<any>;
  postFactsSnapshot?: (cik: number, rows: CompanyFactRow[], opts: { url: string }) => Promise<{ replaced: number }>;
  ingestUrl: string;
}

export function dedupeFactsUniverse(companies: EdgarCompany[]): EdgarCompany[] {
  const byCik = new Map<number, EdgarCompany>();
  for (const company of companies) {
    if (!byCik.has(company.cik)) byCik.set(company.cik, company);
  }
  return [...byCik.values()].sort((a, b) => a.cik - b.cik);
}

export function factsUniverseSha256(companies: EdgarCompany[]): string {
  const uniqueCiks = dedupeFactsUniverse(companies).map((company) => company.cik);
  return createHash("sha256").update(JSON.stringify(uniqueCiks)).digest("hex");
}

export function relevantFilingSignature(filings: EdgarFiling[]): FilingSignature {
  const relevant = filings
    .filter((filing) => RELEVANT_FORMS.has(filing.form.replace(/\/A$/, "")))
    .sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.accessionNo.localeCompare(b.accessionNo));
  const latest = relevant.at(-1);
  return {
    signature: relevant.map((filing) => `${filing.accessionNo}|${filing.filingDate}|${filing.form}`).join("\n"),
    accessionNo: latest?.accessionNo ?? null,
    filingDate: latest?.filingDate ?? null,
    form: latest?.form ?? null,
  };
}

export function factsRawPath(cacheRoot: string, cik: number): string {
  return path.join(cacheRoot, `${cik}.json`);
}

export function factsManifestPath(cacheRoot: string, cik: number): string {
  return path.join(cacheRoot, "manifest", `${cik}.json`);
}

function readManifest(cacheRoot: string, cik: number): FactsManifestEntry | null {
  try {
    if (!existsSync(factsManifestPath(cacheRoot, cik))) return null;
    return JSON.parse(readFileSync(factsManifestPath(cacheRoot, cik), "utf8")) as FactsManifestEntry;
  } catch {
    return null;
  }
}

function readRawSnapshot(cacheRoot: string, cik: number): RawSnapshot | null {
  try {
    const file = factsRawPath(cacheRoot, cik);
    if (!existsSync(file)) return null;
    const payload = JSON.parse(readFileSync(file, "utf8"));
    if (Number(payload?.cik) !== cik) return null;
    const rows = factsToRows(payload);
    if (rows.length === 0) return null;
    return { payload, rows, sha256: sha256Text(JSON.stringify(payload)) };
  } catch {
    return null;
  }
}

function fullReconciliationDueAt(lastFullReconciliation: string | null | undefined, cik: number, intervalMs: number): number {
  if (!lastFullReconciliation) return 0;
  const last = Date.parse(lastFullReconciliation);
  if (!Number.isFinite(last)) return 0;
  return last + intervalMs + (cik % 7) * DAY_MS;
}

export function factsRefreshReason(
  previous: FactsManifestEntry | null,
  raw: RawSnapshot | null,
  currentSignature: string,
  now: Date,
  intervalMs = DEFAULT_FULL_RECONCILIATION_MS,
): string | null {
  if (!raw) return "missing_or_corrupt_raw";
  if (!previous?.lastSuccessfulCapture || !previous.lastSuccessfulIngest) return "missing_successful_ingest";
  if (previous.status === "failed") return "previous_failure";
  if (previous.rawSha256 !== raw.sha256) return "raw_hash_changed";
  if (previous.lastRelevantSignature !== currentSignature) return "new_relevant_filing";
  const dueAt = fullReconciliationDueAt(previous.lastFullReconciliation, previous.cik, intervalMs);
  if (now.getTime() >= dueAt) return "full_reconciliation_due";
  return null;
}

function writeManifest(cacheRoot: string, entry: FactsManifestEntry): void {
  writeJsonAtomic(factsManifestPath(cacheRoot, entry.cik), entry, true);
}

function boundedError(error: unknown): string {
  return String((error as { message?: string })?.message ?? error).slice(0, 300);
}

export function assertLocalFactsIngestUrl(value: string): void {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):3000\//.test(value)) {
    throw new Error("local-first requires a local INGEST_URL");
  }
}

export async function runFactsCollection(companies: EdgarCompany[], options: FactsCollectionOptions): Promise<FactsRunSummary> {
  const cacheRoot = options.cacheRoot ?? path.resolve(import.meta.dirname, "..", "cache", "companyfacts");
  const listFilings = options.listFilings ?? defaultListFilings;
  const companyFacts = options.companyFacts ?? defaultCompanyFacts;
  const postFactsSnapshot = options.postFactsSnapshot ?? defaultPostFactsSnapshot;
  const now = options.now ?? (() => new Date());
  const universe = dedupeFactsUniverse(companies);
  const summary: FactsRunSummary = {
    universeHash: factsUniverseSha256(universe),
    checked: 0,
    refreshed: 0,
    unchanged: 0,
    failed: 0,
    rowsTotal: 0,
    results: [],
  };
  for (const company of universe) {
    summary.checked++;
    const previous = readManifest(cacheRoot, company.cik);
    const rawBefore = readRawSnapshot(cacheRoot, company.cik);
    let signature: FilingSignature = {
      signature: previous?.lastRelevantSignature ?? "",
      accessionNo: previous?.lastRelevantAccession ?? null,
      filingDate: previous?.lastRelevantFilingDate ?? null,
      form: previous?.lastRelevantForm ?? null,
    };
    let refreshed = false;
    try {
      if (options.useCached) {
        if (!rawBefore) throw new Error("no valid cached companyfacts payload");
      } else {
        signature = relevantFilingSignature(await listFilings(company.cik));
        const reason = factsRefreshReason(previous, rawBefore, signature.signature, now(), options.fullReconciliationMs);
        if (!reason) {
          const checkedAt = now().toISOString();
          const entry: FactsManifestEntry = {
            ...previous!,
            lastCheckedAt: checkedAt,
            lastRelevantAccession: signature.accessionNo,
            lastRelevantFilingDate: signature.filingDate,
            lastRelevantForm: signature.form,
            lastRelevantSignature: signature.signature,
            status: "unchanged",
            error: null,
            universeHash: summary.universeHash,
          };
          writeManifest(cacheRoot, entry);
          summary.unchanged++;
          summary.rowsTotal += rawBefore!.rows.length;
          summary.results.push({ cik: company.cik, ticker: company.ticker, status: "unchanged", rows: rawBefore!.rows.length, reason: "unchanged", error: null });
          continue;
        }
        const payload = await companyFacts(company.cik);
        if (Number(payload?.cik) !== company.cik) throw new Error("companyfacts CIK mismatch");
        const rows = factsToRows(payload);
        if (rows.length === 0) throw new Error("SEC returned zero fact rows; existing facts kept");
        await postFactsSnapshot(company.cik, rows, { url: options.ingestUrl });
        writeJsonAtomic(factsRawPath(cacheRoot, company.cik), payload);
        refreshed = true;
      }
      const rawAfter = refreshed ? readRawSnapshot(cacheRoot, company.cik)! : rawBefore!;
      const successAt = now().toISOString();
      const entry: FactsManifestEntry = {
        cik: company.cik,
        ticker: company.ticker,
        lastCheckedAt: successAt,
        lastSuccessfulCapture: successAt,
        lastSuccessfulIngest: successAt,
        lastRelevantAccession: signature.accessionNo,
        lastRelevantFilingDate: signature.filingDate,
        lastRelevantForm: signature.form,
        lastRelevantSignature: signature.signature,
        lastFullReconciliation: successAt,
        rawSha256: rawAfter.sha256,
        status: "refreshed",
        error: null,
        universeHash: summary.universeHash,
      };
      writeManifest(cacheRoot, entry);
      summary.refreshed++;
      summary.rowsTotal += rawAfter.rows.length;
      summary.results.push({ cik: company.cik, ticker: company.ticker, status: "refreshed", rows: rawAfter.rows.length, reason: refreshed ? "new_data" : options.useCached ? "cached_recovery" : "reconciliation_or_recovery", error: null });
    } catch (error) {
      const message = boundedError(error);
      const checkedAt = now().toISOString();
      const entry: FactsManifestEntry = {
        cik: company.cik,
        ticker: company.ticker,
        lastCheckedAt: checkedAt,
        lastSuccessfulCapture: previous?.lastSuccessfulCapture ?? null,
        lastSuccessfulIngest: previous?.lastSuccessfulIngest ?? null,
        lastRelevantAccession: signature.accessionNo,
        lastRelevantFilingDate: signature.filingDate,
        lastRelevantForm: signature.form,
        lastRelevantSignature: signature.signature,
        lastFullReconciliation: previous?.lastFullReconciliation ?? null,
        rawSha256: previous?.rawSha256 ?? null,
        status: "failed",
        error: message,
        universeHash: summary.universeHash,
      };
      writeManifest(cacheRoot, entry);
      summary.failed++;
      summary.results.push({ cik: company.cik, ticker: company.ticker, status: "failed", rows: 0, reason: "failed", error: message });
    }
  }
  return summary;
}

export interface FactsManifestHealth {
  universeHash: string;
  uniqueCiks: number;
  refreshed: number;
  unchanged: number;
  failed: number;
  missing: number;
  lastCheckedAt: string | null;
}

export function summarizeFactsManifest(cacheRoot: string, companies: EdgarCompany[]): FactsManifestHealth {
  const universe = dedupeFactsUniverse(companies);
  const health: FactsManifestHealth = {
    universeHash: factsUniverseSha256(universe),
    uniqueCiks: universe.length,
    refreshed: 0,
    unchanged: 0,
    failed: 0,
    missing: 0,
    lastCheckedAt: null,
  };
  for (const company of universe) {
    const entry = readManifest(cacheRoot, company.cik);
    if (!entry?.lastSuccessfulIngest) health.missing++;
    if (entry?.status === "refreshed") health.refreshed++;
    if (entry?.status === "unchanged") health.unchanged++;
    if (entry?.status === "failed") health.failed++;
    if (entry?.lastCheckedAt && (!health.lastCheckedAt || entry.lastCheckedAt > health.lastCheckedAt) ) health.lastCheckedAt = entry.lastCheckedAt;
  }
  return health;
}
