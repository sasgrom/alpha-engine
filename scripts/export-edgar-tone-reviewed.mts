import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { shouldScoreManifestEntry } from "../worker/lib/edgar";
import { LLM_MODEL, tonePrompt } from "../worker/lib/ollama";
import { prepareToneFiling } from "../worker/lib/tone-prep";
import type { ManifestEntry } from "../worker/edgar-fetch.mts";

const ROOT = path.resolve(import.meta.dirname, "..");
export const TONE_PROMPT_VERSION = "v1";
export const TONE_MODEL = LLM_MODEL;
export const TONE_PROMPT_SOURCE_SHA256 = createHash("sha256").update(tonePrompt.toString()).digest("hex");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

interface UniverseCompany { cik: number; ticker: string; name?: string }
interface RawToneRow {
  id: number;
  cik: number;
  source: string;
  signalType: string;
  eventTs: unknown;
  score: unknown;
  magnitude: unknown;
  payloadKey: string | null;
  src: string | null;
  note: string | null;
}
export interface ReviewedToneRow {
  cik: number;
  source: "edgar";
  signalType: "tone";
  eventTs: string;
  score: number;
  magnitude: number;
  payloadKey: string;
  src: "backfill";
  note: string | null;
  accessionNo: string;
  promptVersion: "v1";
  promptSourceSha256: string;
  legacyPayloadKey: string;
}

export function versionedTonePayloadKey(model: string, promptVersion: string, cik: number, accessionNo: string): string {
  return `llm:${model}:prompt=${promptVersion}:edgar:${cik}:${accessionNo}`;
}

function eventTimestamp(value: unknown): string {
  const text = typeof value === "string" ? value : new Date(value as string).toISOString();
  const normalized = text.length >= 19 ? text.slice(0, 19) : text;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(normalized)) throw new Error(`Invalid eventTs: ${text}`);
  return normalized.replace("T", " ");
}

function legacyToneAccession(row: Pick<RawToneRow, "cik" | "payloadKey">): string {
  const prefix = `llm:${TONE_MODEL}:edgar:`;
  if (!row.payloadKey?.startsWith(prefix)) throw new Error(`Unexpected model or legacy payloadKey for CIK ${row.cik}: ${row.payloadKey ?? "null"}`);
  const accessionNo = row.payloadKey.slice(prefix.length).split(":").at(-1) ?? "";
  if (!accessionNo || row.payloadKey !== `${prefix}${row.cik}:${accessionNo}`) throw new Error(`Malformed legacy payloadKey for CIK ${row.cik}`);
  return accessionNo;
}

export function runToneGuard(companies: UniverseCompany[]) {
  if (companies.length !== 50 || new Set(companies.map((company) => company.cik)).size !== 50) throw new Error("Expected exactly 50 unique presentation CIKs");
  const result = {
    companies: 50,
    companiesWithScoredEntries: 0,
    outboxAccessions: 0,
    pendingManifest: 0,
    ready: 0,
    thin: 0,
    unreadable: 0,
    plannedCalls: 0,
    previousSkips: {} as Record<string, number>,
  };
  for (const company of companies) {
    const cacheDir = path.join(ROOT, "worker/cache/edgar", String(company.cik));
    const manifest = JSON.parse(readFileSync(path.join(cacheDir, "manifest.json"), "utf8")) as ManifestEntry[];
    if (manifest.some((entry) => entry.scored)) result.companiesWithScoredEntries++;
    let outbox = new Set<string>();
    const outboxPath = path.join(cacheDir, "outbox.json");
    if (existsSync(outboxPath)) {
      const box = JSON.parse(readFileSync(outboxPath, "utf8"));
      outbox = new Set(box.accessions ?? []);
    }
    result.outboxAccessions += outbox.size;
    const pending = manifest.filter((entry) => shouldScoreManifestEntry(entry, null, false, TONE_MODEL) && !outbox.has(entry.accessionNo));
    result.pendingManifest += pending.length;
    for (const entry of manifest) {
      if (entry.fetched && !entry.scored && entry.error && !outbox.has(entry.accessionNo) && !shouldScoreManifestEntry(entry, null, false, TONE_MODEL)) {
        const reason = entry.llmErrorCount && entry.error === "no parseable score" ? `${entry.error} (retry cap)` : entry.error;
        result.previousSkips[reason] = (result.previousSkips[reason] ?? 0) + 1;
      }
    }
    for (const entry of pending) {
      const prep = prepareToneFiling(cacheDir, entry);
      if (!prep.ok) {
        if (prep.reason === "thin content (cover/TOC/XBRL header)") result.thin++;
        else result.unreadable++;
      } else {
        result.ready++;
        result.plannedCalls += prep.windows.length;
      }
    }
  }
  const failures = [
    result.companiesWithScoredEntries !== 50 ? "companiesWithScoredEntries" : null,
    result.outboxAccessions !== 0 ? "outboxAccessions" : null,
    result.pendingManifest !== 0 ? "pendingManifest" : null,
    result.ready !== 0 ? "ready" : null,
    result.thin !== 0 ? "thin" : null,
    result.unreadable !== 0 ? "unreadable" : null,
    result.plannedCalls !== 0 ? "plannedCalls" : null,
  ].filter(Boolean);
  if (failures.length) throw new Error(`Tone guard failed: ${failures.join(", ")}`);
  return result;
}

