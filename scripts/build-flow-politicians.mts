/**
 * The politicians of the money map (owner, 2026-11-26: "go ahead with the politicians group on the map"): per quarter,
 * the members of Congress whose stock trades in our companies were the largest, from the accepted Congress archive
 * (K34 trades, K34.1 company resolution; D:/research/alpha-engine/people/congress, read only).
 *
 *   npx tsx scripts/build-flow-politicians.mts [--input <trades-resolution-*.jsonl>] [--top 80] [--accepted-only]
 *
 * The accepted file is the base; reports collected since (the nightly jobs congress-house-daily, congress-senate-daily
 * and congress-parse-daily) are added from their per-report checkpoints unless --accepted-only.
 *
 * Rules:
 * - Stock trades resolved to one company only: options, bonds, funds and rows not resolved to a company are left out
 *   (counted). House rows keep the asset code [ST] (listed stock) or none; restricted-stock awards [RS] and the codes of
 *   private stock, LLCs and the like are left out (counted). Exchanges are neither a purchase nor a sale (counted).
 * - Amounts are the ranges the law asks for ($1,001–$15,000 …), never a point value: a row keeps its low and its high.
 *   The open top range ("over $50,000,000") counts its low for both.
 * - A row repeated exactly (member, trade date, asset, type, range, owner) in a later report of the same member is a
 *   re-filing and is counted once, under the earliest report (the day it became public). Identical rows inside one
 *   report are separate lines of that report and all count.
 * - A trade date after the filing date, or before 2012, is a misprint in the source and the row is left out (counted).
 * - Quarters are calendar quarters of the trade date, as the insiders and the 13F flows use; each row also keeps the
 *   latest filing date, since members report up to 45 days (and often later) after the trade.
 * - The trade belongs to the member, the spouse, the two jointly or a dependent child, as filed.
 * Output worker/.runs/desk-flows/politicians.json, read by desk.flowsPoliticians.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ResolvedCongressTrade } from "../worker/lib/congress";
import { resolveCongressTradeHistorical } from "../worker/lib/congress-resolution";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { CompanyIndex, type CompanyEntry } from "../worker/lib/news-companies";

// the parser versions of the accepted archive (K34): a report parsed by any other version waits for a review
const ACCEPTED_PARSERS = new Set(["house-text-v9-pdfplumber-0.11.11", "senate-html-v1"]);

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const DIR = "D:/research/alpha-engine/people/congress";
// the accepted resolution (K34.1, 2026-11-26; its 30-row identity check is signed in resolution-check-20261126T134544Z)
const input = arg("--input") ?? path.join(DIR, "trades-resolution-20261126T134505Z.jsonl");
const top = Number(arg("--top") ?? 80);
if (!existsSync(input) || !/^d:/i.test(realpathSync(input))) throw new Error(`No Congress trade file at ${input} (the D: drive may be away); nothing was written`);

// the file must be the one its summary describes
const summaryFile = input.replace(/\.jsonl$/, ".summary.json");
const summary = JSON.parse(readFileSync(summaryFile, "utf8")) as { output: { sha256: string } };
const sha256 = createHash("sha256").update(readFileSync(input)).digest("hex");
if (sha256 !== summary.output.sha256) throw new Error(`${input} does not match its summary (sha256 ${sha256} vs ${summary.output.sha256}); nothing was written`);

interface Trade {
  chamber: "house" | "senate"; member: string; state: string | null; district: string | null; filer: string; reportId: string;
  filedDate: string; transactionDate: string; owner: string; asset: string; assetType: string; type: string;
  amountLow: number; amountHigh: number | null; resolution: string; cik: number | null;
}
const counts = { rows: 0, notStock: 0, notResolved: 0, otherCode: 0, exchange: 0, badDate: 0, refiled: 0, kept: 0 };
const trades: Trade[] = [];
function keep(row: Trade): boolean {
  if (row.assetType !== "stock") { counts.notStock++; return false; }
  if (row.resolution !== "resolved" || !row.cik) { counts.notResolved++; return false; }
  // the House's asset code: listed stock is [ST] (or no code); a restricted-stock "purchase" [RS] is an award of pay
  // (Chip Roy's spouse, 2026-04-30: "Spouse awarded RSUs as part of total comp package"), not money put in; the other
  // codes are private stock, LLCs, asset-backed paper, rights or crypto
  const code = /\[([A-Z]{2})\]\s*$/.exec(row.asset)?.[1] ?? null;
  if (code && code !== "ST") { counts.otherCode++; return false; }
  if (row.type === "exchange") { counts.exchange++; return false; }
  if (!row.transactionDate || row.transactionDate < "2012-01-01" || row.transactionDate > row.filedDate) { counts.badDate++; return false; }
  return true;
}
for await (const text of createInterface({ input: createReadStream(input, "utf8"), crlfDelay: Infinity })) {
  if (!text) continue;
  counts.rows++;
  const row = JSON.parse(text) as Trade;
  if (keep(row)) trades.push(row);
}

// reports newer than the accepted file (the nightly collection): their per-report checkpoints, written by the accepted
// parser versions, resolved with the accepted historical resolution (K34.1); counted apart, since no one has checked
// them by hand yet
const newer = { reports: 0, trades: 0, otherParser: 0, notElectronic: 0, newestFiled: null as string | null };
if (!process.argv.includes("--accepted-only")) {
  const inAccepted = new Set<string>();
  for await (const text of createInterface({ input: createReadStream(input, "utf8"), crlfDelay: Infinity })) {
    if (!text) continue;
    const row = JSON.parse(text) as Trade;
    inAccepted.add(`${row.chamber}|${row.reportId}`);
  }
  const index = new CompanyIndex((JSON.parse(readFileSync("D:/research/alpha-engine/news/lookup/company-index.json", "utf8")) as { entries: CompanyEntry[] }).entries);
  const parsedDirs = [
    ...readdirSync(path.join(DIR, "house"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name)).map((entry) => path.join(DIR, "house", entry.name, "parsed")),
    path.join(DIR, "senate", "parsed"),
  ].filter((dir) => existsSync(dir));
  for (const dir of parsedDirs) {
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
      const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as { chamber: "house" | "senate"; reportId: string; parserVersion: string; status: string; transactions: ResolvedCongressTrade[] };
      if (inAccepted.has(`${parsed.chamber}|${parsed.reportId}`) || !parsed.transactions.length) continue;
      if (!ACCEPTED_PARSERS.has(parsed.parserVersion)) { newer.otherParser++; continue; }
      if (parsed.status !== "electronic") { newer.notElectronic++; continue; }
      newer.reports++;
      for (const trade of parsed.transactions) {
        const row = resolveCongressTradeHistorical(index, trade) as unknown as Trade;
        newer.trades++;
        if (!newer.newestFiled || row.filedDate > newer.newestFiled) newer.newestFiled = row.filedDate;
        counts.rows++;
        if (keep(row)) trades.push(row);
      }
    }
  }
}

// re-filings: the same row in a later report of the same member counts once, under the earliest report
trades.sort((a, b) => a.filedDate.localeCompare(b.filedDate) || a.reportId.localeCompare(b.reportId));
const firstReport = new Map<string, string>();
const kept: Trade[] = [];
for (const row of trades) {
  const key = [row.chamber, row.member, row.transactionDate, row.asset, row.type, row.amountLow, row.amountHigh, row.owner].join("|");
  const report = firstReport.get(key);
  if (report !== undefined && report !== row.reportId) { counts.refiled++; continue; }
  firstReport.set(key, row.reportId);
  kept.push(row);
}
counts.kept = kept.length;

/** "Alexander, Lamar" (the Senate's form) → "Lamar Alexander"; House names are already "First Last". */
const displayName = (row: Trade) => {
  if (row.chamber !== "senate" || !row.member.includes(",")) return row.member.trim();
  const [last, ...rest] = row.member.split(",");
  return `${rest.join(",").trim()} ${last.trim()}`.trim();
};
const whose = (row: Trade): "member" | "spouse" | "joint" | "child" => (row.filer === "spouse" || row.filer === "joint" || row.filer === "child" ? row.filer : "member");
const quarterEnd = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  const q = Math.ceil(m / 3) * 3;
  return `${y}-${String(q).padStart(2, "0")}-${q === 6 || q === 9 ? "30" : "31"}`;
};

