/**
 * GDELT GKG collector, every 15 minutes (Claude's attempt; owner's permission of 2026-11-25, AGENTS.md section 3).
 *
 *   npx tsx worker/gdelt-gkg.mts [--max-files 8] [--dry-run]
 *
 * Static files only (worker/lib/gdelt-gkg.ts), never GDELT's query API. Each run reads lastupdate.txt, then fetches the
 * GKG files of the 15-minute slots since the last one stored, oldest first, at most --max-files a run (so a stop is
 * caught up a few runs later), one request every 2 seconds, a generic client name. The newest file is checked against
 * the size and MD5 that lastupdate.txt states; every file must open as a zip.
 *
 * Archive D:/research/alpha-engine/news/gdelt:
 * - raw/<UTC date>/<stamp>.gkg.csv.zip, as received, never rewritten, kept 30 days (owner, 2026-11-26);
 * - records/<UTC date of the slot>.jsonl, one row per article that names a company of our index (organizations resolved
 *   with the news reader's CompanyIndex), with our first-seen time, GDELT's time, title, tone, organizations and themes;
 * - state.json: the last slot stored, slots that answered 404 (asked twice more on later runs, then listed as gone).
 * Not yet fed to the reader or the desk: measured first (handoff 263).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { buildIndex, companiesOf, GDELT_BASE, parseGkg, parseLastUpdate, slotsBetween, stampIso } from "./lib/gdelt-gkg";
import type { CompanyEntry } from "./lib/news-companies";
import { writeJsonAtomic } from "./lib/json-file";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const news = path.resolve("D:/research/alpha-engine/news");
const root = path.join(news, "gdelt");
const maxFiles = Number(arg("--max-files") ?? 8), dryRun = process.argv.includes("--dry-run");
if (!existsSync(path.join(news, "lookup"))) throw new Error(`The news archive is not at ${news} (the D: drive may be away); nothing was fetched`);
if (!/^d:/i.test(realpathSync(news))) throw new Error("The news archive must resolve to D:");
if (!(maxFiles >= 1 && maxFiles <= 96)) throw new Error("--max-files must be 1 to 96");

interface State { lastStamp: string | null; missing: Record<string, number>; gone: string[]; files: number; records: number; updatedAt: string | null; prunedThrough?: string }
const RAW_KEEP_DAYS = 30;
const stateFile = path.join(root, "state.json");
mkdirSync(root, { recursive: true });
// a stop between storing a file and saving the state reads that file again on the next run: records are then repeated
// (same GDELT id), never lost; readers keep one row per id
const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { lastStamp: null, missing: {}, gone: [], files: 0, records: 0, updatedAt: null };

const UA = "research-client/1.0";
let requests = 0;
async function get(url: string): Promise<Response> {
  if (requests++ > 0) await new Promise(resolve => setTimeout(resolve, 2000));
  return fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
}

const indexFile = path.join(news, "lookup", "company-index.json");
const entries = (JSON.parse(readFileSync(indexFile, "utf8")) as { entries: CompanyEntry[] }).entries;
const index = buildIndex(entries);
const followedFile = path.join(news, "lookup", "followed.json");
const followed = new Set<number>(existsSync(followedFile) ? (JSON.parse(readFileSync(followedFile, "utf8")) as { ciks: number[] }).ciks : []);

const lastUpdate = await get(`${GDELT_BASE}lastupdate.txt`);
if (!lastUpdate.ok) throw new Error(`GDELT lastupdate.txt answered HTTP ${lastUpdate.status}`);
const latest = parseLastUpdate(await lastUpdate.text());
if (!latest) throw new Error("GDELT lastupdate.txt names no GKG file");

const due = state.lastStamp ? slotsBetween(state.lastStamp, latest.stamp) : [latest.stamp];
const retries = Object.keys(state.missing).sort();
const queue = [...retries, ...due.filter(stamp => !retries.includes(stamp))].slice(0, maxFiles);
if (dryRun) {
  console.log(JSON.stringify({ latest: latest.stamp, lastStored: state.lastStamp, due: due.length, retries: retries.length, wouldFetch: queue }));
  process.exit(0);
}

const counts = { files: 0, notThere: 0, records: 0, matched: 0, followed: 0, skipped: 0 };
/** One file that failed: tried again on the next two runs, then left in todo.jsonl for a later pass. */
function skip(stamp: string, error: string) {
  counts.skipped++;
  const tries = (state.missing[stamp] ?? 0) + 1;
  if (tries >= 3) {
    delete state.missing[stamp];
    state.gone.push(stamp);
    appendFileSync(path.join(root, "todo.jsonl"), JSON.stringify({ stamp, url: `${GDELT_BASE}${stamp}.gkg.csv.zip`, error, attempts: tries, at: new Date().toISOString() }) + "\n");
  } else state.missing[stamp] = tries;
  if (!state.lastStamp || stamp > state.lastStamp) state.lastStamp = stamp;
  writeJsonAtomic(stateFile, state);
}
for (const stamp of queue) {
  const day = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const rawFile = path.join(root, "raw", day, `${stamp}.gkg.csv.zip`);
  let body: Buffer;
  if (existsSync(rawFile)) body = readFileSync(rawFile);
  else {
    const response = await get(`${GDELT_BASE}${stamp}.gkg.csv.zip`);
    if (response.status === 404) {
      counts.notThere++;
      // lastupdate.txt can name a file a few minutes before it can be fetched (seen 2026-11-26): a 404 counts as a try
      // only once the slot is three hours old
      const young = Date.now() - Date.parse(stampIso(stamp)) < 3 * 3_600_000;
      const tries = (state.missing[stamp] ?? 0) + (young ? 0 : 1);
      if (tries >= 3) { delete state.missing[stamp]; state.gone.push(stamp); } else state.missing[stamp] = tries;
      if (!state.lastStamp || stamp > state.lastStamp) state.lastStamp = stamp;
      writeJsonAtomic(stateFile, state);
      continue;
    }
    // being refused (403, 429) is the only network answer that stops the run; anything else on one file is that file's
    // problem (owner, 2026-11-26: "skip problem co, should never be a stop issue, just record after 2 re try and move on")
    if (response.status === 403 || response.status === 429) throw new Error(`GDELT refused the request (HTTP ${response.status}); stopped, the next run resumes`);
    if (!response.ok) { skip(stamp, `HTTP ${response.status}`); continue; }
    body = Buffer.from(await response.arrayBuffer());
    if (stamp === latest.stamp && (body.length !== latest.size || createHash("md5").update(body).digest("hex") !== latest.md5)) { skip(stamp, "size or MD5 differs from lastupdate.txt"); continue; }
    mkdirSync(path.dirname(rawFile), { recursive: true });
    writeFileSync(rawFile, body, { flag: "wx" });
  }
  let csv: Uint8Array | undefined;
  try { csv = Object.values(unzipSync(new Uint8Array(body)))[0]; } catch (error) { skip(stamp, `unreadable zip: ${String((error as Error).message).slice(0, 80)}`); continue; }
  if (!csv) { skip(stamp, "the zip holds no file"); continue; }
  const records = parseGkg(Buffer.from(csv).toString("utf8"));
  const firstSeenAt = new Date().toISOString();
  const lines: string[] = [];
  for (const record of records) {
    const companies = companiesOf(record, index);
    if (!companies.length) continue;
    counts.matched++;
    if (companies.some(company => followed.has(company.cik))) counts.followed++;
    lines.push(JSON.stringify({ slot: stampIso(stamp), firstSeenAt, ...record, companies }));
  }
  mkdirSync(path.join(root, "records"), { recursive: true });
  if (lines.length) appendFileSync(path.join(root, "records", `${day}.jsonl`), lines.join("\n") + "\n");
  delete state.missing[stamp];
  if (!state.lastStamp || stamp > state.lastStamp) state.lastStamp = stamp;
  state.files++; state.records += lines.length;
  counts.files++; counts.records += records.length;
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(stateFile, state);                 // after every file: a stop loses nothing already stored
}
state.updatedAt = new Date().toISOString();
writeJsonAtomic(stateFile, state);
// raw files are kept 30 days (owner, 2026-11-26: "keep raw gdelt files 30 days"); the records stay. Only dated
// folders directly under raw/ are removed, and only when raw/ resolves to the archive on D:.
const rawRoot = path.join(root, "raw");
const keepFrom = new Date(Date.now() - RAW_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
const pruned: string[] = [];
if (existsSync(rawRoot) && /^d:\\research\\alpha-engine\\news\\gdelt\\raw$/i.test(realpathSync(rawRoot)))
  for (const name of readdirSync(rawRoot)) if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < keepFrom) { rmSync(path.join(rawRoot, name), { recursive: true }); pruned.push(name); }
if (pruned.length) { state.prunedThrough = pruned.sort().at(-1)!; writeJsonAtomic(stateFile, state); }
console.log(JSON.stringify({ latest: latest.stamp, pruned: pruned.length, lastStored: state.lastStamp, behind: slotsBetween(state.lastStamp!, latest.stamp).length, ...counts, missing: Object.keys(state.missing).length, gone: state.gone.length, requests }));
