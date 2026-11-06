import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const db = getDb();
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const outputArg = process.argv.indexOf("--out");
const root = path.resolve("worker/.runs");
const output = path.resolve(outputArg >= 0 ? process.argv[outputArg + 1] : path.join(root, `cusip-map-ticker-text-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`));
if (!output.startsWith(`${root}${path.sep}`)) throw new Error("Backup must stay under worker/.runs");

try {
  const [rows]: any = await db.execute(sql`SELECT cusip, cik, ticker, exchCode, secType, mappedAt FROM cusip_map ORDER BY cusip`);
  const [createRows]: any = await db.execute(sql`SHOW CREATE TABLE cusip_map`);
  const createSql = String(createRows[0]?.["Create Table"] ?? "");
  if (!createSql) throw new Error("Could not fingerprint cusip_map");
  const [columns]: any = await db.execute(sql`SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cusip_map' AND COLUMN_NAME='ticker'`);
  mkdirSync(output, { recursive: true });
  const payload = `${JSON.stringify({ table: "cusip_map", rows }, null, 2)}\n`;
  const backupPath = path.join(output, "backup-cusip-map.json");
  writeFileSync(backupPath, payload);
  const backupBytes = readFileSync(backupPath);
  const manifest = {
    schemaVersion: 1,
    table: "cusip_map",
    createdAt: new Date().toISOString(),
    rowsTotal: rows.length,
    backupFile: "backup-cusip-map.json",
    byteSize: backupBytes.length,
    sha256: sha256(backupBytes),
    tableFingerprint: sha256(createSql),
    tickerColumn: columns[0],
    credentialMaterialIncluded: false,
  };
  writeFileSync(path.join(output, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ backupPath: output, ...manifest }, null, 2));
} finally {
  await db.$client.end();
}