type Row = {
  member: string; chamber: "house" | "senate"; seat: string | null; cik: number;
  bought: [number, number]; sold: [number, number]; trades: number; owners: ("member" | "spouse" | "joint" | "child")[];
  firstTrade: string; lastTrade: string; lastFiled: string; maxLagDays: number;
};
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const byQuarter = new Map<string, Map<string, Row>>();
for (const trade of kept) {
  const quarter = quarterEnd(trade.transactionDate);
  const rows = byQuarter.get(quarter) ?? new Map<string, Row>();
  byQuarter.set(quarter, rows);
  const key = `${trade.chamber}|${trade.member}|${trade.cik}`;
  const seat = trade.chamber === "house" && trade.state ? `${trade.state}${trade.district ? `-${trade.district}` : ""}` : null;
  const row = rows.get(key) ?? { member: displayName(trade), chamber: trade.chamber, seat, cik: trade.cik!, bought: [0, 0], sold: [0, 0], trades: 0, owners: [], firstTrade: trade.transactionDate, lastTrade: trade.transactionDate, lastFiled: trade.filedDate, maxLagDays: 0 };
  const side = trade.type === "purchase" ? row.bought : row.sold;
  side[0] += trade.amountLow;
  side[1] += trade.amountHigh ?? trade.amountLow;
  row.trades++;
  if (!row.owners.includes(whose(trade))) row.owners.push(whose(trade));
  if (trade.transactionDate < row.firstTrade) row.firstTrade = trade.transactionDate;
  if (trade.transactionDate > row.lastTrade) row.lastTrade = trade.transactionDate;
  if (trade.filedDate > row.lastFiled) row.lastFiled = trade.filedDate;
  row.maxLagDays = Math.max(row.maxLagDays, days(trade.transactionDate, trade.filedDate));
  rows.set(key, row);
}

// largest first by the middle of the ranges traded (both sides)
const middle = (row: Row) => (row.bought[0] + row.bought[1] + row.sold[0] + row.sold[1]) / 2;
const quarters: Record<string, Row[]> = {};
for (const [quarter, rows] of [...byQuarter].sort()) quarters[quarter] = [...rows.values()].sort((a, b) => middle(b) - middle(a)).slice(0, top);

const out = path.resolve("worker/.runs/desk-flows/politicians.json");
writeJsonAtomic(out, { schemaVersion: 1, builtAt: new Date().toISOString(), source: path.basename(input), sourceSha256: sha256, newerReports: newer, top, counts, quarters });
console.log(`politicians: ${counts.rows} rows of ${path.basename(input)} and ${newer.reports} newer reports (${newer.trades} trades, newest filed ${newer.newestFiled ?? "—"}; ${newer.otherParser} by another parser version wait); left out ${counts.notStock} not stock, ${counts.notResolved} not one company, ${counts.otherCode} other asset codes, ${counts.exchange} exchanges, ${counts.badDate} misprinted dates; ${counts.refiled} re-filed rows counted once; ${counts.kept} trades in ${Object.keys(quarters).length} quarters -> ${out}`);
process.exit(0);
