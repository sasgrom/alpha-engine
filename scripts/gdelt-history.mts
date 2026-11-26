/**
 * GDELT tone history for the tone test (owner, 2026-11-26: "test gdelt tone"). Research tool, static files only.
 *
 *   npx tsx scripts/gdelt-history.mts --from 2019-08-01 --to 2026-11-25 [--every 8] [--workers 4] [--limit N]
 *
 * A fixed sample of the 15-minute GKG files: on day d, the slots k (0..95) with k % every == d % every, so the times of
 * day rotate and one article in `every` is read. Each file is checked against the size and MD5 of GDELT's
 * masterfilelist.txt (stored beside the output), read, and only compact rows of the articles naming a company of our
 * index are kept; the zip itself is not kept (the owner's 30-day rule is for the live raw files; the full history is
 * about 1.5 TB). Output in D:/research/alpha-engine/news/gdelt-history:
 * - rows/<YYYY-MM>.jsonl: { t: GDELT time, c: [cik...], tone, pos, neg, words, src } one per article;
 * - done.txt: one line per finished slot (stamp, records, matched, bytes), so a stop resumes where it left off;
 * - failed.txt: slots that failed twice (stamp, reason).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { GDELT_BASE, parseGkg } from "../worker/lib/gdelt-gkg";
import { CompanyIndex, type CompanyEntry } from "../worker/lib/news-companies";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const root = "D:/research/alpha-engine/news/gdelt-history";
const from = arg("--from") ?? "2019-08-01", to = arg("--to") ?? "2026-11-25";
const every = Number(arg("--every") ?? 8), workers = Number(arg("--workers") ?? 4), limit = Number(arg("--limit") ?? Infinity);
if (!existsSync(path.join(root, "masterfilelist.txt"))) throw new Error(`No masterfilelist.txt in ${root} (the D: drive may be away)`);

const master = new Map<string, { size: number; md5: string }>();
for (const line of readFileSync(path.join(root, "masterfilelist.txt"), "utf8").split("\n")) {
  const [size, md5, url] = line.trim().split(/\s+/);
  const stamp = url?.match(/\/(\d{14})\.gkg\.csv\.zip$/)?.[1];
  if (stamp) master.set(stamp, { size: Number(size), md5 });
}
const done = new Set(existsSync(path.join(root, "done.txt")) ? readFileSync(path.join(root, "done.txt"), "utf8").split("\n").map(line => line.split("\t")[0]).filter(Boolean) : []);

const slots: string[] = [];
for (let day = Date.parse(`${from}T00:00:00Z`); day <= Date.parse(`${to}T00:00:00Z`); day += 86_400_000) {
  const dayNumber = Math.round(day / 86_400_000);
  for (let k = dayNumber % every; k < 96; k += every) {
    const stamp = new Date(day + k * 15 * 60_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    if (master.has(stamp) && !done.has(stamp)) slots.push(stamp);
  }
}
const queue = slots.slice(0, limit);

const entries = (JSON.parse(readFileSync("D:/research/alpha-engine/news/lookup/company-index.json", "utf8")) as { entries: CompanyEntry[] }).entries;
const index = new CompanyIndex(entries);
const resolved = new Map<string, number | null>();
const cikOf = (organization: string) => {
  // bounded: years of organization names would otherwise fill the memory (2026-11-26: 22 GB with this unbounded)
  if (resolved.size > 300_000) resolved.clear();
  if (!resolved.has(organization)) resolved.set(organization, organization.length >= 3 ? index.resolve(organization)?.cik ?? null : null);
  return resolved.get(organization)!;
};
// the zips and their text are large buffers outside the heap; with several downloads at once the collector runs too
// rarely for them, so it is asked to run every few files (start with NODE_OPTIONS=--expose-gc)
const collect = (globalThis as { gc?: () => void }).gc;

mkdirSync(path.join(root, "rows"), { recursive: true });
let finished = 0, bytes = 0, matched = 0;
const started = Date.now();
async function one(stamp: string): Promise<void> {
  const expected = master.get(stamp)!;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${GDELT_BASE}${stamp}.gkg.csv.zip`, { headers: { "User-Agent": "research-client/1.0" }, signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length !== expected.size || createHash("md5").update(body).digest("hex") !== expected.md5) throw new Error("size or MD5 differs from masterfilelist");
      const csv = Object.values(unzipSync(new Uint8Array(body)))[0];
      const records = parseGkg(Buffer.from(csv).toString("utf8"));
      const lines: string[] = [];
      for (const record of records) {
        const ciks = [...new Set(record.organizations.map(cikOf).filter((cik): cik is number => cik !== null))];
        if (!ciks.length) continue;
        lines.push(JSON.stringify({ t: record.gdeltAt, c: ciks, tone: record.tone, pos: record.positive, neg: record.negative, words: record.words, src: record.source }));
      }
      const month = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}`;
      if (lines.length) appendFileSync(path.join(root, "rows", `${month}.jsonl`), lines.join("\n") + "\n");
      appendFileSync(path.join(root, "done.txt"), `${stamp}\t${records.length}\t${lines.length}\t${body.length}\n`);
      finished++; bytes += body.length; matched += lines.length;
      if (collect && finished % 4 === 0) collect();
      return;
    } catch (error) {
      lastError = (error as Error).message;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  appendFileSync(path.join(root, "failed.txt"), `${stamp}\t${lastError}\n`);
}

let next = 0;
const report = setInterval(() => {
  const seconds = (Date.now() - started) / 1000;
  console.log(`${new Date().toISOString()} ${finished}/${queue.length} files · ${(bytes / 1e9).toFixed(2)} GB · ${(bytes / 1e6 / seconds).toFixed(1)} MB/s · ${matched} rows · memory ${(process.memoryUsage().rss / 1e9).toFixed(1)} GB · eta ${((queue.length - finished) * seconds / Math.max(finished, 1) / 3600).toFixed(1)} h`);
}, 60_000);
await Promise.all(Array.from({ length: workers }, async () => { while (next < queue.length) await one(queue[next++]); }));
clearInterval(report);
console.log(`done ${finished}/${queue.length} files, ${(bytes / 1e9).toFixed(2)} GB, ${matched} rows, ${((Date.now() - started) / 60000).toFixed(1)} min`);
