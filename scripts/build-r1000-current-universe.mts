import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { secGet } from "../worker/lib/edgar";
import { collectR1000SecurityTypes } from "../worker/r1000-security-types.mts";
import type { R1000SecurityType } from "../worker/lib/r1000-security-types";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { buildR1000CurrentUniverse, compareR1000Universe, gateR1000CurrentUniverse, type R1000CurrentUniverseRow } from "../worker/lib/r1000-current-universe";

const root = "D:/research/alpha-engine/index-membership/russell1000";
const workerFile = path.resolve("worker/research-universe-r1000-current.json");
const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const day = new Date().toISOString().slice(0, 10);
const exchangeFile = path.join(root, `k27-company_tickers_exchange-${day}.json`);
if (!existsSync(exchangeFile)) {
  const body = Buffer.from(await (await secGet("https://www.sec.gov/files/company_tickers_exchange.json")).arrayBuffer());
  const temporary = `${exchangeFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, body, { flag: "wx" });
    renameSync(temporary, exchangeFile);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const membership = read<any>(path.join(root, "membership.json"));
const newestQuarter = Object.keys(membership.quarters).sort().at(-1);
const members = membership.quarters[newestQuarter].members as any[];
const companies = read<any>(path.join(root, "companies.json")).companies as any[];
const registry = read<any[]>(path.resolve("worker/edgar-universe.json"));
const exchangeBody = read<any>(exchangeFile);
const exchangeRows = exchangeBody.data.map((values: any[]) => Object.fromEntries(exchangeBody.fields.map((field: string, index: number) => [field, values[index]])));
const previous = existsSync(workerFile) ? read<R1000CurrentUniverseRow[]>(workerFile) : [];
const previousQuarter = previous.filter(row => row.reason === "member").map(row => row.lastQuarter).sort().at(-1);
const optionIndex = process.argv.indexOf("--security-types");
const securityFile = path.resolve(optionIndex >= 0 ? process.argv[optionIndex + 1] : await collectR1000SecurityTypes());
const securityDocument = read<{ schemaVersion: number; rows: R1000SecurityType[] }>(securityFile);
if (securityDocument.schemaVersion !== 1 || !Array.isArray(securityDocument.rows)) throw new Error("Invalid Russell security-type evidence");
const securityTypes = securityDocument.rows;
const build = buildR1000CurrentUniverse({
  companies,
  memberCiks: new Set(members.map(row => row.cik)),
  registryCiks: new Set(registry.map(row => row.cik)),
  exchangeRows,
  securityTypes,
});
const comparison = compareR1000Universe(previous, build.rows);
const newQuarterArrived = Boolean(previousQuarter && previousQuarter !== newestQuarter);
const gates = gateR1000CurrentUniverse({ rows: build.rows, exchangeRows, securityTypes, previous, newQuarterArrived });
const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
const outputRoot = path.join(root, "current-universe");
const evidenceFile = path.join(outputRoot, `${stamp}.json`);
const reviewFile = path.join(outputRoot, `${stamp}-review.json`);
const step = Math.max(1, Math.floor(build.rows.length / 10));
const review = build.rows.filter((_, index) => index % step === 0).slice(0, 10).map((row, index) => ({
  reviewNumber: index + 1,
  checked: false,
  ...row,
  membershipEvidence: row.reason === "member" ? { quarter: newestQuarter, file: path.join(root, "membership.json") } : { quarter: row.lastQuarter, file: path.join(root, "companies.json") },
  exchangeEvidence: { file: exchangeFile, listings: exchangeRows.filter((exchange: any) => exchange.cik === row.cik) },
  securityTypeEvidence: { file: securityFile, rows: securityTypes.filter(security => row.tickers.includes(security.ticker)) },
}));
const baseEvidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    newestQuarter,
    previousQuarter: previousQuarter ?? null,
    newQuarterArrived,
    files: {
      membership: { file: path.join(root, "membership.json"), sha256: hash(path.join(root, "membership.json")) },
      companies: { file: path.join(root, "companies.json"), sha256: hash(path.join(root, "companies.json")) },
      registry: { file: path.resolve("worker/edgar-universe.json"), sha256: hash(path.resolve("worker/edgar-universe.json")) },
      exchange: { file: exchangeFile, sha256: hash(exchangeFile) },
      securityTypes: { file: securityFile, sha256: hash(securityFile) },
    },
  },
  counts: {
    companies: build.rows.length,
    member: build.rows.filter(row => row.reason === "member").length,
    formerListed: build.rows.filter(row => row.reason === "former-listed").length,
    excluded: build.excluded.length,
    excludedTickers: build.excludedTickers.length,
    joiners: comparison.joiners.length,
    leavers: comparison.leavers.length,
  },
  joiners: comparison.joiners,
  leavers: comparison.leavers,
  excluded: build.excluded,
  excludedTickers: build.excludedTickers,
  gates,
  rows: build.rows,
  reviewFile,
  productionWrite: false,
  databaseWrite: false,
};
writeJsonAtomic(reviewFile, { schemaVersion: 1, rows: review }, true);
if (!gates.pass) {
  writeJsonAtomic(evidenceFile, { ...baseEvidence, workerFile, workerWritten: false }, true);
  throw new Error(`K35 universe gates failed: ${JSON.stringify(gates)}`);
}
writeJsonAtomic(workerFile, build.rows, true);
writeJsonAtomic(evidenceFile, { ...baseEvidence, workerFile, workerSha256: hash(workerFile), workerWritten: true }, true);
console.log(JSON.stringify({ workerFile, evidenceFile, reviewFile, counts: baseEvidence.counts, newQuarterArrived, gates }, null, 1));
