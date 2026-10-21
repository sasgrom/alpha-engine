/** Find the job run that zeroed AAPL facts (4e review probe 5). */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const j: any = await db.execute(sql`
  SELECT l.jobId, j.type, j.status, j.createdAt, j.startedBy, l.level, l.message
  FROM job_logs l JOIN jobs j ON j.id = l.jobId
  WHERE l.message LIKE '%320193%' OR l.message LIKE '%AAPL%'
  ORDER BY l.id DESC LIMIT 25`);
for (const r of j[0]) console.log(`job#${r.jobId} ${r.type} ${r.status} ${String(r.createdAt).slice(0, 16)} by=${r.startedBy} · ${String(r.message).slice(0, 140)}`);
process.exit(0);
