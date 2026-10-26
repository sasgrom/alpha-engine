/**
 * ORATS sample archive normalizer. Streams the large CSV instead of loading it
 * into memory, preserves the raw ZIP, and writes one chain per ticker/date.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import unzipper from "unzipper";
import { loadEdgarUniverse } from "./lib/edgar";
import { splitCsv } from "./lib/gdelt-csv";
import { finalizeSnapshot, num, oratsRecordToContracts, oratsSnapshotMeta, type OptionChainSnapshot } from "./lib/options";
import { startProgress } from "./lib/progress";

const FORCE = process.argv.includes("--force");
const ROOT = path.resolve(import.meta.dirname, "cache", "options");
const NORMALIZED = path.resolve(import.meta.dirname, "cache", "options-normalized");
const ARCHIVE = path.join(ROOT, "orats", "ORATS_SMV_Strikes_20240103.zip");
const MANIFEST = path.join(ROOT, "manifest.json");
const prog = startProgress("orats", "normalize sample archive");
const universe = new Set(loadEdgarUniverse("edgar-universe-35.json").map((c) => c.ticker));
const ingestedAt = new Date().toISOString();

function atomicJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}
function readManifest(): any[] { try { return JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { return []; } }
const manifest = readManifest();
function record(snapshot: OptionChainSnapshot) {
  const key = `${snapshot.provider}|${snapshot.underlying}|${snapshot.tradeDate}`;
  const index = manifest.findIndex((m) => `${m.provider}|${m.underlying}|${m.tradeDate}` === key);
  const row = { provider: snapshot.provider, underlying: snapshot.underlying, tradeDate: snapshot.tradeDate, availableAt: snapshot.availableAt, ingestedAt: snapshot.ingestedAt, quality: snapshot.quality, warnings: snapshot.warnings };
  if (index >= 0) manifest[index] = row;
  else manifest.push(row);
  atomicJson(MANIFEST, manifest);
}

if (!existsSync(ARCHIVE)) throw new Error(`ORATS archive missing: ${ARCHIVE}`);
const archive = await unzipper.Open.file(ARCHIVE);
const entry = archive.files.find((f) => f.path.toLowerCase().endsWith(".csv"));
if (!entry) throw new Error("No CSV entry in ORATS archive");
const rowsByTicker = new Map<string, Omit<OptionChainSnapshot, "quality">>();
let header: string[] = [], sourceRows = 0, matchedRows = 0, invalidRows = 0;

for await (const line of readline.createInterface({ input: entry.stream(), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const columns = splitCsv(line)[0] ?? [];
  if (header.length === 0) { header = columns; continue; }
  const record = Object.fromEntries(header.map((name, i) => [name, columns[i] ?? ""]));
  sourceRows++;
  const meta = oratsSnapshotMeta(record);
  if (!meta.underlying || !meta.tradeDate || !universe.has(meta.underlying)) continue;
  matchedRows++;
  if (!rowsByTicker.has(meta.underlying)) {
    rowsByTicker.set(meta.underlying, {
      provider: "orats", underlying: meta.underlying, tradeDate: meta.tradeDate,
      availableAt: `${meta.tradeDate} 15:46 ET`, ingestedAt,
      providerTimeLabel: meta.providerTimeLabel,
      underlyingData: {
        stkPx: num(record.stkPx), spot_px: num(record.spot_px), iRate: num(record.iRate),
        divRate: num(record.divRate), residualRateData: num(record.residualRateData),
      },
      warnings: [], contracts: [],
    });
  }
  const snapshot = rowsByTicker.get(meta.underlying)!;
  try {
    snapshot.contracts.push(...oratsRecordToContracts(record));
  } catch {
    invalidRows++;
  }
  if (matchedRows % 10000 === 0) prog.item(matchedRows, sourceRows, `${rowsByTicker.size} tickers`);
}

for (const snapshot of rowsByTicker.values()) {
  const file = path.join(NORMALIZED, "orats", snapshot.tradeDate, `${snapshot.underlying}.json`);
  if (existsSync(file) && !FORCE) { prog.log(`${snapshot.underlying}: normalized cache present, skipped`); continue; }
  const finalized = finalizeSnapshot(snapshot);
  atomicJson(file, finalized);
  record(finalized);
  prog.log(`${finalized.underlying}: ${finalized.quality.rows} rows · ${finalized.quality.contracts} contracts · ${finalized.quality.expirations} expirations · dupes ${finalized.quality.duplicates} · invalid ${finalized.quality.invalidRows}`);
}
prog.done(`ORATS rows ${sourceRows}, matched ${matchedRows}, invalid ${invalidRows}, tickers ${rowsByTicker.size}`);
process.exit(0);
