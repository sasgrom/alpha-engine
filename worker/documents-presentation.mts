import "dotenv/config";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { loadEdgarUniverse } from "./lib/edgar";
import { exhibitCacheName } from "./lib/exhibits";
import { metadataDocument, registerLocalDocuments, snapshotDocument, unpackDocumentSnapshot, PRESENTATION_FORMS, type PresentationFiling } from "./lib/document-presentation";
import { postDocumentsSnapshot } from "./lib/ingest";

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1]?.toUpperCase() : null;
const push = process.argv.includes("--push") && !process.argv.includes("--dry");
const modeIndex = process.argv.indexOf("--mode");
const metadataOnly = modeIndex >= 0 && process.argv[modeIndex + 1] === "metadata-only";
if (push && !metadataOnly) throw new Error("Refusing documentsSnapshot push without --mode metadata-only");
const universeFile = process.argv.includes("--universe") ? process.argv[process.argv.indexOf("--universe") + 1] : "research-universe-50.json";
const universe = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const db = getDb();
const outputRoot = path.resolve("worker/.runs/local-generated");
mkdirSync(outputRoot, { recursive: true });
const snapshotPath = path.join(outputRoot, "documents-snapshot.json");
const generatedAt = new Date().toISOString();
const snapshotHash = createHash("sha256");
const appendSnapshot = (text: string) => {
  snapshotHash.update(text);
  appendFileSync(snapshotPath, text);
};
const snapshotHeader = `{"schemaVersion":1,"generatedAt":${JSON.stringify(generatedAt)},"source":"local-edgar-cache","rows":[\n`;
writeFileSync(snapshotPath, snapshotHeader);
snapshotHash.update(snapshotHeader);
const companyResults = [];
const errors: string[] = [];
const exactKeys = new Set<string>();
const snapshotRows = push ? [] : null;
const formCounts = Object.fromEntries(PRESENTATION_FORMS.map((form) => [form, 0]));
const roleCounts = { primary: 0, exhibit: 0, other: 0 };
let documentsSelected = 0;
let rawBytes = 0;
let compressedBytes = 0;
let plaintextBytes = 0;

