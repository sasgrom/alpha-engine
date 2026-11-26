import { createHash } from "node:crypto";
import { readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveCongressTradeHistorical } from "./lib/congress-resolution";
import type { ResolvedCongressTrade } from "./lib/congress";
import { CompanyIndex, type CompanyEntry } from "./lib/news-companies";
import { writeJsonAtomic } from "./lib/json-file";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/people/congress");
const input = path.resolve(arg("--input") ?? path.join(root, "trades-20261126T120447Z.jsonl"));
if (!/^d:/i.test(realpathSync(path.parse(root).root)) || !/^d:/i.test(realpathSync(input))) throw new Error("Congress resolution input/output must resolve to D:");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const output = path.resolve(arg("--output") ?? path.join(root, `trades-resolution-${stamp}.jsonl`));
if (output === input) throw new Error("Resolution output must not replace the accepted input");
const companyIndexFile = "D:/research/alpha-engine/news/lookup/company-index.json";
const company = JSON.parse(readFileSync(companyIndexFile, "utf8")) as { entries: CompanyEntry[] };
const index = new CompanyIndex(company.entries);
const before = readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as ResolvedCongressTrade);
const after = before.map(trade => resolveCongressTradeHistorical(index, trade));
const temporary = `${output}.${process.pid}.tmp`;
try {
  writeFileSync(temporary, `${after.map(row => JSON.stringify(row)).join("\n")}\n`, { flag: "wx" });
  renameSync(temporary, output);
} finally {
  rmSync(temporary, { force: true });
}
const changed = after.filter((row, i) => row.resolution === "resolved" && before[i].resolution !== "resolved");
const byReason = Object.fromEntries([...new Set(changed.map(row => row.resolutionMethod))].sort().map(reason => [reason, {
  total: changed.filter(row => row.resolutionMethod === reason).length,
  house: changed.filter(row => row.resolutionMethod === reason && row.chamber === "house").length,
  senate: changed.filter(row => row.resolutionMethod === reason && row.chamber === "senate").length,
}]));
const stock = (rows: ResolvedCongressTrade[]) => ({
  trades: rows.filter(row => row.assetType === "stock").length,
  resolved: rows.filter(row => row.assetType === "stock" && row.resolution === "resolved").length,
  unresolved: rows.filter(row => row.assetType === "stock" && row.resolution !== "resolved").length,
});
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  input: { file: input, bytes: statSync(input).size, sha256: hash(input) },
  output: { file: output, bytes: statSync(output).size, sha256: hash(output) },
  companyIndex: { file: companyIndexFile, entries: company.entries.length },
  method: "Resolution only: normalized stated ticker; cleaned company-name fallback; optional leading symbol. No re-parse or ticker-date invention. ETFs/funds/notes are not newly resolved.",
  before: stock(before),
  after: stock(after),
  newlyResolved: { total: changed.length, house: changed.filter(row => row.chamber === "house").length, senate: changed.filter(row => row.chamber === "senate").length },
  byReason,
  newlyResolvedExamples: changed.filter(row => ["FB", "TWTR", "SQ", "uTX", "ATVI", "PXD", "CBS"].includes(before[after.indexOf(row)].ticker ?? "") || !before[after.indexOf(row)].ticker).slice(0, 30).map(row => ({ chamber: row.chamber, transactionDate: row.transactionDate, asset: row.asset, cik: row.cik, company: row.candidates[0]?.name, method: row.resolutionMethod })),
};
writeJsonAtomic(output.replace(/\.jsonl$/, ".summary.json"), summary, true);
console.log(JSON.stringify(summary, null, 1));
