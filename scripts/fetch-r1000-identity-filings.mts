import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { filingDocUrl, secGet } from "../worker/lib/edgar";

const root = "D:/research/alpha-engine/engine";
const outputRoot = path.join(root, "r1000-identity-filings");
const screen = JSON.parse(readFileSync(path.join(root, "r1000-jump-screen/20261127T050053Z/jumps-screen.json"), "utf8")) as any[];
const filings = new Map<string, { cik: number; accessionNo: string; kind: string }>();
for (const row of screen) {
  if (row.class !== "identity") continue;
  for (const evidence of row.identityEvidence) {
    filings.set(`${row.cik}/${evidence.accessionNo}`, { cik: row.cik, accessionNo: evidence.accessionNo, kind: evidence.kind });
  }
}
for (const row of [
  { cik: 842162, accessionNo: "0000950123-09-020118", kind: "bankruptcy 8-K" },
  { cik: 842162, accessionNo: "0000950123-09-020359", kind: "bankruptcy 8-K" },
  { cik: 842162, accessionNo: "0000950123-09-060340", kind: "relisting 8-K" },
  { cik: 1341766, accessionNo: "0001615774-16-008159", kind: "reporting resumption 10-Q" },
]) filings.set(`${row.cik}/${row.accessionNo}`, row);

function sha256(body: Buffer) {
  return createHash("sha256").update(body).digest("hex");
}
function evidence(file: string) {
  const body = readFileSync(file);
  return { file, bytes: body.length, sha256: sha256(body) };
}
function writeAtomic(file: string, body: Buffer | string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, body, { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function validCached(file: string, expected: { bytes: number; sha256: string }) {
  return existsSync(file) && statSync(file).size === expected.bytes && sha256(readFileSync(file)) === expected.sha256;
}

const results = [];
for (const filing of [...filings.values()].sort((a, b) => a.cik - b.cik || a.accessionNo.localeCompare(b.accessionNo))) {
  const directory = path.join(outputRoot, String(filing.cik), filing.accessionNo);
  const resultFile = path.join(directory, "evidence.json");
  if (existsSync(resultFile)) {
    const cached = JSON.parse(readFileSync(resultFile, "utf8"));
    const additional = cached.additionalDocuments ?? [];
    const complete = filing.kind !== "Form 25" || additional.length > 0;
    if (complete && validCached(cached.index.file, cached.index) && validCached(cached.document.file, cached.document)
      && additional.every((row: any) => validCached(row.file, row))) {
      results.push({ ...filing, ...cached, status: "cached" });
      continue;
    }
  }
  const manifestFile = path.resolve(`worker/cache/edgar/${filing.cik}/manifest.json`);
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) as any[] : [];
  const entry = manifest.find(row => row.accessionNo === filing.accessionNo);
  try {
    const accession = filing.accessionNo.replace(/-/g, "");
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${accession}/index.json`;
    const indexBody = Buffer.from(await (await secGet(indexUrl)).arrayBuffer());
    const index = JSON.parse(indexBody.toString("utf8"));
    const items = (index.directory?.item ?? []).map((row: any) => ({ name: String(row.name ?? ""), size: Number(String(row.size ?? "0").replace(/[^\d]/g, "")) || 0 }));
    const primary = items.find((row: any) => row.name === entry?.primaryDoc)
      ?? items.filter((row: any) => /\.(htm|txt)$/i.test(row.name) && !/^index/i.test(row.name)).sort((a: any, b: any) => b.size - a.size)[0];
    if (!primary) throw new Error(`No primary document in ${indexUrl}`);
    const documentUrl = filingDocUrl(filing.cik, filing.accessionNo, primary.name);
    const documentBody = Buffer.from(await (await secGet(documentUrl)).arrayBuffer());
    const indexFile = path.join(directory, "index.json");
    const documentFile = path.join(directory, primary.name);
    writeAtomic(indexFile, indexBody);
    writeAtomic(documentFile, documentBody);
    const requests = [
      { url: indexUrl, bytes: indexBody.length, sha256: sha256(indexBody) },
      { url: documentUrl, bytes: documentBody.length, sha256: sha256(documentBody) },
    ];
    const additionalDocuments = [];
    if (filing.kind === "Form 25" && primary.name !== "primary_doc.xml") {
      const xml = items.find((row: any) => row.name === "primary_doc.xml");
      if (!xml) throw new Error(`No primary_doc.xml in ${indexUrl}`);
      const url = filingDocUrl(filing.cik, filing.accessionNo, xml.name);
      const body = Buffer.from(await (await secGet(url)).arrayBuffer());
      const file = path.join(directory, xml.name);
      writeAtomic(file, body);
      requests.push({ url, bytes: body.length, sha256: sha256(body) });
      additionalDocuments.push(evidence(file));
    }
    const result = {
      schemaVersion: 2,
      fetchedAt: new Date().toISOString(),
      requests,
      index: evidence(indexFile),
      document: evidence(documentFile),
      primaryDocument: primary.name,
      additionalDocuments,
      productionWrite: false,
      databaseWrite: false,
    };
    writeAtomic(resultFile, `${JSON.stringify(result, null, 1)}\n`);
    results.push({ ...filing, ...result, status: "fetched" });
    console.log(JSON.stringify({ cik: filing.cik, accessionNo: filing.accessionNo, document: primary.name, bytes: documentBody.length, additional: additionalDocuments.length }));
  } catch (error) {
    results.push({ ...filing, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  filings: results.length,
  fetched: results.filter(row => row.status === "fetched").length,
  cached: results.filter(row => row.status === "cached").length,
  failed: results.filter(row => row.status === "failed").length,
  results,
  productionWrite: false,
  databaseWrite: false,
};
writeAtomic(path.join(outputRoot, "manifest.json"), `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify({ filings: summary.filings, fetched: summary.fetched, cached: summary.cached, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
