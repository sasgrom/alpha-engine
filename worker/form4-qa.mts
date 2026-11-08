import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchDoc, listFilingDocs, listFilings } from "./lib/edgar";
import { fetchSecAcceptanceDateTime, readJsonFile, sha256Text, writeTextAtomic, type Form4Transaction } from "./lib/form4-core";
import { form4ExclusionReason, supersedeForm4Transactions } from "./lib/form4-features";
import { parseForm4Xml } from "./lib/form4-xml";
import { form4FixtureXml } from "./lib/form4-test-fixtures";
import { writeJsonAtomic } from "./lib/json-file";

const strictQa = process.argv.includes("--strict-qa");
const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : "2020-01-01";
const root = path.resolve("worker/cache/edgar-form4");
const qaRoot = path.join(root, "qa");
const external = [
  { cik: 1108524, ticker: "CRM" },
  { cik: 1341439, ticker: "ORCL" },
  { cik: 796343, ticker: "ADBE" },
];

async function fetchGolden(company: { cik: number; ticker: string }): Promise<Form4Transaction[]> {
  const cacheDir = path.join(qaRoot, String(company.cik));
  const cached = readJsonFile<{ transactions?: Form4Transaction[] }>(path.join(cacheDir, "transactions.json"), {});
  if (cached.transactions?.length) {
    for (const accessionNo of new Set(cached.transactions.map((row) => row.accessionNo))) {
      const availableAt = await fetchSecAcceptanceDateTime(company.cik, accessionNo);
      for (const row of cached.transactions.filter((candidate) => candidate.accessionNo === accessionNo)) row.availableAt = availableAt;
    }
    writeJsonAtomic(path.join(cacheDir, "transactions.json"), { schemaVersion: 1, qaOnly: true, transactions: cached.transactions }, true);
    return cached.transactions;
  }
  const filings = (await listFilings(company.cik, new Set(["4", "4/A"])))
    .filter((filing) => filing.filingDate >= from)
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  for (const filing of filings.slice(0, 30)) {
    const docs = await listFilingDocs(company.cik, filing.accessionNo);
    for (const doc of docs.filter((item) => /\.xml$/i.test(item.name) && !/xslF345X/i.test(item.name))) {
      const xml = await fetchDoc(company.cik, filing.accessionNo, doc.name);
      if (!/<ownershipDocument[\s>]/i.test(xml)) continue;
      const inputSha256 = sha256Text(xml);
      const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${company.cik}/${filing.accessionNo.replace(/-/g, "")}/${doc.name}`;
      const availableAt = await fetchSecAcceptanceDateTime(company.cik, filing.accessionNo);
      const rows = parseForm4Xml(xml, {
        accessionNo: filing.accessionNo,
        form: filing.form,
        availableAt,
        issuerCik: company.cik,
        ticker: company.ticker,
        periodOfReport: filing.reportDate,
        sourceUrl,
        inputSha256,
      });
      if (!rows.some((row) => row.transactionCode === "P")) continue;
      writeTextAtomic(path.join(cacheDir, `${filing.accessionNo}.xml`), xml);
      writeJsonAtomic(path.join(cacheDir, "transactions.json"), { schemaVersion: 1, qaOnly: true, transactions: rows }, true);
      writeJsonAtomic(path.join(cacheDir, "manifest.json"), [{ accessionNo: filing.accessionNo, form: filing.form, filingDate: filing.filingDate, acceptanceDateTime: availableAt, periodOfReport: filing.reportDate, issuerCik: company.cik, ownerCik: rows[0]?.ownerCik ?? null, rptOwnerName: rows[0]?.rptOwnerName ?? null, sourceUrl, inputSha256, fetched: true, dead: false, failCount: 0 }], true);
      return rows;
    }
  }
  throw new Error(`No open-market purchase Form 4 found for QA issuer ${company.ticker}`);
}

function validateRows(rows: Form4Transaction[], label: string): string[] {
  const issues: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.availableAt < row.eventTs) issues.push(`${label}[${index}]: availableAt precedes eventTs`);
    if (row.valueUsd !== null && row.shares !== null && row.pricePerShare !== null && Math.abs(row.valueUsd - row.shares * row.pricePerShare) > 1e-6) {
      issues.push(`${label}[${index}]: valueUsd mismatch`);
    }
    if (row.transactionCode === "P" && row.equitySwapInvolved === false && form4ExclusionReason(row) !== null) issues.push(`${label}[${index}]: P purchase was excluded`);
    if (row.transactionCode !== "P" && form4ExclusionReason(row) === null) issues.push(`${label}[${index}]: non-P transaction was included`);
  }
  if (supersedeForm4Transactions([...rows, ...rows]).length !== supersedeForm4Transactions(rows).length) issues.push(`${label}: duplicate accession handling changed counts`);
  return issues;
}

const syntheticRows = parseForm4Xml(form4FixtureXml(), {
  accessionNo: "0000000000-26-000001",
  form: "4",
  availableAt: "2026-10-10 16:30:00",
  issuerCik: 50863,
  ticker: "INTC",
  periodOfReport: "2026-10-01",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000000000026000001/form4.xml",
  inputSha256: "fixture",
});
const issues = validateRows(syntheticRows, "synthetic");
const intcCached = readJsonFile<{ transactions?: Form4Transaction[] }>(path.join(root, "50863", "transactions.json"), {});
const intcRows = intcCached.transactions?.length ? intcCached.transactions : await fetchGolden({ cik: 50863, ticker: "INTC" });
issues.push(...validateRows(intcRows, "INTC"));
const golden = [{ cik: 50863, ticker: "INTC", rows: intcRows }];
for (const company of external) {
  const rows = await fetchGolden(company);
  golden.push({ ...company, rows });
  issues.push(...validateRows(rows, company.ticker));
}
if (!golden.some((company) => company.rows.some((row) => row.isDirector || row.isOfficer || row.isTenPercentOwner))) issues.push("Golden EDGAR: no owner role flags");
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: issues.length ? "failed" : "passed",
  strictQa,
  productionApply: false,
  synthetic: { transactions: syntheticRows.length, exclusions: Object.fromEntries(syntheticRows.slice(1).map((row) => [row.transactionCode, form4ExclusionReason(row)])), issues: validateRows(syntheticRows, "synthetic") },
  golden: golden.map((company) => ({
    ticker: company.ticker,
    qaOnly: true,
    accessions: [...new Set(company.rows.map((row) => row.accessionNo))],
    transactions: company.rows.length,
    sourceUrls: [...new Set(company.rows.map((row) => row.sourceUrl))],
  })),
  issues,
};
writeJsonAtomic(path.resolve("worker/.runs/form4-qa/summary.json"), summary, true);
console.log(JSON.stringify(summary, null, 2));
if (strictQa && issues.length) throw new Error(`Strict Form 4 QA failed with ${issues.length} issues`);
