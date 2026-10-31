/**
 * Workers intake monitor (4p) — the CLOUD-side half of worker observability:
 * what actually landed in the signals table and which worker keys are alive.
 * Admin-only (owner verification surface), works on prod AND locally.
 */
import { desc, sql } from "drizzle-orm";
import { createRouter, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { workerKeys } from "@db/schema";

export const workersMonitorRouter = createRouter({
  intake: adminQuery.query(async () => {
    const db = getDb();
    const perSource: any[] = (
      await db.execute(sql`
        SELECT source,
               COUNT(*)                                  AS rows_total,
               MAX(eventTs)                              AS lastEventTs,
               MAX(ingestedAt)                           AS lastIngestedAt,
               SUM(src = 'backfill')                     AS backfillRows,
               SUM(src = 'live')                         AS liveRows
        FROM signals GROUP BY source ORDER BY source`)
    )[0] as unknown as any[];
    const recent: any[] = (
      await db.execute(sql`
        SELECT s.cik, c.ticker, s.source, s.signalType, s.eventTs, s.ingestedAt, s.score, s.magnitude, s.src, s.note, s.payloadKey
        FROM signals s LEFT JOIN companies c ON c.cik = s.cik
        ORDER BY s.id DESC LIMIT 20`)
    )[0] as unknown as any[];
    const keys = await db
      .select({ id: workerKeys.id, label: workerKeys.label, createdAt: workerKeys.createdAt, lastUsedAt: workerKeys.lastUsedAt, revokedAt: workerKeys.revokedAt })
      .from(workerKeys)
      .orderBy(desc(workerKeys.id));
    return { perSource, recent, keys };
  }),
});
