/** 4l hotfix: purge stale factors:/value: cache rows (pre-detail payloads). */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const r: any = await db.execute(
  sql`DELETE FROM external_cache WHERE \`key\` LIKE 'factors:%' OR \`key\` LIKE 'value:%'`
);
console.log("stale cache rows deleted:", r[0]?.affectedRows ?? "?");
process.exit(0);
