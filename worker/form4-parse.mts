import { readFileSync } from "node:fs";
import path from "node:path";
import { isForm4Placeholder, loadForm4Universe, readJsonFile, sha256Text, type Form4ManifestEntry, type Form4Transaction } from "./lib/form4-core";
import { parseForm4Xml } from "./lib/form4-xml";
import { writeJsonAtomic } from "./lib/json-file";
import { form4CacheRoot } from "./lib/cache-root";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const universeFile = arg("--universe") ?? "research-universe-53.json";
const tickers = arg("--tickers") ?? "";
const from = arg("--from");
const universe = loadForm4Universe(path.resolve("worker", universeFile), tickers);
const root = form4CacheRoot();
const summary: { ticker: string; status: string; accessions: number; transactions: number; errors: string[] }[] = [];
const errors: string[] = [];

for (const company of universe) {
  if (isForm4Placeholder(company)) {
    summary.push({ ticker: company.ticker, status: "not_computable", accessions: 0, transactions: 0, errors: [] });
    continue;
  }
  const cacheDir = path.join(root, String(company.cik));
  const manifestFile = path.join(cacheDir, "manifest.json");
  const manifest = readJsonFile<Form4ManifestEntry[]>(manifestFile, []);
  const transactions: Form4Transaction[] = [];
  const companyErrors: string[] = [];
  const seen = new Set<string>();
  for (const entry of manifest) {
    if (!entry.fetched || seen.has(entry.accessionNo) || (from && entry.filingDate < from)) continue;
    seen.add(entry.accessionNo);
    try {
      const xml = readFileSync(path.join(cacheDir, `${entry.accessionNo}.xml`), "utf8");
      const inputSha256 = sha256Text(xml);
      if (inputSha256 !== entry.inputSha256) throw new Error("inputSha256 mismatch");
      const rows = parseForm4Xml(xml, {
        accessionNo: entry.accessionNo,
        form: entry.form,
        availableAt: entry.acceptanceDateTime,
        issuerCik: company.cik,
        ticker: company.ticker,
        periodOfReport: entry.periodOfReport,
        sourceUrl: entry.sourceUrl,
        inputSha256,
      });
      transactions.push(...rows);
      if (!entry.ownerCik && rows[0]?.ownerCik) entry.ownerCik = rows[0].ownerCik;
      if (!entry.rptOwnerName && rows[0]?.rptOwnerName) entry.rptOwnerName = rows[0].rptOwnerName;
    } catch (error) {
      companyErrors.push(`${entry.accessionNo}: ${String(error).slice(0, 240)}`);
    }
  }
  writeJsonAtomic(manifestFile, manifest, true);
  writeJsonAtomic(path.join(cacheDir, "transactions.json"), {
    schemaVersion: 1,
    issuerCik: company.cik,
    ticker: company.ticker,
    generatedAt: new Date().toISOString(),
    transactions,
  }, true);
  const status = companyErrors.length ? "error" : transactions.length ? "parsed" : "not_computable";
  summary.push({ ticker: company.ticker, status, accessions: seen.size, transactions: transactions.length, errors: companyErrors });
  errors.push(...companyErrors.map((error) => `${company.ticker}: ${error}`));
  console.log(`[form4-parse] ${company.ticker}: ${seen.size} accessions · ${transactions.length} transactions · ${companyErrors.length} errors`);
}
writeJsonAtomic(path.join(root, "parse-summary.json"), { schemaVersion: 1, generatedAt: new Date().toISOString(), companies: summary, errors }, true);
if (errors.length) throw new Error(`Form 4 parse failed for ${errors.length} accessions; see parse-summary.json`);
