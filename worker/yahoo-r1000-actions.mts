import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchYahooActions } from "./lib/yahoo-r1000-actions";
import { writeJsonAtomic } from "./lib/json-file";

const universeFile = path.resolve("worker/research-universe-r1000-current.json");
const universe = JSON.parse(readFileSync(universeFile, "utf8")) as Array<{ cik: number; ticker: string; tickers?: string[] }>;
const tickers = [...new Set(universe.flatMap(company => company.tickers ?? [company.ticker]))].sort();
const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
const output = path.join("D:/research/alpha-engine/prices/yahoo", `r1000-actions-${stamp}`);
const endYear = new Date().getUTCFullYear() + 1;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
mkdirSync(output, { recursive: true });
const results = [], todo = [], files = [];
let requests = 0;
for (const [index, ticker] of tickers.entries()) {
  const file = path.join(output, `${ticker}.json`);
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8");
    results.push({ ticker, status: "resumed", sha256: hash(raw) });
    files.push({ file, bytes: Buffer.byteLength(raw), sha256: hash(raw) });
    continue;
  }
  const answer = await fetchYahooActions(ticker, endYear, fetch, wait);
  requests += answer.attempts;
  if (answer.raw) {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, answer.raw, { flag: "wx" });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    const sha256 = hash(answer.raw);
    results.push({ ticker, status: "ok", attempts: answer.attempts, sha256 });
    files.push({ file, bytes: Buffer.byteLength(answer.raw), sha256 });
  } else {
    const row = { ticker, attempts: answer.attempts, error: answer.error, at: new Date().toISOString() };
    results.push({ ticker, status: "todo", ...row });
    todo.push(row);
  }
  writeJsonAtomic(path.join(output, "manifest.json"), {
    schemaVersion: 1, generatedAt: new Date().toISOString(), universeFile, endYear, requests,
    counts: { tickers: tickers.length, attempted: index + 1, ok: results.filter(row => row.status === "ok").length,
              resumed: results.filter(row => row.status === "resumed").length, todo: todo.length },
    results, files, todoFile: path.join(output, "todo.jsonl"), productionWrite: false, databaseWrite: false,
  }, true);
  const temporary = `${path.join(output, "todo.jsonl")}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, todo.map(row => JSON.stringify(row)).join("\n") + (todo.length ? "\n" : ""));
    renameSync(temporary, path.join(output, "todo.jsonl"));
  } finally {
    rmSync(temporary, { force: true });
  }
  if (index + 1 < tickers.length) await wait(1500);
}
console.log(JSON.stringify({ output, requests, counts: { tickers: tickers.length, ok: results.filter(row => row.status === "ok").length,
  resumed: results.filter(row => row.status === "resumed").length, todo: todo.length } }, null, 1));
