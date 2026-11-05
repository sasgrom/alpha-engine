import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ingestShortInterest, type SiPoint } from "../api/services/short-interest";
import { getDb } from "../api/queries/connection";

try {
const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const generatedAt = new Date().toISOString();
const filesUrl = "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/files";
const filesResponse = await fetch(filesUrl);
if (!filesResponse.ok) throw new Error(`FINRA catalog HTTP ${filesResponse.status}`);
const html = await filesResponse.text();
const links = [...new Set([...html.matchAll(/https:\/\/cdn\.finra\.org\/equity\/otcmarket\/biweekly\/shrt\d{8}\.csv/g)].map((match) => match[0]))];
if (!links.length) throw new Error("No official FINRA biweekly CSV was linked");
const sourceUrl = links.at(-1)!;
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`FINRA CSV HTTP ${response.status}`);
const csv = await response.text();
const lines = csv.trim().split(/\r?\n/);
const header = lines[0].split("|").map((value) => value.replaceAll('"', ""));
const records = new Map<string, SiPoint & { accountingYearMonthNumber: string }>();
for (const line of lines.slice(1)) {
  const values = line.split("|").map((value) => value.replaceAll('"', ""));
  const field = (name: string) => values[header.indexOf(name)] || null;
  const symbol = field("symbolCode")?.toUpperCase();
  const settlementDate = field("settlementDate");
  const accountingYearMonthNumber = field("accountingYearMonthNumber");
  if (!symbol || !settlementDate || !accountingYearMonthNumber || settlementDate.replaceAll("-", "") !== accountingYearMonthNumber) continue;
  const sharesText = field("currentShortPositionQuantity");
  if (!sharesText) continue;
  const sharesShort = Number(sharesText);
  if (!Number.isFinite(sharesShort)) continue;
  const ratioText = field("daysToCoverQuantity");
  const shortRatio = ratioText === null ? null : Number(ratioText);
  records.set(symbol, {
    settlementDate,
    sharesShort,
    shortRatio: shortRatio !== null && Number.isFinite(shortRatio) ? shortRatio : null,
    shortPercentOfFloat: null,
    accountingYearMonthNumber,
  });
}
const archiveDir = path.resolve("D:/research/alpha-engine/short-interest");
mkdirSync(archiveDir, { recursive: true });
const settlementDates = [...new Set([...records.values()].map((record) => record.settlementDate))].sort();
if (settlementDates.length !== 1) throw new Error("FINRA file has inconsistent settlement dates");
const archivePath = path.join(archiveDir, `${settlementDates[0]}.csv`);
writeFileSync(archivePath, csv);
const sourceSha256 = createHash("sha256").update(csv).digest("hex");
const results: any[] = [];
for (const company of universe) {
  const record = records.get(company.ticker);
  if (!record) {
    results.push({ ...company, status: "missing_official", source: "finra", settlementDate: null });
    continue;
  }
  try {
    const { accountingYearMonthNumber, ...point } = record;
    const written = await ingestShortInterest(company.cik, [point], "finra");
    results.push({ ...company, status: "collected", ...record, source: "finra", fetchedAt: new Date().toISOString(), rowsWritten: written, shortPercentOfFloatStatus: "missing_official" });
  } catch (error) {
    results.push({ ...company, status: "error", source: "finra", error: String(error).slice(0, 240) });
  }
}
const output = {
  schemaVersion: 1,
  generatedAt,
  source: "finra",
  sourceUrl,
  archivePath,
  sourceSha256,
  settlementDate: settlementDates[0],
  officialSymbols: records.size,
  companies: results,
};
writeFileSync("worker/.runs/local-generated/short-interest-50.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ sourceUrl, archivePath, sourceSha256, settlementDate: settlementDates[0], collected: results.filter((result) => result.status === "collected").length, missingOfficial: results.filter((result) => result.status === "missing_official").map((result) => result.ticker), errors: results.filter((result) => result.status === "error").map((result) => ({ ticker: result.ticker, error: result.error })) }, null, 2));
} finally {
  await getDb().$client.end();
}
