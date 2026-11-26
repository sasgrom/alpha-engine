/**
 * Senate eFD public PTR archive. In-memory statutory agreement, 3-second pacing, resumable raw HTML/PDF/image checkpoints.
 * Usage: npx tsx worker/congress-senate.mts [--discover|--index-only] [--limit N]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { parseSenateSearchRows, senateScannedImageUrls, type SenateSearchReport } from "./lib/congress";
import { readCollectorTodo, withCollectorRetries } from "./lib/collector-todo";
import { csrfToken, OfficialSiteClient } from "./lib/congress-http";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const discover = process.argv.includes("--discover");
const indexOnly = process.argv.includes("--index-only");
const limit = arg("--limit") === null ? Number.POSITIVE_INFINITY : Number(arg("--limit"));
if (!(limit > 0)) throw new Error("--limit must be positive");
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/people/congress/senate");
if (!/^d:/i.test(realpathSync(path.parse(root).root))) throw new Error("Senate raw archive must resolve to D:");
mkdirSync(path.join(root, "search"), { recursive: true });
mkdirSync(path.join(root, "reports"), { recursive: true });
const client = new OfficialSiteClient("Senate eFD", fetch, 3000);
const prog = startProgress("congress-senate", `${root} · 3 s/request${discover ? " · discovery" : indexOnly ? " · index only" : ""}`);
const todoFile = path.join(root, "senate-todo.jsonl");
const sha256 = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

function writeRaw(file: string, body: Buffer): void {
  if (existsSync(file)) throw new Error(`Refusing to overwrite raw Senate file ${file}`);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, body, { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function stored(file: string, url: string, fetchedAt: string) {
  const body = readFileSync(file);
  return { file: path.basename(file), url, bytes: body.length, sha256: sha256(body), fetchedAt };
}
function matches(file: string, hash: string | undefined): boolean {
  return existsSync(file) && statSync(file).size > 0 && (!hash || sha256(readFileSync(file)) === hash);
}
function imagesMatch(report: ReportCheckpoint): boolean {
  return (report.images ?? []).every(image => matches(path.join(root, "images", report.reportId, image.file), image.sha256));
}

const homeUrl = "https://efdsearch.senate.gov/search/home/";
const searchManifestFile = path.join(root, "search", "manifest.json");
let search = "";
let sessionRenewals = 0;
async function renewSession(): Promise<void> {
  const home = (await client.body(homeUrl)).toString("utf8");
  const token = csrfToken(home);
  const body = await client.body(homeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: homeUrl },
    body: new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: token }).toString(),
  });
  search = body.toString("utf8");
  if (!/report|search/i.test(search) || /id=["']agreement_form["']/i.test(search)) throw new Error("Senate agreement was not accepted");
  sessionRenewals++;
  const file = path.join(root, "search", `search-${runStamp}-${sessionRenewals}.html`);
  writeRaw(file, body);
  writeJsonAtomic(searchManifestFile, {
    schemaVersion: 1,
    source: "https://efdsearch.senate.gov/search/",
    firstSeenAt: existsSync(searchManifestFile) ? JSON.parse(readFileSync(searchManifestFile, "utf8")).firstSeenAt : new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    ...stored(file, "https://efdsearch.senate.gov/search/", new Date().toISOString()),
    requests: client.requests,
    agreementAccepted: true,
    sessionRenewals,
  }, true);
  prog.log(`Senate session ${sessionRenewals === 1 ? "established" : "renewed after a transport error"}`);
}
await renewSession();
if (discover) {
  prog.done("Senate discovery complete");
  process.exit(0);
}

const dataUrl = "https://efdsearch.senate.gov/search/report/data/";
const indexManifestFile = path.join(root, "search", "ptr-index.json");
const previousIndex = existsSync(indexManifestFile) ? JSON.parse(readFileSync(indexManifestFile, "utf8")) as { reports?: (SenateSearchReport & { firstSeenAt: string })[] } : null;
const firstSeen = new Map(previousIndex?.reports?.map(row => [row.reportId, row.firstSeenAt]) ?? []);
const found = new Map<string, SenateSearchReport>();
const pages: unknown[] = [];
let start = 0;
let filtered = Number.POSITIVE_INFINITY;
while (start < filtered) {
  const parameters = new URLSearchParams({
    draw: String(start / 100 + 1), start: String(start), length: "100", "order[0][column]": "1", "order[0][dir]": "asc",
    report_types: "[11]", filer_types: "[]", submitted_start_date: "", submitted_end_date: "", candidate_state: "", senator_state: "", office_id: "", first_name: "", last_name: "",
    csrfmiddlewaretoken: csrfToken(search),
  });
  const answer = await client.body(dataUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://efdsearch.senate.gov/search/" },
    body: parameters.toString(),
  });
  const parsed = JSON.parse(answer.toString("utf8")) as { recordsTotal?: number; recordsFiltered?: number; data?: unknown[] };
  if (!Array.isArray(parsed.data) || !Number.isInteger(parsed.recordsFiltered)) throw new Error("Senate report search returned no DataTables result");
  filtered = parsed.recordsFiltered!;
  for (const report of parseSenateSearchRows(parsed.data)) {
    const previous = found.get(report.reportId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(report)) throw new Error(`Senate PTR ${report.reportId} changed during pagination`);
    found.set(report.reportId, report);
  }
  const answerFile = path.join(root, "search", `ptr-all-${start}-${runStamp}.json`);
  writeRaw(answerFile, answer);
  pages.push({ ...stored(answerFile, dataUrl, new Date().toISOString()), start, recordsTotal: parsed.recordsTotal, recordsFiltered: parsed.recordsFiltered });
  start += 100;
  if (!parsed.data.length && start < filtered) throw new Error("Senate pagination returned an empty intermediate page");
  prog.log(`Senate index ${Math.min(start, filtered)}/${filtered}`);
}
const reports = [...found.values()].map(report => ({ ...report, firstSeenAt: firstSeen.get(report.reportId) ?? new Date().toISOString() }));
writeJsonAtomic(indexManifestFile, { schemaVersion: 1, generatedAt: new Date().toISOString(), source: dataUrl, recordsFiltered: filtered, pages, reports }, true);
if (reports.length > filtered) throw new Error(`Senate index says ${filtered} rows, collected ${reports.length} unique reports`);
prog.stage(`${filtered} Senate PTR rows · ${reports.length} unique reports indexed`);
if (indexOnly) {
  prog.done(`Senate index complete: ${reports.length} PTRs`);
  process.exit(0);
}

interface ReportCheckpoint extends SenateSearchReport {
  status: "electronic" | "scanned" | "resumed" | "pending" | "failed";
  firstSeenAt: string;
  html: ReturnType<typeof stored> | null;
  pdf: ReturnType<typeof stored> | null;
  images?: ReturnType<typeof stored>[];
  error: string | null;
}
type IndexedReport = SenateSearchReport & { firstSeenAt: string };
const reportManifestFile = path.join(root, "reports", "manifest.json");
const previousReports: ReportCheckpoint[] = existsSync(reportManifestFile) ? JSON.parse(readFileSync(reportManifestFile, "utf8")).reports : [];
const oldById = new Map(previousReports.map(row => [row.reportId, row]));

async function collectReport(report: IndexedReport, old?: ReportCheckpoint): Promise<ReportCheckpoint> {
  const htmlFile = path.join(root, "reports", `${report.reportId}.html`);
  const pdfFile = path.join(root, "reports", `${report.reportId}.pdf`);
  const checkpoint: ReportCheckpoint = { ...report, status: "failed", firstSeenAt: old?.firstSeenAt ?? report.firstSeenAt, html: null, pdf: null, images: [], error: null };
  const body = existsSync(htmlFile) ? readFileSync(htmlFile) : existsSync(pdfFile) ? readFileSync(pdfFile) : await client.body(report.sourceUrl);
  if (body.subarray(0, 5).toString("ascii") === "%PDF-") {
    if (!existsSync(pdfFile)) writeRaw(pdfFile, body);
    checkpoint.pdf = stored(pdfFile, report.sourceUrl, old?.pdf?.fetchedAt ?? new Date().toISOString());
    checkpoint.status = "scanned";
    return checkpoint;
  }
  if (!existsSync(htmlFile)) writeRaw(htmlFile, body);
  checkpoint.html = stored(htmlFile, report.sourceUrl, old?.html?.fetchedAt ?? new Date().toISOString());
  const html = body.toString("utf8");
  const document = new JSDOM(html).window.document;
  const electronic = [...document.querySelectorAll("table")].some(table => {
    const headers = [...table.querySelectorAll("thead th")].map(node => (node.textContent ?? "").toLowerCase());
    return headers.some(header => header.includes("amount")) && headers.some(header => header.includes("asset"));
  });
  if (electronic) {
    checkpoint.status = "electronic";
    return checkpoint;
  }
  const imageUrls = senateScannedImageUrls(html);
  if (imageUrls.length) {
    const directory = path.join(root, "images", report.reportId);
    mkdirSync(directory, { recursive: true });
    for (const [index, url] of imageUrls.entries()) {
      const extension = path.extname(new URL(url).pathname).toLowerCase();
      const file = path.join(directory, `${String(index + 1).padStart(4, "0")}${extension || ".gif"}`);
      const image = existsSync(file) ? readFileSync(file) : await client.body(url);
      const valid = image.subarray(0, 4).toString("ascii") === "GIF8" || image.subarray(0, 4).toString("hex") === "89504e47" || image.subarray(0, 2).toString("hex") === "ffd8";
      if (!valid) throw new Error("Senate scanned page is not a supported image");
      if (!existsSync(file)) writeRaw(file, image);
      checkpoint.images!.push(stored(file, url, new Date().toISOString()));
    }
    checkpoint.status = "scanned";
    return checkpoint;
  }
  const link = [...document.querySelectorAll("a[href],iframe[src]")].map(node => node.getAttribute("href") ?? node.getAttribute("src") ?? "").find(value => /\.pdf(?:\?|$)|\/paper\//i.test(value))
    ?? html.match(/["']([^"']*(?:\.pdf(?:\?|$)|\/paper\/)[^"']*)["']/i)?.[1];
  if (!link) throw new Error("Senate report has neither an electronic transaction table, scanned page images nor a PDF link");
  const pdfUrl = new URL(link.replaceAll("&amp;", "&"), report.sourceUrl).href;
  const pdf = existsSync(pdfFile) ? readFileSync(pdfFile) : await client.body(pdfUrl);
  if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Senate linked document is not a PDF");
  if (!existsSync(pdfFile)) writeRaw(pdfFile, pdf);
  checkpoint.pdf = stored(pdfFile, pdfUrl, old?.pdf?.fetchedAt ?? new Date().toISOString());
  checkpoint.status = "scanned";
  return checkpoint;
}

async function collectWithRetries(report: IndexedReport, old: ReportCheckpoint | undefined, attempts: number) {
  let renewed = false;
  let transportAfterRenewal = 0;
  const result = await withCollectorRetries({
    operation: async () => {
      try {
        return await collectReport(report, old);
      } catch (error) {
        if (/Senate eFD request (?:TypeError|TimeoutError)/.test(String(error))) {
          if (!renewed) {
            renewed = true;
            await renewSession();
          } else transportAfterRenewal++;
        }
        throw error;
      }
    },
    todoFile,
    item: { reportId: report.reportId, document: report.sourceKind, url: report.sourceUrl },
    attempts,
  });
  return { ...result, renewed, transportAfterRenewal };
}

const checkpoints: ReportCheckpoint[] = [];
let completedThisRun = 0;
let transportStreak = 0;
for (const [index, report] of reports.entries()) {
  const old = oldById.get(report.reportId);
  const htmlFile = path.join(root, "reports", `${report.reportId}.html`);
  const pdfFile = path.join(root, "reports", `${report.reportId}.pdf`);
  if (old && ["electronic", "scanned", "resumed"].includes(old.status) && ((old.sourceKind === "paper" && !old.html ? old.images?.length ? true : matches(pdfFile, old.pdf?.sha256) : matches(htmlFile, old.html?.sha256)) && imagesMatch(old) && (!old.pdf || matches(pdfFile, old.pdf.sha256)))) {
    checkpoints.push({ ...old, status: "resumed" });
  } else if (completedThisRun < limit && statfsSync(path.parse(root).root).bavail * statfsSync(path.parse(root).root).bsize >= 20 * 1024 ** 3) {
    const attempted = await collectWithRetries(report, old, 3);
    if (attempted.value) {
      checkpoints.push(attempted.value);
      completedThisRun++;
      transportStreak = 0;
    } else {
      checkpoints.push({ ...report, status: "failed", html: null, pdf: null, error: attempted.error });
      transportStreak = attempted.transportAfterRenewal ? transportStreak + 1 : 0;
    }
  } else {
    checkpoints.push({ ...report, status: "pending", html: null, pdf: null, error: completedThisRun >= limit ? "Not attempted: run limit reached" : "Not attempted: less than 20 GiB free on D:" });
  }
  const outstanding = reports.slice(index + 1).map(current => oldById.get(current.reportId) ?? { ...current, status: "pending" as const, html: null, pdf: null, error: "Not attempted: run stopped" });
  writeJsonAtomic(reportManifestFile, { schemaVersion: 1, updatedAt: new Date().toISOString(), reports: [...checkpoints, ...outstanding] }, true);
  prog.item(index + 1, reports.length, `${report.reportId} ${checkpoints.at(-1)!.status}`);
  if (transportStreak >= 3) throw new Error("Stopped after three consecutive Senate transport failures");
}

const pending = readCollectorTodo(todoFile);
let postFetchResolved = 0;
for (const item of pending) {
  const report = reports.find(row => row.reportId === item.reportId) ?? oldById.get(item.reportId);
  if (!report) throw new Error(`Senate todo report ${item.reportId} has no current or prior identity`);
  const attempted = await collectWithRetries(report, oldById.get(report.reportId), 2);
  const position = checkpoints.findIndex(row => row.reportId === report.reportId);
  const checkpoint = attempted.value ?? { ...report, status: "failed" as const, html: null, pdf: null, error: attempted.error };
  if (position < 0) checkpoints.push(checkpoint);
  else checkpoints[position] = checkpoint;
  if (attempted.value) postFetchResolved++;
  writeJsonAtomic(reportManifestFile, { schemaVersion: 1, updatedAt: new Date().toISOString(), reports: checkpoints }, true);
  transportStreak = attempted.transportAfterRenewal ? transportStreak + 1 : 0;
  if (transportStreak >= 3) throw new Error("Stopped after three consecutive Senate post-fetch transport failures");
}
const currentIds = new Set(reports.map(row => row.reportId));
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  requests: client.requests,
  sessionRenewals,
  reports: checkpoints.length,
  currentIndexReports: reports.length,
  outsideCurrentIndex: checkpoints.filter(row => !currentIds.has(row.reportId)).length,
  electronic: checkpoints.filter(row => row.status === "electronic" || row.status === "resumed" && row.html && !row.pdf && !row.images?.length).length,
  scanned: checkpoints.filter(row => row.status === "scanned" || row.status === "resumed" && (row.pdf || row.images?.length)).length,
  pending: checkpoints.filter(row => row.status === "pending").length,
  failed: checkpoints.filter(row => row.status === "failed").length,
  completedThisRun,
  todo: { file: todoFile, attempted: pending.length, resolved: postFetchResolved, remaining: readCollectorTodo(todoFile).length, attemptsPerItem: 2 },
};
writeJsonAtomic(path.join(root, "summary.json"), summary, true);
prog.done(`${reports.length} Senate PTRs · ${summary.electronic} electronic · ${summary.scanned} scanned · ${summary.failed} failed · post-pass ${postFetchResolved}/${pending.length} resolved`);
if (summary.failed) process.exitCode = 1;
