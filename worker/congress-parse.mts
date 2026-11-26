/**
 * Parse stored congressional PTRs only; no network or database. pdfplumber handles House text PDFs, the Senate parser
 * reads electronic HTML, and CompanyIndex resolves assets. Per-report checkpoints make every rerun idempotent.
 * Usage: npx tsx worker/congress-parse.mts [--limit N] [--only ID] [--year YYYY] [--chamber house|senate]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { assetTypeWithOptionEvidence, parseHousePdfText, parseSenateHtml, resolveCongressTrade, type ResolvedCongressTrade, type SenateSearchReport } from "./lib/congress";
import type { HouseFiling } from "./lib/congress-house";
import { writeJsonAtomic } from "./lib/json-file";
import { CompanyIndex, type CompanyEntry } from "./lib/news-companies";
import { startProgress } from "./lib/progress";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/people/congress");
const python = path.resolve(arg("--python") ?? "D:/research/alpha-engine/tools/congress-venv/Scripts/python.exe");
const limit = arg("--limit") === null ? Number.POSITIVE_INFINITY : Number(arg("--limit"));
const only = arg("--only");
const year = arg("--year") === null ? null : Number(arg("--year"));
const chamber = arg("--chamber");
if (!(limit > 0)) throw new Error("--limit must be positive");
if (chamber && !["house", "senate"].includes(chamber)) throw new Error("--chamber must be house or senate");
if (!/^d:/i.test(realpathSync(path.parse(root).root))) throw new Error("Congress archive must resolve to D:");
const companyIndexFile = "D:/research/alpha-engine/news/lookup/company-index.json";
const companyDoc = JSON.parse(readFileSync(companyIndexFile, "utf8")) as { entries: CompanyEntry[] };
const index = new CompanyIndex(companyDoc.entries);
const prog = startProgress("congress-parse", `${root}${only ? ` · ${only}` : ""}${chamber ? ` · ${chamber}` : ""}`);
const exec = promisify(execFile);
const extractor = "import json,sys,pdfplumber\nwith pdfplumber.open(sys.argv[1]) as pdf:\n print(json.dumps({'pages':[page.extract_text() or '' for page in pdf.pages]}))";

interface HouseCheckpoint extends HouseFiling {
  status: string;
  bytes: number | null;
  sha256: string | null;
  firstSeenAt: string;
  error: string | null;
}
interface SenateCheckpoint extends SenateSearchReport {
  status: string;
  firstSeenAt: string;
  html: { sha256: string; bytes: number } | null;
  pdf: { sha256: string; bytes: number } | null;
  images?: unknown[];
}
interface SourceItem {
  chamber: "house" | "senate";
  reportId: string;
  year: number;
  member: string;
  state: string | null;
  district: string | null;
  filedDate: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceBytes: number;
  firstSeenAt: string;
  file: string;
  parsedFile: string;
  filing: HouseCheckpoint | null;
  scanned: boolean;
}
interface ParsedReport {
  schemaVersion: 1;
  parserVersion: string;
  chamber: "house" | "senate";
  reportId: string;
  year: number;
  member: string;
  sourceSha256: string;
  sourceBytes: number;
  firstSeenAt: string;
  parsedAt: string;
  status: "electronic" | "scanned" | "failed";
  pages: number;
  transactions: ResolvedCongressTrade[];
  error: string | null;
}

const parserVersion = (item: SourceItem) => item.chamber === "house" ? "house-text-v8-pdfplumber-0.11.11" : "senate-html-v1";
const files = [...readHouse(), ...readSenate()].filter(item => (!only || item.reportId === only) && (year === null || item.year === year) && (!chamber || item.chamber === chamber));

function readHouse(): SourceItem[] {
  const houseRoot = path.join(root, "house");
  if (!existsSync(houseRoot)) return [];
  const years = readdirSync(houseRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d{4}$/.test(entry.name)).map(entry => Number(entry.name)).sort((a, b) => a - b);
  const out: SourceItem[] = [];
  for (const currentYear of years) {
    const manifestFile = path.join(houseRoot, String(currentYear), "manifest.json");
    if (!existsSync(manifestFile)) continue;
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { reports: HouseCheckpoint[] };
    for (const filing of manifest.reports) {
      if (!filing.sha256 || !filing.bytes || !filing.filedDate) continue;
      const file = path.join(houseRoot, String(currentYear), `${filing.docId}.pdf`);
      if (!existsSync(file)) continue;
      out.push({ chamber: "house", reportId: filing.docId, year: filing.year, member: filing.member, state: filing.state, district: filing.district, filedDate: filing.filedDate, sourceUrl: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${filing.year}/${filing.docId}.pdf`, sourceSha256: filing.sha256, sourceBytes: filing.bytes, firstSeenAt: filing.firstSeenAt, file, parsedFile: path.join(houseRoot, String(currentYear), "parsed", `${filing.docId}.json`), filing, scanned: false });
    }
  }
  return out;
}

function readSenate(): SourceItem[] {
  const senateRoot = path.join(root, "senate");
  const manifestFile = path.join(senateRoot, "reports", "manifest.json");
  if (!existsSync(manifestFile)) return [];
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { reports: SenateCheckpoint[] };
  const out: SourceItem[] = [];
  for (const report of manifest.reports) {
    const source = report.html ?? report.pdf;
    if (!source || report.status === "failed" || report.status === "pending") continue;
    const extension = report.html ? "html" : "pdf";
    const file = path.join(senateRoot, "reports", `${report.reportId}.${extension}`);
    if (!existsSync(file)) continue;
    out.push({ chamber: "senate", reportId: report.reportId, year: Number(report.filedDate.slice(0, 4)), member: report.member, state: null, district: null, filedDate: report.filedDate, sourceUrl: report.sourceUrl, sourceSha256: source.sha256, sourceBytes: source.bytes, firstSeenAt: report.firstSeenAt, file, parsedFile: path.join(senateRoot, "parsed", `${report.reportId}.json`), filing: null, scanned: !report.html || Boolean(report.pdf) || Boolean(report.images?.length) });
  }
  return out;
}

let processed = 0;
for (const [position, item] of files.entries()) {
  const previous: ParsedReport | null = existsSync(item.parsedFile) ? JSON.parse(readFileSync(item.parsedFile, "utf8")) : null;
  if (previous?.sourceSha256 === item.sourceSha256 && previous.parserVersion === parserVersion(item)) continue;
  if (previous?.sourceSha256 === item.sourceSha256 && item.chamber === "house" && previous.parserVersion === "house-text-v5-pdfplumber-0.11.11") {
    const migrated: ParsedReport = { ...previous, parserVersion: parserVersion(item), parsedAt: new Date().toISOString(), transactions: previous.transactions.map(trade => ({ ...trade, assetType: assetTypeWithOptionEvidence(trade.asset, trade.assetType) })) };
    writeJsonAtomic(item.parsedFile, migrated, true);
    prog.item(position + 1, files.length, `${item.reportId} migrated asset classes`);
    continue;
  }
  if (processed >= limit) break;
  processed++;
  const now = new Date().toISOString();
  let parsed: ParsedReport;
  const base = { schemaVersion: 1 as const, parserVersion: parserVersion(item), chamber: item.chamber, reportId: item.reportId, year: item.year, member: item.member, sourceSha256: item.sourceSha256, sourceBytes: item.sourceBytes, firstSeenAt: item.firstSeenAt, parsedAt: now };
  try {
    if (item.scanned) {
      parsed = { ...base, status: "scanned", pages: 0, transactions: [], error: null };
    } else if (item.chamber === "senate") {
      const trades = parseSenateHtml(readFileSync(item.file, "utf8"), { member: item.member, state: item.state, district: item.district, reportId: item.reportId, filedDate: item.filedDate, sourceSha256: item.sourceSha256, sourceUrl: item.sourceUrl }).map(trade => resolveCongressTrade(index, trade));
      if (!trades.length) throw new Error("Electronic Senate PTR yielded no transaction rows");
      parsed = { ...base, status: "electronic", pages: 1, transactions: trades, error: null };
    } else {
      const { stdout } = await exec(python, ["-I", "-c", extractor, item.file], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      const extracted = JSON.parse(stdout) as { pages: string[] };
      const text = extracted.pages.join("\n");
      const trades = text.trim() ? parseHousePdfText(text, item.filing!, item.sourceSha256).map(trade => resolveCongressTrade(index, trade)) : [];
      if (text.trim() && !trades.length) throw new Error("Electronic House PTR yielded no transaction rows");
      parsed = { ...base, status: text.trim() ? "electronic" : "scanned", pages: extracted.pages.length, transactions: trades, error: null };
    }
  } catch (error) {
    parsed = { ...base, status: "failed", pages: 0, transactions: [], error: String(error).slice(0, 500) };
  }
  mkdirSync(path.dirname(item.parsedFile), { recursive: true });
  writeJsonAtomic(item.parsedFile, parsed, true);
  prog.item(position + 1, files.length, `${item.chamber} ${item.reportId} ${parsed.status} · ${parsed.transactions.length} trades`);
}

const reports: ParsedReport[] = [];
for (const item of files) {
  if (!existsSync(item.parsedFile)) continue;
  const parsed = JSON.parse(readFileSync(item.parsedFile, "utf8")) as ParsedReport;
  if (parsed.sourceSha256 === item.sourceSha256 && parsed.parserVersion === parserVersion(item)) reports.push(parsed);
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const tradesFile = path.join(root, `trades-${stamp}.jsonl`);
const temporary = `${tradesFile}.${process.pid}.tmp`;
try {
  writeFileSync(temporary, reports.flatMap(report => report.transactions).map(row => JSON.stringify(row)).join("\n") + (reports.some(report => report.transactions.length) ? "\n" : ""));
  renameSync(temporary, tradesFile);
} finally {
  rmSync(temporary, { force: true });
}
const all = reports.flatMap(report => report.transactions);
const active = new Map<string, number>();
for (const trade of all) active.set(`${trade.chamber}: ${trade.member}`, (active.get(`${trade.chamber}: ${trade.member}`) ?? 0) + 1);
const groups = new Map<string, ParsedReport[]>();
for (const report of reports) {
  const key = `${report.chamber}:${report.year}`;
  groups.set(key, [...groups.get(key) ?? [], report]);
}
const byYearAndChamber = Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => [key, {
  electronic: rows.filter(row => row.status === "electronic").length,
  scanned: rows.filter(row => row.status === "scanned").length,
  failed: rows.filter(row => row.status === "failed").length,
  transactions: rows.reduce((sum, row) => sum + row.transactions.length, 0),
}]));
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  tradesFile,
  companyIndex: { file: companyIndexFile, entries: companyDoc.entries.length },
  reports: { total: reports.length, electronic: reports.filter(row => row.status === "electronic").length, scanned: reports.filter(row => row.status === "scanned").length, failed: reports.filter(row => row.status === "failed").map(row => ({ chamber: row.chamber, year: row.year, reportId: row.reportId, error: row.error })) },
  transactions: all.length,
  resolution: { resolved: all.filter(row => row.resolution === "resolved").length, ambiguous: all.filter(row => row.resolution === "ambiguous").length, notCompany: all.filter(row => row.resolution === "not a company").length, resolvedShare: all.length ? all.filter(row => row.resolution === "resolved").length / all.length : null },
  byYearAndChamber,
  mostActiveMembers: [...active].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([member, transactions]) => ({ member, transactions })),
  handChecked: { count: 0, required: 50, status: "pending manual comparison against source documents" },
};
writeJsonAtomic(path.join(root, `trades-${stamp}.summary.json`), summary, true);
prog.done(`${reports.length} reports · ${all.length} trades · ${summary.resolution.resolved} resolved · ${summary.reports.scanned} scanned`);
