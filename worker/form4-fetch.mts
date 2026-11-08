import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fetchDoc, listFilingDocs, listFilings } from "./lib/edgar";
import { assertForm4DiskSpace, fetchSecAcceptanceDateTime, isForm4Placeholder, loadForm4Universe, readJsonFile, sha256Text, writeTextAtomic, type Form4ManifestEntry } from "./lib/form4-core";
import { writeJsonAtomic } from "./lib/json-file";
import { form4CacheRoot } from "./lib/cache-root";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const universeFile = arg("--universe") ?? "research-universe-53.json";
const tickers = arg("--tickers") ?? "";
const from = arg("--from");
const force = process.argv.includes("--force");
const universe = loadForm4Universe(path.resolve("worker", universeFile), tickers);
const root = form4CacheRoot();
assertForm4DiskSpace(root);
const secErrors: { ticker: string; accessionNo?: string; error: string }[] = [];
const summary: { ticker: string; status: string; filings: number; fetched: number; resumed: number; missingOwnershipXml: number; placeholders: number }[] = [];

for (const company of universe) {
  if (isForm4Placeholder(company)) {
    summary.push({ ticker: company.ticker, status: "not_computable", filings: 0, fetched: 0, resumed: 0, missingOwnershipXml: 0, placeholders: 1 });
    continue;
  }
  const cacheDir = path.join(root, String(company.cik));
  const manifestFile = path.join(cacheDir, "manifest.json");
  const manifest = force ? [] : readJsonFile<Form4ManifestEntry[]>(manifestFile, []);
  const known = new Map(manifest.map((entry) => [entry.accessionNo, entry]));
  let filings;
  try {
    filings = (await listFilings(company.cik, new Set(["4", "4/A"]))).filter((filing) => !from || filing.filingDate >= from);
  } catch (error) {
    secErrors.push({ ticker: company.ticker, error: String(error).slice(0, 240) });
    summary.push({ ticker: company.ticker, status: "error", filings: 0, fetched: 0, resumed: 0, missingOwnershipXml: 0, placeholders: 0 });
    continue;
  }
  let fetched = 0, resumed = 0, missingOwnershipXml = 0;
  for (const filing of filings) {
    let entry = known.get(filing.accessionNo);
    if (!entry) {
      entry = {
        accessionNo: filing.accessionNo,
        form: filing.form,
        filingDate: filing.filingDate,
        acceptanceDateTime: filing.eventTs,
        periodOfReport: filing.reportDate,
        issuerCik: company.cik,
        ownerCik: null,
        rptOwnerName: null,
        sourceUrl: "",
        inputSha256: null,
        fetched: false,
        dead: false,
        failCount: 0,
      };
      manifest.push(entry);
      known.set(entry.accessionNo, entry);
    }
    const rawFile = path.join(cacheDir, `${filing.accessionNo}.xml`);
    if (!force && entry.fetched && existsSync(rawFile) && entry.acceptanceSource === "sec_header") {
      resumed++;
      continue;
    }
    if (entry.dead && !force) continue;
    try {
      if (entry.acceptanceSource !== "sec_header") {
        entry.acceptanceDateTime = await fetchSecAcceptanceDateTime(company.cik, filing.accessionNo);
        entry.acceptanceSource = "sec_header";
        writeJsonAtomic(manifestFile, manifest, true);
      }
      if (entry.fetched && existsSync(rawFile)) {
        resumed++;
        writeJsonAtomic(manifestFile, manifest, true);
        continue;
      }
      const docs = await listFilingDocs(company.cik, filing.accessionNo);
      const candidates = docs.filter((doc) => /\.xml$/i.test(doc.name) && !/xslF345X/i.test(doc.name));
      const prioritized = [...candidates].sort((a, b) => {
        if (a.name === filing.primaryDoc) return -1;
        if (b.name === filing.primaryDoc) return 1;
        return a.name.localeCompare(b.name);
      });
      let xml = null;
      let sourceUrl = "";
      for (const candidate of prioritized) {
        const content = await fetchDoc(company.cik, filing.accessionNo, candidate.name);
        if (/<ownershipDocument[\s>]/i.test(content)) {
          xml = content;
          sourceUrl = `https://www.sec.gov/Archives/edgar/data/${company.cik}/${filing.accessionNo.replace(/-/g, "")}/${candidate.name}`;
          break;
        }
      }
      if (!xml) {
        entry.fetched = false;
        entry.error = "missing_ownership_xml";
        entry.failCount = 0;
        missingOwnershipXml++;
      } else {
        const inputSha256 = sha256Text(xml);
        writeTextAtomic(rawFile, xml);
        entry.sourceUrl = sourceUrl;
        entry.inputSha256 = inputSha256;
        entry.fetched = true;
        entry.dead = false;
        entry.failCount = 0;
        delete entry.error;
        fetched++;
      }
    } catch (error) {
      entry.fetched = false;
      entry.failCount = (entry.failCount ?? 0) + 1;
      entry.dead = entry.failCount >= 3 || /HTTP 404|HTTP 410/.test(String(error));
      entry.error = String(error).slice(0, 240);
      secErrors.push({ ticker: company.ticker, accessionNo: filing.accessionNo, error: entry.error });
    }
    writeJsonAtomic(manifestFile, manifest, true);
  }
  writeJsonAtomic(manifestFile, manifest, true);
  summary.push({ ticker: company.ticker, status: secErrors.some((error) => error.ticker === company.ticker) ? "error" : "fetched", filings: filings.length, fetched, resumed, missingOwnershipXml, placeholders: 0 });
  console.log(`[form4-fetch] ${company.ticker}: ${filings.length} filings · ${fetched} fetched · ${resumed} resumed · ${missingOwnershipXml} missing XML`);
}
writeJsonAtomic(path.join(root, "fetch-summary.json"), { schemaVersion: 1, generatedAt: new Date().toISOString(), universe: universeFile, tickers, from, companies: summary, secErrors }, true);
if (secErrors.length) throw new Error(`SEC fetch failed for ${secErrors.length} filing/company operations; see fetch-summary.json`);
