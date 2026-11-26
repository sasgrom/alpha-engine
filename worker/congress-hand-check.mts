/**
 * Build 50 deterministic source excerpts for manual trade verification. This script never marks rows checked itself.
 * Usage: npx tsx worker/congress-hand-check.mts [--trades D:/.../trades-STAMP.jsonl]
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import type { ResolvedCongressTrade } from "./lib/congress";
import { writeJsonAtomic } from "./lib/json-file";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/people/congress");
if (!/^d:/i.test(realpathSync(path.parse(root).root))) throw new Error("Congress archive must resolve to D:");
const tradesFile = path.resolve(arg("--trades") ?? path.join(root, readdirSync(root).filter(name => /^trades-.*\.jsonl$/.test(name)).sort().at(-1)!));
const trades = readFileSync(tradesFile, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as ResolvedCongressTrade);
const exec = promisify(execFile);
const python = "D:/research/alpha-engine/tools/congress-venv/Scripts/python.exe";
const extractor = "import json,sys,pdfplumber\nwith pdfplumber.open(sys.argv[1]) as pdf:\n print(json.dumps({'pages':[page.extract_text() or '' for page in pdf.pages]}))";
const dateVariants = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const months = [String(month), String(month).padStart(2, "0")], days = [String(day), String(day).padStart(2, "0")];
  return months.flatMap(month => days.map(day => `${month}/${day}/${year}`));
};
const amount = (trade: ResolvedCongressTrade) => {
  const money = (value: number | null) => value === null ? null : `$${value.toLocaleString("en-US")}`;
  return trade.amountLow === null ? "None" : trade.amountHigh === null ? `Over ${money(trade.amountLow)}` : `${money(trade.amountLow)} - ${money(trade.amountHigh)}`;
};
const sample = (rows: ResolvedCongressTrade[], count: number) => {
  const ordered = [...rows].sort((a, b) => `${a.transactionDate}|${a.reportId}|${a.asset}|${a.type}`.localeCompare(`${b.transactionDate}|${b.reportId}|${b.asset}|${b.type}`));
  return Array.from({ length: Math.min(count, ordered.length) }, (_, index) => ordered[Math.floor(index * ordered.length / count)]);
};
const selected = [...sample(trades.filter(row => row.chamber === "house"), 25), ...sample(trades.filter(row => row.chamber === "senate"), 25)];
if (selected.length !== 50) throw new Error(`Need 25 rows per chamber, got ${selected.length}`);
const rows = [];
for (const [index, trade] of selected.entries()) {
  let file: string;
  if (trade.chamber === "senate") {
    file = path.join(root, "senate", "reports", `${trade.reportId}.html`);
  } else {
    const yearDirectory = readdirSync(path.join(root, "house")).find(year => existsSync(path.join(root, "house", year, `${trade.reportId}.pdf`)));
    if (!yearDirectory) throw new Error(`No House source for ${trade.reportId}`);
    file = path.join(root, "house", yearDirectory, `${trade.reportId}.pdf`);
  }
  const raw = readFileSync(file);
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== trade.sourceSha256) throw new Error(`Source hash mismatch for ${trade.reportId}`);
  let source: string | string[] | null = null;
  if (trade.chamber === "senate") {
    const document = new JSDOM(raw.toString("utf8")).window.document;
    const candidates = [...document.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].map(cell => (cell.textContent ?? "").replace(/\s+/g, " ").trim()));
    source = candidates.find(cells => dateVariants(trade.transactionDate).some(date => cells.includes(date)) && cells.includes(trade.asset) && cells.includes(amount(trade)) && cells.some(value => value.toUpperCase() === trade.owner)) ?? null;
  } else {
    const { stdout } = await exec(python, ["-I", "-c", extractor, file], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    const text = (JSON.parse(stdout) as { pages: string[] }).pages.join("\n");
    const lines = text.split(/\r?\n/).map(line => line.replace(/\b(?:gfedcb|gfedc|nmlkji|nmlkj|nmlk)\b/g, "").replace(/\s+/g, " ").trim());
    const assetInOrder = (value: string) => {
      const lower = value.toLowerCase();
      let position = 0;
      for (const token of trade.asset.toLowerCase().split(" ").filter(Boolean)) {
        const found = lower.indexOf(token, position);
        if (found < 0) return false;
        position = found + token.length;
      }
      return true;
    };
    const amountInOrder = (value: string) => {
      const money = (number: number) => `$${number.toLocaleString("en-US")}`;
      const parts = trade.amountLow === null ? ["None"] : trade.amountHigh === null || trade.amountHigh === trade.amountLow ? [money(trade.amountLow)] : [money(trade.amountLow), money(trade.amountHigh)];
      let position = 0;
      for (const part of parts) {
        const found = value.indexOf(part, position);
        if (found < 0) return false;
        position = found + part.length;
      }
      return trade.amountHigh !== null || trade.amountLow === null || /over/i.test(value);
    };
    const typeMatches = (value: string) => dateVariants(trade.transactionDate).some(date => {
      const type = trade.type === "purchase" ? "P" : trade.type === "exchange" ? "E" : trade.type === "partial sale" ? "S\\s*\\(partial\\)" : "S(?!\\s*\\(partial\\))";
      return new RegExp(`(?:^|\\s)${type}\\s+${date}`, "i").test(value);
    });
    const matches = (value: string) => typeMatches(value) && amountInOrder(value) && assetInOrder(value) && (!trade.ticker || value.toLowerCase().includes(trade.ticker.toLowerCase()));
    source = lines.map((_, index) => lines.slice(index, index + 6).join(" ")).filter((_, index) => typeMatches(lines[index])).find(matches) ?? null;
  }
  rows.push({ reviewNumber: index + 1, checked: false, source, parsed: { chamber: trade.chamber, member: trade.member, reportId: trade.reportId, filedDate: trade.filedDate, transactionDate: trade.transactionDate, notificationDate: trade.notificationDate, owner: trade.owner, filer: trade.filer, asset: trade.asset, ticker: trade.ticker, assetType: trade.assetType, type: trade.type, amountLow: trade.amountLow, amountHigh: trade.amountHigh, comment: trade.comment }, sourceFile: file, sourceSha256: hash });
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), tradesFile, method: "50 deterministic stratified rows (25 per chamber), source hash verified; checked remains false until a person reads the source", rows };
const file = path.join(root, `hand-check-${stamp}.json`);
writeJsonAtomic(file, output, true);
console.log(JSON.stringify({ file, rows: rows.length, sourceFound: rows.filter(row => row.source !== null).length, checked: 0 }, null, 1));
