/**
 * ORATS intraday sample normalizer. Each minute is its own timestamped chain;
 * provider rows and normalized files are versioned by snapshotId.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import unzipper from "unzipper";
import { splitCsv } from "./lib/gdelt-csv";
import { finalizeSnapshot, num, oratsAvailableAt, oratsRecordToContracts, oratsSnapshotMeta, type OptionChainSnapshot } from "./lib/options";
import { startProgress } from "./lib/progress";

const ROOT = path.resolve(import.meta.dirname, "cache", "options");
const NORMALIZED = path.resolve(import.meta.dirname, "cache", "options-normalized");
const ARCHIVE = path.join(ROOT, "orats", "intraday-sample-data.zip");
const MANIFEST = path.join(ROOT, "manifest.json");
const prog = startProgress("orats-intraday", "normalize minute samples");
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
  const index = manifest.findIndex((m) => `${m.provider}|${m.underlying}|${m.tradeDate}` === key && (m.snapshotId ?? null) === (snapshot.snapshotId ?? null));
  const row = { provider: snapshot.provider, underlying: snapshot.underlying, tradeDate: snapshot.tradeDate, snapshotId: snapshot.snapshotId ?? null, availableAt: snapshot.availableAt, ingestedAt: snapshot.ingestedAt, quality: snapshot.quality, warnings: snapshot.warnings };
  if (index >= 0) manifest[index] = row;
  else manifest.push(row);
  atomicJson(MANIFEST, manifest);
}

const archive = await unzipper.Open.file(ARCHIVE);
const entries = archive.files.filter((f) => f.path.toLowerCase().endsWith(".csv") && !f.path.startsWith("__MACOSX"));
for (const entry of entries) {
  const snapshotId = entry.path.replaceAll("/", "_").replace(/\.csv$/i, "");
  let header: string[] = [];
  const snapshot: Omit<OptionChainSnapshot, "quality"> = {
    provider: "orats_intraday", underlying: "", tradeDate: "", snapshotId,
    availableAt: "", ingestedAt, providerTimeLabel: "intraday",
    underlyingData: null, warnings: [], contracts: [],
  };
  let latestQuote = "";
  for await (const line of readline.createInterface({ input: entry.stream(), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const columns = splitCsv(line)[0] ?? [];
    if (header.length === 0) { header = columns; continue; }
    const record = Object.fromEntries(header.map((name, i) => [name, columns[i] ?? ""]));
    const meta = oratsSnapshotMeta(record);
    snapshot.underlying = meta.underlying;
    snapshot.tradeDate = meta.tradeDate;
    snapshot.underlyingData = {
      stockPrice: num(record.stockPrice), spotPrice: num(record.spotPrice), residualRate: num(record.residualRate),
      quoteDate: record.quoteDate ?? null, updatedAt: record.updatedAt ?? null,
      snapShotEstTime: record.snapShotEstTime ?? null, snapShotDate: record.snapShotDate ?? null,
    };
    latestQuote = latestQuote > String(record.updatedAt ?? record.quoteDate ?? "") ? latestQuote : String(record.updatedAt ?? record.quoteDate ?? "");
    snapshot.contracts.push(...oratsRecordToContracts(record));
  }
  snapshot.availableAt = latestQuote || ingestedAt;
  const finalized = finalizeSnapshot(snapshot);
  atomicJson(path.join(NORMALIZED, "orats-intraday", finalized.tradeDate, snapshotId, `${finalized.underlying}.json`), finalized);
  record(finalized);
  prog.log(`${snapshotId}: ${finalized.quality.rows} rows · ${finalized.quality.contracts} contracts · ${finalized.availableAt}`);
}
prog.done(`intraday snapshots: ${entries.length}`);
process.exit(0);