export function buildToneReviewedData(rows: RawToneRow[], companies: UniverseCompany[], manifests: Map<number, ManifestEntry[]>) {
  const allowed = new Set(companies.map((company) => company.cik));
  const legacyExactKeys = new Set<string>();
  const exactKeys = new Set<string>();
  const coverageByCik = new Map<number, { cik: number; ticker: string; rows: number; forms: Record<string, number>; minEventTs: string | null; maxEventTs: string | null }>();
  const signals: ReviewedToneRow[] = [];
  for (const row of rows) {
    if (!allowed.has(row.cik)) throw new Error(`outsideUniverseRows includes CIK ${row.cik}`);
    if (row.source !== "edgar" || row.signalType !== "tone") throw new Error(`Unexpected signal family for CIK ${row.cik}`);
    const accessionNo = legacyToneAccession(row);
    const eventTs = eventTimestamp(row.eventTs);
    const score = Number(row.score);
    const magnitude = Number(row.magnitude);
    if (!Number.isFinite(score) || score < -1 || score > 1) throw new Error(`Invalid score for CIK ${row.cik} ${accessionNo}`);
    if (!Number.isInteger(magnitude) || magnitude <= 0) throw new Error(`Invalid magnitude for CIK ${row.cik} ${accessionNo}`);
    if (row.src !== "backfill") throw new Error(`Invalid src for CIK ${row.cik} ${accessionNo}`);
    if (row.note !== null && row.note.length > 2000) throw new Error(`Oversized note for CIK ${row.cik} ${accessionNo}`);
    const manifestEntry = manifests.get(row.cik)?.find((entry) => entry.accessionNo === accessionNo);
    if (!manifestEntry?.fetched || !manifestEntry.scored) throw new Error(`Missing fetched/scored manifest link for CIK ${row.cik} ${accessionNo}`);
    const payloadKey = versionedTonePayloadKey(TONE_MODEL, TONE_PROMPT_VERSION, row.cik, accessionNo);
    if (payloadKey.length > 255 || !row.payloadKey || row.payloadKey.length > 255) throw new Error(`Oversized payloadKey for CIK ${row.cik} ${accessionNo}`);
    const legacyExactKey = `${row.cik}|edgar|tone|${eventTs}|${row.payloadKey}`;
    const exactKey = `${row.cik}|edgar|tone|${eventTs}|${payloadKey}`;
    if (legacyExactKeys.has(legacyExactKey)) throw new Error(`Duplicate legacy exact key ${legacyExactKey}`);
    if (exactKeys.has(exactKey)) throw new Error(`Duplicate exact key ${exactKey}`);
    legacyExactKeys.add(legacyExactKey);
    exactKeys.add(exactKey);
    const company = companies.find((item) => item.cik === row.cik)!;
    const coverage = coverageByCik.get(row.cik) ?? { cik: row.cik, ticker: company.ticker, rows: 0, forms: {}, minEventTs: null, maxEventTs: null };
    coverage.rows++;
    coverage.forms[manifestEntry.form] = (coverage.forms[manifestEntry.form] ?? 0) + 1;
    coverage.minEventTs = coverage.minEventTs === null || eventTs < coverage.minEventTs ? eventTs : coverage.minEventTs;
    coverage.maxEventTs = coverage.maxEventTs === null || eventTs > coverage.maxEventTs ? eventTs : coverage.maxEventTs;
    coverageByCik.set(row.cik, coverage);
    signals.push({
      cik: row.cik,
      source: "edgar",
      signalType: "tone",
      eventTs,
      score,
      magnitude,
      payloadKey,
      src: "backfill",
      note: row.note,
      accessionNo,
      promptVersion: TONE_PROMPT_VERSION,
      promptSourceSha256: TONE_PROMPT_SOURCE_SHA256,
      legacyPayloadKey: row.payloadKey,
    });
  }
  if (coverageByCik.size !== 50) throw new Error(`companiesWithSignals=${coverageByCik.size}, expected 50`);
  const coverage = [...coverageByCik.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const eventTsValues = signals.map((row) => row.eventTs).sort();
  return {
    signals,
    coverage: {
      schemaVersion: 1,
      rows: signals.length,
      companiesWithSignals: coverageByCik.size,
      outsideUniverseRows: 0,
      duplicateExactKeys: 0,
      duplicateLegacyExactKeys: 0,
      minEventTs: eventTsValues[0] ?? null,
      maxEventTs: eventTsValues.at(-1) ?? null,
      companies: coverage,
    },
  };
}

function powerShell(script: string) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function main() {
  const arg = (name: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const universeArg = arg("--universe") ?? "research-universe-50.json";
  const out = path.resolve(ROOT, arg("--out") ?? "research/reviewed-sync/2026-11-07/edgar-tone-reviewed.zip");
  if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
  const companies = JSON.parse(readFileSync(path.join(ROOT, "worker", universeArg), "utf8")) as UniverseCompany[];
  const guard = runToneGuard(companies);
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) throw new Error("Reviewed export is restricted to local MySQL");
  const db = getDb();
  try {
    const ciks = companies.map((company) => company.cik);
    const [rows] = await db.execute(sql`SELECT id, cik, source, signalType, eventTs, score, magnitude, payloadKey, src, note
      FROM signals WHERE source='edgar' AND signalType='tone' AND cik IN (${sql.join(ciks.map((cik) => sql`${cik}`), sql`, `)})
      ORDER BY cik, eventTs, payloadKey, id`) as unknown as [RawToneRow[]];
    const [outsideRows] = await db.execute(sql`SELECT COUNT(*) AS n FROM signals WHERE source='edgar' AND signalType='tone' AND cik NOT IN (${sql.join(ciks.map((cik) => sql`${cik}`), sql`, `)})`);
    const manifests = new Map<number, ManifestEntry[]>();
    for (const company of companies) manifests.set(company.cik, JSON.parse(readFileSync(path.join(ROOT, "worker/cache/edgar", String(company.cik), "manifest.json"), "utf8")));
    const { signals, coverage } = buildToneReviewedData(rows, companies, manifests);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const stage = path.join(ROOT, "worker/.runs", `edgar-tone-reviewed-${stamp}`, "stage");
    const verify = path.join(ROOT, "worker/.runs", `edgar-tone-reviewed-${stamp}`, "verify");
    mkdirSync(stage, { recursive: true });
    writeFileSync(path.join(stage, "signals.json"), `${JSON.stringify(signals, null, 2)}\n`);
    writeFileSync(path.join(stage, "coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);
    const auditSummary = {
      schemaVersion: 1,
      status: "pass",
      guard,
      rows: signals.length,
      companiesWithSignals: coverage.companiesWithSignals,
      outsideUniverseRows: 0,
      excludedOutsideUniverseRows: Number((outsideRows as any)[0]?.n ?? 0),
      duplicateExactKeys: 0,
      duplicateLegacyExactKeys: 0,
      terminalSkips: guard.previousSkips,
      note: "Terminal skips are excluded from signals. No raw EDGAR, HTML, logs, credentials or operations state is included.",
    };
    writeFileSync(path.join(stage, "audit-summary.json"), `${JSON.stringify(auditSummary, null, 2)}\n`);
    const files = ["signals.json", "coverage.json", "audit-summary.json"].map((file) => {
      const bytes = readFileSync(path.join(stage, file));
      return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
    });
    const manifest = {
      schemaVersion: 1,
      packageType: "reviewed-edgar-tone",
      generatedAt: new Date().toISOString(),
      dataMode: "live",
      transportOnly: true,
      productionApply: false,
      model: TONE_MODEL,
      promptVersion: TONE_PROMPT_VERSION,
      promptSourceSha256: TONE_PROMPT_SOURCE_SHA256,
      exactKeyDefinition: "(cik, source, signalType, eventTs, payloadKey)",
      rows: signals.length,
      companies: coverage.companiesWithSignals,
      outsideUniverseRows: 0,
      duplicateExactKeys: 0,
      files,
    };
    writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    mkdirSync(path.dirname(out), { recursive: true });
    powerShell(`Compress-Archive -Path ${psQuote(path.join(stage, "*"))} -DestinationPath ${psQuote(out)} -CompressionLevel Optimal`);
    powerShell(`Expand-Archive -Path ${psQuote(out)} -DestinationPath ${psQuote(verify)} -Force`);
    for (const file of [...files, { path: "manifest.json", bytes: readFileSync(path.join(stage, "manifest.json")).length, sha256: sha256(readFileSync(path.join(stage, "manifest.json"))) }]) {
      const actual = readFileSync(path.join(verify, file.path));
      if (actual.length !== file.bytes || sha256(actual) !== file.sha256) throw new Error(`ZIP verification failed for ${file.path}`);
    }
    const zipBytes = readFileSync(out);
    console.log(JSON.stringify({
      zip: out,
      bytes: zipBytes.length,
      sha256: sha256(zipBytes),
      rows: signals.length,
      companies: coverage.companiesWithSignals,
      model: TONE_MODEL,
      promptVersion: TONE_PROMPT_VERSION,
      promptSourceSha256: TONE_PROMPT_SOURCE_SHA256,
      minEventTs: coverage.minEventTs,
      maxEventTs: coverage.maxEventTs,
      guard,
    }, null, 2));
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
