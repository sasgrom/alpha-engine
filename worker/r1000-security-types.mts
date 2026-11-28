import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "./lib/json-file";
import { r1000SecurityType, type R1000SecurityType } from "./lib/r1000-security-types";
import { commonStockListings, type ExchangeCompanyRow } from "./lib/russell1000-listed";
import { createSchwabSession } from "./lib/schwab-paced";
import { schwabSymbol } from "./lib/schwab-price-series";

const root = "D:/research/alpha-engine/index-membership/russell1000/security-types";

export async function collectR1000SecurityTypes(output?: string, rawInput?: string): Promise<string> {
  const sourceRoot = "D:/research/alpha-engine/index-membership/russell1000";
  const exchangeFile = path.join(sourceRoot, `k27-company_tickers_exchange-${new Date().toISOString().slice(0, 10)}.json`);
  const companies = JSON.parse(readFileSync(path.join(sourceRoot, "companies.json"), "utf8")).companies as any[];
  const companyCiks = new Set(companies.map(row => row.cik));
  const exchangeBody = JSON.parse(readFileSync(exchangeFile, "utf8"));
  const exchangeRows = (exchangeBody.data as any[][]).map(values => Object.fromEntries(exchangeBody.fields.map((field: string, index: number) => [field, values[index]])) as ExchangeCompanyRow);
  const byTicker = new Map<string, ExchangeCompanyRow>();
  for (const row of commonStockListings(exchangeRows)) if (companyCiks.has(row.cik) && !byTicker.has(row.ticker)) byTicker.set(row.ticker, row);
  const candidates = [...byTicker.values()];
  if (!candidates.length) throw new Error("No Russell security candidates");

  mkdirSync(root, { recursive: true });
  if (process.platform === "win32" && !/^d:/i.test(realpathSync(root))) throw new Error("Security evidence must resolve to D:");
  if (statfsSync(realpathSync(root)).bavail * statfsSync(realpathSync(root)).bsize < 2 * 1024 ** 3) throw new Error("Less than 2 GiB free on the security evidence drive");
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  const rawRoot = rawInput ? path.resolve(rawInput) : path.join(root, "raw", stamp);
  if (!rawInput) mkdirSync(rawRoot, { recursive: true });
  const file = path.resolve(output ?? path.join(root, `${stamp}.json`));
  const session = rawInput ? null : createSchwabSession({ log: line => console.log(`[r1000-security-types] ${line}`) });
  await session?.prepare();
  const rows: R1000SecurityType[] = [], rawFiles: { file: string; sha256: string; symbols: number }[] = [];
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const batch = candidates.slice(offset, offset + 100);
    const rawFile = path.join(rawRoot, `${String(offset / 100 + 1).padStart(3, "0")}.json`);
    const body = rawInput ? readFileSync(rawFile, "utf8") : await session!.get(`quotes?symbols=${encodeURIComponent(batch.map(row => schwabSymbol(row.ticker)).join(","))}&fields=reference`);
    const parsed = JSON.parse(body);
    if (!rawInput) {
      const temporary = `${rawFile}.${process.pid}.tmp`;
      try {
        writeFileSync(temporary, body, { flag: "wx" });
        renameSync(temporary, rawFile);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    rawFiles.push({ file: rawFile, sha256: createHash("sha256").update(body).digest("hex"), symbols: batch.length });
    for (const row of batch) rows.push(r1000SecurityType(row, parsed[row.ticker] ?? parsed[schwabSymbol(row.ticker)]));
    console.log(`[r1000-security-types] ${Math.min(offset + 100, candidates.length)}/${candidates.length} symbols`);
  }
  const document = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: { provider: "schwab", endpoint: "quotes", fields: "reference", rawFiles },
    counts: { candidates: candidates.length, resolved: rows.filter(row => row.assetType !== null).length, unresolved: rows.filter(row => row.assetType === null).length },
    rows,
    productionWrite: false,
    databaseWrite: false,
  };
  writeJsonAtomic(file, document, true);
  console.log(JSON.stringify({ file, counts: document.counts }, null, 1));
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  await collectR1000SecurityTypes(arg("--out"), arg("--raw"));
}
