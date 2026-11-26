/**
 * House Clerk PTR raw archive. One request a second; each yearly ZIP and PDF is an atomic, hashed checkpoint.
 * Usage: npx tsx worker/congress-house.mts [--from 2012] [--to 2026] [--limit N] [--index-only]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { houseIndexUrl, housePtrUrl, parseHouseIndex, type HouseFiling } from "./lib/congress-house";
import { readCollectorTodo, withCollectorRetries } from "./lib/collector-todo";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const from = Number(arg("--from") ?? 2012);
const to = Number(arg("--to") ?? new Date().getUTCFullYear());
const limit = arg("--limit") === null ? Number.POSITIVE_INFINITY : Number(arg("--limit"));
const indexOnly = process.argv.includes("--index-only");
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2012 || to < from || to > new Date().getUTCFullYear()) throw new Error("Invalid House year range");
if (!(limit > 0)) throw new Error("--limit must be positive");
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/people/congress/house");
if (!/^d:/i.test(realpathSync(path.parse(root).root))) throw new Error("House raw archive must resolve to D:");
mkdirSync(root, { recursive: true });
const todoFile = path.join(root, "house-todo.jsonl");
const prog = startProgress("congress-house", `${from}..${to} · ${root}${indexOnly ? " · indexes only" : ""}`);
let lastRequest = 0;
let requests = 0;
let downloads = 0;
let failures = 0;

const sha256 = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const evidence = (file: string, url: string, firstSeenAt: string) => {
  const body = readFileSync(file);
  return { url, file: path.basename(file), bytes: body.length, sha256: sha256(body), firstSeenAt };
};
function writeRaw(file: string, body: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, body, { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
async function get(url: string): Promise<Buffer> {
  const wait = Math.max(0, 1000 - (Date.now() - lastRequest));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  const response = await fetch(url, { headers: { "User-Agent": "alpha-engine-public-research/1.0" }, signal: AbortSignal.timeout(60_000) });
  lastRequest = Date.now();
  requests++;
  if (!response.ok) throw new Error(`House HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
function validPdf(file: string): boolean {
  if (!existsSync(file) || statSync(file).size < 8) return false;
  return readFileSync(file).subarray(0, 5).toString("ascii") === "%PDF-";
}
function indexXml(body: Buffer): string {
  const files = unzipSync(new Uint8Array(body));
  const names = Object.keys(files).filter(name => name.toLowerCase().endsWith(".xml"));
  if (names.length !== 1) throw new Error(`House index ZIP has ${names.length} XML files`);
  return Buffer.from(files[names[0]]).toString("utf8");
}

interface ReportCheckpoint extends HouseFiling {
  status: "complete" | "resumed" | "failed";
  bytes: number | null;
  sha256: string | null;
  firstSeenAt: string;
  fetchedAt: string | null;
  error: string | null;
}
interface YearManifest {
  schemaVersion: 1;
  year: number;
  index: ReturnType<typeof evidence> | null;
  updatedAt: string;
  reports: ReportCheckpoint[];
}

const summary: { year: number; ptrs: number; complete: number; failed: number; bytes: number }[] = [];
for (let year = from; year <= to; year++) {
  const directory = path.join(root, String(year));
  mkdirSync(directory, { recursive: true });
  const manifestFile = path.join(directory, "manifest.json");
  const previous: YearManifest | null = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
  const indexFile = path.join(directory, `${year}FD.zip`);
  const url = houseIndexUrl(year);
  let indexBody: Buffer;
  if (existsSync(indexFile)) {
    indexBody = readFileSync(indexFile);
    if (previous?.index && (previous.index.sha256 !== sha256(indexBody) || previous.index.bytes !== indexBody.length)) throw new Error(`${year} index does not match its completed checkpoint`);
  } else {
    indexBody = await get(url);
    writeRaw(indexFile, indexBody);
  }
  const filings = parseHouseIndex(indexXml(indexBody), year);
  const ptrs = filings.filter(row => row.filingType === "P" || row.filingType === "T");
  const oldReports = new Map(previous?.reports.map(row => [row.docId, row]) ?? []);
  const manifest: YearManifest = {
    schemaVersion: 1,
    year,
    index: previous?.index ?? evidence(indexFile, url, new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    reports: indexOnly ? previous?.reports ?? [] : [],
  };
  writeJsonAtomic(manifestFile, manifest, true);
  prog.stage(`${year}: ${ptrs.length} PTRs in ${filings.length} filings`);
  for (const [index, filing] of (indexOnly ? [] : ptrs).entries()) {
    const old = oldReports.get(filing.docId);
    const file = path.join(directory, `${filing.docId}.pdf`);
    const now = new Date().toISOString();
    let checkpoint: ReportCheckpoint = { ...filing, status: "failed", bytes: null, sha256: null, firstSeenAt: old?.firstSeenAt ?? now, fetchedAt: null, error: null };
    if (validPdf(file)) {
      const item = evidence(file, housePtrUrl(year, filing.docId), checkpoint.firstSeenAt);
      if (old?.sha256 && (old.sha256 !== item.sha256 || old.bytes !== item.bytes)) {
        checkpoint.error = "Existing PDF does not match its checkpoint";
        failures++;
      } else {
        checkpoint = { ...checkpoint, status: "resumed", bytes: item.bytes, sha256: item.sha256, fetchedAt: old?.fetchedAt ?? now };
      }
    } else if (downloads < limit && statfsSync(path.parse(root).root).bavail * statfsSync(path.parse(root).root).bsize >= 20 * 1024 ** 3) {
      const url = housePtrUrl(year, filing.docId);
      const attempted = await withCollectorRetries({
        operation: async () => {
          const body = await get(url);
          if (body.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("House PTR response is not a PDF");
          writeRaw(file, body);
          return body;
        },
        todoFile,
        item: { reportId: filing.docId, document: `${filing.docId}.pdf`, url },
      });
      if (attempted.value) {
        const body = attempted.value;
        checkpoint = { ...checkpoint, status: "complete", bytes: body.length, sha256: sha256(body), fetchedAt: now };
        downloads++;
      } else {
        checkpoint.error = attempted.error;
        failures++;
      }
    } else if (downloads >= limit) {
      checkpoint.error = "Not attempted: run limit reached";
    } else {
      checkpoint.error = "Not attempted: less than 20 GiB free on D:";
      failures++;
    }
    manifest.reports.push(checkpoint);
    manifest.updatedAt = new Date().toISOString();
    writeJsonAtomic(manifestFile, manifest, true);
    prog.item(index + 1, ptrs.length, `${filing.docId} ${checkpoint.status}`);
  }
  writeJsonAtomic(manifestFile, manifest, true);
  summary.push({ year, ptrs: ptrs.length, complete: manifest.reports.filter(row => row.status !== "failed" && row.bytes !== null).length, failed: manifest.reports.filter(row => row.status === "failed").length, bytes: manifest.reports.reduce((sum, row) => sum + (row.bytes ?? 0), 0) });
  prog.stageDone(`${year}: ${summary.at(-1)!.complete}/${ptrs.length} PDFs available`);
}
const pending = indexOnly ? [] : readCollectorTodo(todoFile);
let postFetchResolved = 0;
for (const item of pending) {
  const match = item.url.match(/\/ptr-pdfs\/(\d{4})\/(\d+)\.pdf$/);
  if (!match) throw new Error(`House todo URL is not a PTR PDF: ${item.url}`);
  const currentYear = Number(match[1]);
  const manifestFile = path.join(root, String(currentYear), "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as YearManifest;
  const row = manifest.reports.find(report => report.docId === match[2]);
  if (!row) throw new Error(`House todo ${item.reportId} is absent from the ${currentYear} manifest`);
  const file = path.join(root, String(currentYear), `${row.docId}.pdf`);
  const attempted = await withCollectorRetries({
    operation: async () => {
      const body = existsSync(file) ? readFileSync(file) : await get(item.url);
      if (body.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("House PTR response is not a PDF");
      if (!existsSync(file)) writeRaw(file, body);
      return body;
    },
    todoFile,
    item,
    attempts: 2,
  });
  if (attempted.value) {
    row.status = "complete";
    row.bytes = attempted.value.length;
    row.sha256 = sha256(attempted.value);
    row.fetchedAt = new Date().toISOString();
    row.error = null;
    postFetchResolved++;
  } else {
    row.status = "failed";
    row.error = attempted.error;
  }
  writeJsonAtomic(manifestFile, manifest, true);
  const yearSummary = summary.find(entry => entry.year === currentYear);
  if (yearSummary) {
    yearSummary.complete = manifest.reports.filter(report => report.status !== "failed" && report.bytes !== null).length;
    yearSummary.failed = manifest.reports.filter(report => report.status === "failed").length;
    yearSummary.bytes = manifest.reports.reduce((sum, report) => sum + (report.bytes ?? 0), 0);
  }
}
const remaining = readCollectorTodo(todoFile).length;
const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), root, requests, newDownloads: downloads, mainFailures: failures, failures: remaining, todo: { file: todoFile, attempted: pending.length, resolved: postFetchResolved, remaining, attemptsPerItem: 2 }, indexOnly, years: summary };
writeJsonAtomic(path.join(root, "summary.json"), output, true);
prog.done(`${summary.reduce((sum, row) => sum + row.complete, 0)} PDFs available · ${downloads} downloaded · ${remaining} failed · post-pass ${postFetchResolved}/${pending.length} resolved`);
if (remaining) process.exitCode = 1;
