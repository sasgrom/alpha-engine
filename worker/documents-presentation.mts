import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { loadEdgarUniverse } from "./lib/edgar";
import { registerLocalDocument, snapshotDocument, unpackDocumentSnapshot, type PresentationFiling } from "./lib/document-presentation";
import { postDocumentsSnapshot } from "./lib/ingest";

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1]?.toUpperCase() : null;
const push = process.argv.includes("--push") && !process.argv.includes("--dry");
const universeFile = process.argv.includes("--universe") ? process.argv[process.argv.indexOf("--universe") + 1] : "research-universe-50.json";
const universe = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const db = getDb();
const outputRoot = path.resolve("worker/.runs/local-generated");
mkdirSync(outputRoot, { recursive: true });
const snapshotRows = [];
const companyResults = [];
const errors: string[] = [];

for (const company of universe) {
  const result: Record<string, unknown> = { ...company, selectedFilings: 0, registeredDocuments: 0, missing: [] };
  const missing: string[] = [];
  try {
    const manifestPath = path.resolve("worker/cache/edgar", String(company.cik), "manifest.json");
    if (!existsSync(manifestPath) && !only) {
      missing.push("manifest.json");
      result.missing = missing;
      errors.push(`${company.ticker}: manifest missing`);
      companyResults.push(result);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as any[];
    const selected = manifest
      .filter((row) => row.form === "10-K" && row.fetched && row.primaryDoc && row.docName)
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate))
      .slice(0, 5);
    result.selectedFilings = selected.length;
    if (!selected.length) {
      missing.push("10-K cache");
      errors.push(`${company.ticker}: no cached 10-K primary document`);
    }
    for (const row of selected) {
      const filing: PresentationFiling = {
        cik: company.cik,
        accessionNo: row.accessionNo,
        form: "10-K",
        filingDate: row.filingDate,
        reportDate: row.reportDate || null,
        primaryDoc: row.primaryDoc,
      };
      const rawPath = path.resolve("worker/cache/edgar", String(company.cik), `${row.accessionNo.replaceAll("-", "")}.htm`);
      if (!existsSync(rawPath)) {
        missing.push(row.accessionNo);
        errors.push(`${company.ticker}/${row.accessionNo}: raw cache missing`);
        continue;
      }
      const document = snapshotDocument(filing, readFileSync(rawPath));
      unpackDocumentSnapshot(document);
      await registerLocalDocument(db, document);
      snapshotRows.push(document);
      result.registeredDocuments = Number(result.registeredDocuments) + 1;
    }
  } catch (error) {
    errors.push(`${company.ticker}: ${String(error)}`);
  }
  result.missing = missing;
  companyResults.push(result);
}

const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "local-edgar-cache",
  rows: snapshotRows,
};
const snapshotBytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
const snapshotPath = path.join(outputRoot, "documents-snapshot.json");
writeFileSync(snapshotPath, snapshotBytes);
const snapshotSha256 = createHash("sha256").update(snapshotBytes).digest("hex");
const validation = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: errors.length || snapshotRows.length === 0 ? "fail" : "pass",
  mode: push ? "push" : "dry",
  source: "local-edgar-cache",
  productionApply: false,
  companies: companyResults,
  filingsSelected: companyResults.reduce((sum, row) => sum + Number(row.selectedFilings), 0),
  documentsSelected: snapshotRows.length,
  snapshotBytes: snapshotBytes.length,
  snapshotSha256,
  errors,
};
writeFileSync(path.join(outputRoot, "documents-snapshot-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "documents-local-report.json"), `${JSON.stringify({ ...validation, snapshot: undefined }, null, 2)}\n`);
console.log(JSON.stringify({ status: validation.status, mode: validation.mode, companies: companyResults.length, filingsSelected: validation.filingsSelected, documentsSelected: validation.documentsSelected, snapshotBytes: validation.snapshotBytes, snapshotSha256, errors }, null, 2));
if (errors.length || !snapshotRows.length) throw new Error("Local document registration failed; production push is forbidden");
if (push) {
  let upserted = 0;
  for (const row of snapshotRows) upserted += (await postDocumentsSnapshot(row)).upserted;
  console.log(JSON.stringify({ mode: "push", upserted }, null, 2));
}
await db.$client.end();
