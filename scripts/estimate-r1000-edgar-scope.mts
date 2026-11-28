import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statfsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFilingsDetailed } from "../worker/lib/edgar-listing";
import { listFilingDocs, SecHttpError } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { R1000_EDGAR_FORMS, R1000_EDGAR_FROM, r1000ScopeDocumentSizes, r1000ScopeFilings } from "../worker/lib/r1000-edgar-scope";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const universeFile = path.resolve(arg("--universe") ?? "worker/research-universe-r1000-current.json");
const universe = JSON.parse(readFileSync(universeFile, "utf8")) as { cik: number; ticker: string }[];
const universeSha256 = sha(readFileSync(universeFile));
const count = Number(arg("--companies") ?? 20);
if (!Number.isInteger(count) || count < 1 || count > universe.length) throw new Error("--companies must be a positive integer within the universe");
const sample = universe.slice(0, count);
const codeHash = sha([fileURLToPath(import.meta.url), "worker/lib/r1000-edgar-scope.ts"].map(file => readFileSync(path.resolve(file))).join("\0"));
const scope = { from: R1000_EDGAR_FROM, forms: R1000_EDGAR_FORMS, tickers: sample.map(row => row.ticker) };
const resume = arg("--resume");
const root = path.resolve(resume ?? arg("--out") ?? `D:/research/alpha-engine/engine/r1000-scope-estimate/${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
mkdirSync(root, { recursive: true });
if (!/^d:/i.test(realpathSync(root))) throw new Error("The scope estimate must resolve to D:");
if (statfsSync(realpathSync(root)).bavail * statfsSync(realpathSync(root)).bsize < 15 * 1024 ** 3) throw new Error("Less than 15 GiB free on the estimate drive");
const runFile = path.join(root, "run.json");
let manifest: any = {
  schemaVersion: 1, status: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pid: process.pid,
  universeFile, universeSha256, universeCompanies: universe.length, scope, codeHash, companies: [], documentDownloads: 0,
};
if (resume) {
  const previous = JSON.parse(readFileSync(runFile, "utf8"));
  if (previous.schemaVersion !== 1 || previous.universeSha256 !== universeSha256 || previous.codeHash !== codeHash || JSON.stringify(previous.scope) !== JSON.stringify(scope)) throw new Error("Resume inputs or estimator code differ");
  manifest = { ...previous, status: "running", pid: process.pid, updatedAt: new Date().toISOString() };
}
mkdirSync(path.join(root, "companies"), { recursive: true });
const completed = new Set(manifest.companies.filter((row: any) => row.status === "complete").map((row: any) => row.cik));
let finished = false;
function saveSummary() {
  const latest = new Map<number, any>();
  for (const row of manifest.companies) latest.set(row.cik, row);
  const rows = [...latest.values()], done = rows.filter(row => row.status === "complete");
  const sum = (field: string) => rows.reduce((total, row) => total + (row.counts[field] ?? 0), 0);
  const byForm = Object.fromEntries(R1000_EDGAR_FORMS.map(form => [form, {
    filings: rows.reduce((total, row) => total + (row.counts.byForm[form]?.filings ?? 0), 0),
    primaryBytes: rows.reduce((total, row) => total + (row.counts.byForm[form]?.primaryBytes ?? 0), 0),
    optionalExhibitBytes: rows.reduce((total, row) => total + (row.counts.byForm[form]?.optionalExhibitBytes ?? 0), 0),
  }]));
  const eightK = rows.reduce((total, row) => total + row.counts.byForm["8-K"].filings + row.counts.byForm["8-K/A"].filings, 0);
  const projection = done.length ? {
    companies: universe.length,
    primaryBytes: Math.round(sum("primaryBytes") * universe.length / done.length),
    optionalExhibitBytes: Math.round(sum("optionalExhibitBytes") * universe.length / done.length),
    combinedBytes: Math.round((sum("primaryBytes") + sum("optionalExhibitBytes")) * universe.length / done.length),
    filings: Math.round(sum("filings") * universe.length / done.length),
    requests: Math.round((sum("filings") + 2 * eightK + 2 * done.length) * universe.length / done.length),
    secondsAtFourPerSecond: Math.round((sum("filings") + 2 * eightK + 2 * done.length) * universe.length / done.length / 4),
  } : null;
  if (projection) {
    projection.secondsWith25PercentHeadroom = Math.ceil(projection.secondsAtFourPerSecond * 1.25);
    projection.withinLimits = projection.combinedBytes <= 15 * 1024 ** 3 && projection.secondsWith25PercentHeadroom <= 8 * 3600;
  }
  manifest.updatedAt = new Date().toISOString();
  manifest.counts = {
    completeCompanies: done.length, partialCompanies: rows.length - done.length, pendingCompanies: sample.length - rows.length,
    filings: sum("filings"), primaryBytes: sum("primaryBytes"), optionalExhibitBytes: sum("optionalExhibitBytes"),
    missingNamedPrimaryDocuments: sum("missingPrimaryDocuments"), todo: rows.reduce((total, row) => total + row.todo.length, 0),
  };
  manifest.byForm = byForm;
  manifest.projection = projection;
  if (["running", "partial", "complete"].includes(manifest.status)) {
    const completeCiks = new Set(manifest.companies.filter((row: any) => row.status === "complete").map((row: any) => row.cik));
    manifest.status = completeCiks.size === sample.length ? "complete" : "partial";
  }
  manifest.go = manifest.status === "complete" && projection?.withinLimits === true;
  writeJsonAtomic(runFile, manifest, true);
}
process.once("exit", () => {
  if (!finished) {
    manifest.status = "interrupted";
    saveSummary();
  }
});
saveSummary();
try {
  for (const company of sample) {
    if (completed.has(company.cik)) {
      const checkpoint = manifest.companies.find((row: any) => row.cik === company.cik && row.status === "complete");
      if (sha(readFileSync(checkpoint.file)) !== checkpoint.sha256) throw new Error(`Checkpoint hash differs for ${company.ticker}`);
      console.log(`[scope-estimate] ${company.ticker} resumed`);
      continue;
    }
    const todo: { accessionNo?: string; stage: string; error: string }[] = [];
    let filings: any[] = [], documents: Record<string, any[]> = {};
    try {
      filings = r1000ScopeFilings(await listFilingsDetailed(company.cik));
    } catch (error) {
      todo.push({ stage: "submissions", error: String(error).slice(0, 400) });
    }
    for (const filing of filings) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          documents[filing.accessionNo] = await listFilingDocs(company.cik, filing.accessionNo);
          break;
        } catch (error) {
          if (error instanceof SecHttpError && error.status === 404 || attempt === 1) todo.push({ accessionNo: filing.accessionNo, stage: "index", error: String(error).slice(0, 400) });
        }
      }
    }
    const counts = r1000ScopeDocumentSizes(filings, new Map(Object.entries(documents)));
    const result = { schemaVersion: 1, company, scope, counts, filings, documents, todo, documentDownloads: 0 };
    const file = path.join(root, "companies", `${company.cik}-${Date.now()}.json`);
    writeJsonAtomic(file, result, true);
    manifest.companies.push({ cik: company.cik, ticker: company.ticker, status: todo.length ? "partial" : "complete", file, sha256: sha(readFileSync(file)), counts: { ...counts, missingPrimaryDocuments: counts.missingPrimaryDocuments.length }, todo });
    manifest.status = manifest.companies.filter((row: any, index: number, rows: any[]) => rows.findIndex(other => other.cik === row.cik) === index && row.status === "complete").length === sample.length ? "complete" : "partial";
    saveSummary();
    console.log(`[scope-estimate] ${company.ticker} [${manifest.counts.completeCompanies + manifest.counts.partialCompanies}/${sample.length}]: ${counts.filings} filings, ${counts.primaryBytes} primary bytes, ${todo.length} todo`);
  }
  finished = true;
  saveSummary();
  console.log(JSON.stringify({ status: manifest.status, go: manifest.go, runFile, counts: manifest.counts, projection: manifest.projection }, null, 1));
} catch (error) {
  finished = true;
  manifest.status = "failed";
  manifest.error = String(error).slice(0, 500);
  saveSummary();
  throw error;
}
