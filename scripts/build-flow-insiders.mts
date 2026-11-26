/**
 * The insiders of the money map (owner, 2026-11-26: "go ahead with the famous people data"): per quarter, the people
 * who bought or sold their own company's shares on the open market, largest first, from the insider standard (i1.1 in
 * alpha_research, read only).
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
import "dotenv/config";
import path from "node:path";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const from = arg("--from") ?? "2020-04-01", top = Number(arg("--top") ?? 80);
const { researchDb } = await import("file:///C:/dev/alpha-engine-lab/src/research-db.mts");
const db = await researchDb();

const [builds] = await db.query("SELECT buildVersion FROM std_insider_builds WHERE status = 'final' ORDER BY buildVersion DESC LIMIT 1") as [{ buildVersion: string }[], unknown];
const version = builds[0]?.buildVersion;
if (!version) throw new Error("No final insider build in alpha_research");

interface Line { accessionNo: string; issuerCik: number; groupId: string; transactionDate: string; code: string; shares: number; price: number; valueUsd: number; directOrIndirect: string | null; flags: string | null }
const [lines] = await db.query(
  `SELECT accessionNo, issuerCik, groupId, DATE_FORMAT(transactionDate, '%Y-%m-%d') transactionDate, code, shares, price, valueUsd, directOrIndirect, flags
     FROM std_insider_transactions
    WHERE buildVersion = ? AND code IN ('P', 'S') AND derivative = 0 AND duplicateOf IS NULL AND transactionDate >= ? AND valueUsd > 0`,
  [version, from],
) as [Line[], unknown];
const [owners] = await db.query(
  `SELECT accessionNo, groupId, ownerCik, ownerName, director, officer, officerTitle FROM std_insider_owners WHERE buildVersion = ? AND filingDate >= ?`,
  [version, from],
) as [{ accessionNo: string; groupId: string; ownerCik: number; ownerName: string; director: number; officer: number; officerTitle: string | null }[], unknown];
await db.end();

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
writeJsonAtomic(out, { schemaVersion: 1, builtAt: new Date().toISOString(), insiderBuild: version, from, top, lines: lines.length, kept: kept.length, countedOnce: twice, quarters });
console.log(`insiders: build ${version}, ${lines.length} open-market lines since ${from}, ${clean.length} after flags, ${twice} counted once as the same trade, ${Object.keys(quarters).length} quarters -> ${out}`);
process.exit(0);
