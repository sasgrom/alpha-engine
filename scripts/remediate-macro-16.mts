import { readFileSync } from "node:fs";
import { inArray, sql } from "drizzle-orm";
import { macroPoints } from "../db/schema";
import { getDb } from "../api/queries/connection";

export function macro16Rows(file = "research/reviewed-sync/2026-11-10/macro-delete-backup.json") {
  const backup = JSON.parse(readFileSync(file, "utf8"));
  const rows = backup.rows.filter((row: any) => row.id >= 463333 && row.id <= 463348).sort((a: any, b: any) => a.id - b.id);
  if (rows.length !== 16 || rows.some((row: any) => ["CPIAUCSL", "FEDFUNDS"].includes(row.seriesId) || row.fetchedAt !== "2026-11-07T01:23:41.000Z" && !row.fetchedAt.startsWith("2026-11-07T01:23:4"))) {
    throw new Error("Expected exactly the 16 reviewed 2026-11-07 macro rows");
  }
  return rows;
}

export async function applyMacro16Remediation(db: any) {
  const rows = macro16Rows();
  const [existing]: any = await db.execute(sql`SELECT id, seriesId, date, value, realtimeStart, realtimeEnd, sourceHash, fetchedAt FROM macro_points WHERE id IN (${sql.join(rows.map((row: any) => sql`${row.id}`), sql`, `)})`);
  if (existing.length && existing.length !== rows.length) throw new Error("Macro 16 remediation found partial existing rows");
  if (existing.length === rows.length) {
    const byId = new Map(existing.map((row: any) => [Number(row.id), row]));
    for (const row of rows) {
      const current: any = byId.get(row.id);
      if (!current || current.seriesId !== row.seriesId || current.value !== row.value || current.sourceHash !== row.sourceHash) throw new Error(`Existing macro row conflicts with backup: ${row.id}`);
    }
    return { status: "complete", inserted: 0, dupes: 16, productionApply: false };
  }
  const [before]: any = await db.execute(sql`SELECT COUNT(*) AS rowsTotal FROM macro_points`);
  await db.transaction(async (tx: any) => {
    await tx.insert(macroPoints).values(rows.map((row: any) => ({
      id: row.id,
      seriesId: row.seriesId,
      date: row.date.slice(0, 10),
      value: row.value,
      realtimeStart: row.realtimeStart.slice(0, 10),
      realtimeEnd: row.realtimeEnd?.slice(0, 10) ?? null,
      sourceHash: row.sourceHash,
      fetchedAt: new Date(row.fetchedAt),
    })));
  });
  const [after]: any = await db.execute(sql`SELECT COUNT(*) AS rowsTotal FROM macro_points`);
  if (Number(after[0].rowsTotal) !== Number(before[0].rowsTotal) + rows.length) throw new Error("Macro 16 post-check count mismatch");
  return { status: "complete", inserted: 16, dupes: 0, before: Number(before[0].rowsTotal), after: Number(after[0].rowsTotal), productionApply: false };
}

if (process.argv[1]?.endsWith("remediate-macro-16.mts")) {
  const db = getDb();
  try {
    if (!process.argv.includes("--apply")) console.log(JSON.stringify({ status: "dry-run", rows: macro16Rows().length, ids: macro16Rows().map((row: any) => row.id), productionApply: false }, null, 2));
    else console.log(JSON.stringify(await applyMacro16Remediation(db), null, 2));
  } finally {
    await db.$client.end();
  }
}
