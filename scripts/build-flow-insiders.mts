/**
 * The insiders of the money map (owner, 2026-11-26: "go ahead with the famous people data"): per quarter, the people
 * who bought or sold their own company's shares on the open market, largest first, from the insider standard's
 * published build (D:/research/alpha-engine/insiders/std/current.json, read only; refreshed every night).
 *
 *   npx tsx scripts/build-flow-insiders.mts [--from 2020-04-01] [--top 80]
 *
 * Rules (docs/engine/STANDARD_INSIDERS.md and its consumer rules): open-market purchases (P) and sales (S) of
 * non-derivative shares only; lines flagged price_outlier or equity_swap and lines marked as duplicates are left out;
 * a line is capped at $20 billion; a trade that a related owner reports again under another group on the same day,
 * shares and price is counted once when either line is held indirectly. A group is named after its officer (else its
 * director, else its first owner). Quarters are calendar quarters of the trade date, as the 13F flows use.
 * Output worker/.runs/desk-flows/insiders.json, read by desk.flowsInsiders.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const from = arg("--from") ?? "2020-04-01", top = Number(arg("--top") ?? 80);

// the published build of the insider standard, as files (the nightly gated refresh writes them; the research database
// gets the same build only on Sundays): one line per filing with its owners and transactions, per company
const STD = "D:/research/alpha-engine/insiders/std";
const pointerFile = path.join(STD, "current.json");
if (!existsSync(pointerFile) || !/^d:/i.test(realpathSync(STD))) throw new Error(`No published insider standard at ${STD} (the D: drive may be away); nothing was written`);
const pointer = JSON.parse(readFileSync(pointerFile, "utf8")) as { dir: string; buildVersion: string };
const version = pointer.buildVersion;
const companiesDir = path.join(pointer.dir, "companies");

interface Line { accessionNo: string; issuerCik: number; groupId: string; transactionDate: string; code: string; shares: number; price: number; valueUsd: number; directOrIndirect: string | null; flags: string | null }
interface OwnerRow { accessionNo: string; groupId: string; ownerCik: number; ownerName: string; director: boolean; officer: boolean; officerTitle: string | null }
const lines: Line[] = [];
const owners: OwnerRow[] = [];
// a line that does not read is counted and named, never guessed at (2026-11-26: one flipped bit in Humana's file of
// the 2026-11-25 build turned a quote into "#")
const damaged: { file: string; line: number }[] = [];
for (const name of readdirSync(companiesDir).filter((file) => file.endsWith(".jsonl"))) {
  let number = 0;
  for await (const text of createInterface({ input: createReadStream(path.join(companiesDir, name), "utf8"), crlfDelay: Infinity })) {
    number++;
    if (!text) continue;
    let record: { filing: { filingDate: string }; owners: OwnerRow[]; transactions: (Omit<Line, "flags"> & { derivative: boolean; duplicateOf: string | null; flags: string[] | null })[] };
    try { record = JSON.parse(text); } catch { damaged.push({ file: name, line: number }); continue; }
    if (record.filing.filingDate < from) continue;
    owners.push(...record.owners);
    for (const line of record.transactions) {
      if ((line.code !== "P" && line.code !== "S") || line.derivative || line.duplicateOf || !(line.valueUsd > 0) || line.transactionDate < from) continue;
      lines.push({ ...line, flags: (line.flags ?? []).join(",") });
    }
  }
}

// the person a group stands for, per filing: its officer, else its director, else its first owner
const lead = new Map<string, { cik: number; name: string; title: string | null }>();
for (const owner of owners) {
  const key = `${owner.accessionNo}|${owner.groupId}`;
  const rank = owner.officer ? 2 : owner.director ? 1 : 0;
  const current = lead.get(key) as ({ rank: number } & { cik: number; name: string; title: string | null }) | undefined;
  if (!current || rank > current.rank) lead.set(key, { cik: Number(owner.ownerCik), name: owner.ownerName, title: owner.officerTitle ?? (owner.director ? "Director" : null), rank } as never);
}

const clean = lines.filter((line) => !/price_outlier|equity_swap/.test(line.flags ?? ""));
// related owners reporting one trade under two groups: count it once when either side is indirect
const seen = new Map<string, Line>();
const kept: Line[] = [];
let twice = 0;
for (const line of clean) {
  const key = `${line.issuerCik}|${line.transactionDate}|${line.code}|${line.shares}|${line.price}`;
  const other = seen.get(key);
  if (other && other.groupId !== line.groupId && (other.directOrIndirect === "I" || line.directOrIndirect === "I")) { twice++; continue; }
  seen.set(key, line);
  kept.push(line);
}

const quarterEnd = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  const q = Math.ceil(m / 3) * 3;
  return `${y}-${String(q).padStart(2, "0")}-${q === 6 || q === 9 ? "30" : "31"}`;
};
type Row = { person: number; name: string; title: string | null; cik: number; bought: number; sold: number; lines: number };
const byQuarter = new Map<string, Map<string, Row>>();
for (const line of kept) {
  const who = lead.get(`${line.accessionNo}|${line.groupId}`);
  if (!who) continue;
  const quarter = quarterEnd(line.transactionDate);
  const rows = byQuarter.get(quarter) ?? new Map<string, Row>();
  byQuarter.set(quarter, rows);
  const key = `${who.cik}|${line.issuerCik}`;
  const row = rows.get(key) ?? { person: who.cik, name: who.name, title: who.title, cik: Number(line.issuerCik), bought: 0, sold: 0, lines: 0 };
  const value = Math.min(Number(line.valueUsd), 2e10);
  if (line.code === "P") row.bought += value; else row.sold += value;
  row.lines++;
  rows.set(key, row);
}

const quarters: Record<string, Row[]> = {};
for (const [quarter, rows] of [...byQuarter].sort()) {
  quarters[quarter] = [...rows.values()].sort((a, b) => b.bought + b.sold - (a.bought + a.sold)).slice(0, top)
    .map((row) => ({ ...row, bought: Math.round(row.bought), sold: Math.round(row.sold) }));
}
const out = path.resolve("worker/.runs/desk-flows/insiders.json");
writeJsonAtomic(out, { schemaVersion: 1, builtAt: new Date().toISOString(), insiderBuild: version, from, top, lines: lines.length, kept: kept.length, countedOnce: twice, damagedLines: damaged, quarters });
console.log(`insiders: build ${version}, ${lines.length} open-market lines since ${from}, ${clean.length} after flags, ${twice} counted once as the same trade, ${Object.keys(quarters).length} quarters${damaged.length ? ` · ${damaged.length} DAMAGED LINES left out: ${damaged.slice(0, 5).map((entry) => `${entry.file}:${entry.line}`).join(", ")}` : ""} -> ${out}`);
process.exit(0);