for (const company of universe) {
  const result: Record<string, unknown> = { ...company, selectedFilings: 0, registeredDocuments: 0, formCounts: {}, roleCounts: { primary: 0, exhibit: 0, other: 0 }, missing: [] };
  const companyDocuments = [];
  const missing: string[] = [];
  const registerRaw = async (filing: PresentationFiling, rawPath: string, options: { docName?: string; docType?: PresentationFiling["form"]; role?: "primary" | "exhibit" | "other" } = {}) => {
    if (!existsSync(rawPath)) {
      missing.push(`${filing.accessionNo}/${options.docName ?? filing.primaryDoc}`);
      errors.push(`${company.ticker}/${filing.accessionNo}/${options.docName ?? filing.primaryDoc}: raw cache missing`);
      return;
    }
    const exactKey = `${filing.cik}:${filing.accessionNo}:${options.docName ?? filing.primaryDoc}`;
    if (exactKeys.has(exactKey)) return;
    exactKeys.add(exactKey);
    const document = snapshotDocument(filing, readFileSync(rawPath), options);
    if (!document.textLength) throw new Error(`Empty plaintext for ${filing.accessionNo}/${document.docName}`);
    unpackDocumentSnapshot(document);
    companyDocuments.push(document);
    const transportDocument = metadataDocument(document);
    if (documentsSelected > 0) appendSnapshot(",\n");
    appendSnapshot(JSON.stringify(transportDocument));
    documentsSelected++;
    rawBytes += document.sizeBytes;
    compressedBytes += Buffer.byteLength(document.rawGzipBase64, "base64");
    plaintextBytes += Buffer.byteLength(document.plaintext, "utf8");
    formCounts[filing.form]++;
    roleCounts[document.role]++;
    const companyFormCounts = result.formCounts as Record<string, number>;
    companyFormCounts[filing.form] = (companyFormCounts[filing.form] ?? 0) + 1;
    const companyRoleCounts = result.roleCounts as Record<string, number>;
    companyRoleCounts[document.role]++;
    snapshotRows?.push(transportDocument);
    result.registeredDocuments = Number(result.registeredDocuments) + 1;
  };
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
      .filter((row) => PRESENTATION_FORMS.includes(row.form) && row.fetched && row.primaryDoc && row.docName)
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    result.selectedFilings = selected.length;
    if (!selected.length) {
      missing.push("document cache");
      errors.push(`${company.ticker}: no cached primary documents`);
    }
    for (const row of selected) {
      const filing: PresentationFiling = {
        cik: company.cik,
        accessionNo: row.accessionNo,
        form: row.form,
        filingDate: row.filingDate,
        reportDate: row.reportDate || null,
        primaryDoc: row.primaryDoc,
      };
      const base = row.accessionNo.replaceAll("-", "");
      await registerRaw(filing, path.resolve("worker/cache/edgar", String(company.cik), `${base}.htm`));
      if (row.exFile) await registerRaw(filing, path.resolve("worker/cache/edgar", String(company.cik), `${base}.ex.htm`), { docName: row.exFile, docType: row.form, role: "exhibit" });
      for (const exhibit of row.exhibitFiles ?? []) {
        const rawPath = path.resolve("worker/cache/edgar", String(company.cik), exhibitCacheName(row.accessionNo, exhibit.name));
        if (existsSync(rawPath)) {
          const raw = readFileSync(rawPath);
          const actualSha = createHash("sha256").update(raw).digest("hex");
          if (actualSha !== exhibit.sha256) throw new Error(`Cached exhibit SHA256 mismatch for ${company.ticker}/${row.accessionNo}/${exhibit.name}`);
          await registerRaw(filing, rawPath, { docName: exhibit.name, docType: row.form, role: "exhibit" });
        } else {
          missing.push(`${row.accessionNo}/${exhibit.name}`);
          errors.push(`${company.ticker}/${row.accessionNo}/${exhibit.name}: exhibit cache missing`);
        }
      }
    }
    await registerLocalDocuments(db, companyDocuments);
  } catch (error) {
    errors.push(`${company.ticker}: ${String(error)}`);
  }
  result.missing = missing;
  companyResults.push(result);
}
appendSnapshot("\n]}\n");
const snapshotBytes = statSync(snapshotPath).size;
const snapshotSha256 = snapshotHash.digest("hex");
const storageQuotaBytes = 30 * 1024 ** 3;
const storageRequiredBytes = rawBytes + plaintextBytes;
const storageQuotaSufficient = storageRequiredBytes <= storageQuotaBytes;
const validation = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: errors.length || documentsSelected === 0 || !storageQuotaSufficient ? "fail" : "pass",
  mode: push ? "metadata-only" : "dry",
  source: "local-edgar-cache",
  productionApply: false,
  coverageMatrix: companyResults,
  companies: companyResults.length,
  filingsSelected: companyResults.reduce((sum, row) => sum + Number(row.selectedFilings), 0),
  documentsSelected,
  formCounts,
  roleCounts,
  duplicateExactKeys: 0,
  rawBytes,
  compressedBytes,
  plaintextBytes,
  storageRequiredBytes,
  storageQuotaBytes,
  storageQuotaSufficient,
  snapshotBytes,
  snapshotSha256,
  errors,
};
writeFileSync(path.join(outputRoot, "documents-snapshot-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "documents-local-report.json"), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify({ status: validation.status, mode: validation.mode, companies: companyResults.length, filingsSelected: validation.filingsSelected, documentsSelected, formCounts, roleCounts, rawBytes, compressedBytes, plaintextBytes, storageRequiredBytes, storageQuotaSufficient, snapshotBytes, snapshotSha256, errors }, null, 2));
if (errors.length || !documentsSelected || !storageQuotaSufficient) throw new Error(`Local document registration failed; production push is forbidden. Required storage ${storageRequiredBytes} bytes`);
if (push) {
  let upserted = 0;
  for (let start = 0; start < snapshotRows!.length; start += 100) {
    upserted += (await postDocumentsSnapshot(snapshotRows!.slice(start, start + 100), { mode: "metadata-only" })).upserted;
  }
  console.log(JSON.stringify({ mode: "push", upserted }, null, 2));
}
await db.$client.end();
