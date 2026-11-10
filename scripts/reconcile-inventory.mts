/**
 * Canonical per-table inventory for local↔prod reconciliation.
 * Runs on either side with DATABASE_URL pointing at that side; prints the same
 * JSON shape so two outputs can be diffed mechanically. Read-only (SELECT only).
 * Content hash: sha256 over ordered rows (keyset by first PK column, 20k batches),
 * so identical tables on both sides yield identical hashes.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const DATE_CANDIDATES = ["filingDate", "date", "filed", "eventTs", "eventDate", "createdAt", "acceptanceDateTime"];

const TABLES: Array<{ table: string }> = [
  { table: "companies" },
  { table: "filings" },
  { table: "facts" },
  { table: "prices" },
  { table: "macro_points" },
  { table: "signals" },
  { table: "digests" },
  { table: "fund_holdings" },
  { table: "fund_quarters" },
  { table: "cusip_map" },
  { table: "documents" },
  { table: "events" },
  { table: "expectations_reviewed_packages" },
  { table: "expectations_reviewed_results" },
  { table: "reports" },
  { table: "external_cache" },
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required; never print or commit its value");
const conn = await mysql.createConnection({ uri: url, multipleStatements: false });
const sha256 = () => createHash("sha256");
const out: Record<string, unknown> = { schemaVersion: 1, generatedAt: new Date().toISOString(), side: process.env.INVENTORY_SIDE ?? "unknown", tables: {} };

for (const spec of TABLES) {
  const [exists]: any = await conn.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [spec.table]);
  if (!exists[0].n) { (out.tables as any)[spec.table] = { present: false }; continue; }
  const [cnt]: any = await conn.query(`SELECT COUNT(*) n FROM \`${spec.table}\``);
  const [pkCols]: any = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
    [spec.table],
  );
  if (!pkCols.length) { (out.tables as any)[spec.table] = { present: true, rows: cnt[0].n, skipped: "no primary key" }; continue; }
  const pks = pkCols.map((r: any) => r.COLUMN_NAME as string);
  const orderBy = pks.map((c) => `\`${c}\``).join(", ");
  const hash = sha256();
  let hashed = 0;
  let lastKey: unknown[] | null = null;
  for (;;) {
    let rows: any[];
    if (pks.length === 1) {
      const where = lastKey === null ? "" : ` WHERE \`${pks[0]}\` > ?`;
      [rows] = await conn.query(`SELECT * FROM \`${spec.table}\`${where} ORDER BY ${orderBy} LIMIT 20000`, lastKey === null ? [] : [lastKey[0]]) as any;
    } else {
      const offset = hashed;
      [rows] = await conn.query(`SELECT * FROM \`${spec.table}\` ORDER BY ${orderBy} LIMIT 20000 OFFSET ${offset}`) as any;
    }
    if (!rows.length) break;
    for (const row of rows) hash.update(JSON.stringify(row) + "\n");
    hashed += rows.length;
    lastKey = pks.map((c) => rows[rows.length - 1][c]);
    if (rows.length < 20000) break;
  }
  let maxDate: string | null = null;
  const [colRows]: any = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [spec.table]);
  const cols = new Set(colRows.map((r: any) => r.COLUMN_NAME));
  const dateCol = DATE_CANDIDATES.find((c) => cols.has(c));
  if (dateCol) {
    const [d]: any = await conn.query(`SELECT MAX(\`${dateCol}\`) m FROM \`${spec.table}\``);
    maxDate = d[0]?.m ? String(d[0].m) : null;
  }
  (out.tables as any)[spec.table] = { present: true, rows: cnt[0].n, contentSha256: hash.digest("hex"), hashedRows: hashed, maxDate };
  console.error(`[inventory] ${spec.table}: ${cnt[0].n} rows`);
}
mkdirSync(path.resolve("worker/.runs"), { recursive: true });
const file = path.resolve(`worker/.runs/inventory-${out.side}-${Date.now()}.json`);
createWriteStream(file).end(JSON.stringify(out, null, 2) + "\n");
console.log(file);
await conn.end();
