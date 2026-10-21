/**
 * Screener + events routers (iteration 4a, D28).
 *
 * screener.table serves the DB-cached universe metrics payload (D27 — built
 * once, served instantly; stale-while-revalidate keeps it fresh in the
 * background). screener.refresh is admin-only: a forced rebuild costs
 * per-company reads, so it is an owner op (billing/DB-honesty rule).
 *
 * events.byCompany / events.recent read the materialized 8-K Item 2.02
 * earnings stream — point-in-time by construction.
 */
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery, effectiveUserId } from "../middleware";
import { getDb } from "../queries/connection";
import { events, companies, externalCache, userUniverse } from "@db/schema";
import { getScreener, buildScreenerRows } from "../services/screener";

export const screenerRouter = createRouter({
  /**
   * Universe metrics table of the VIEWER's universe — DB-cached per user
   * (4c, D30/D27). 4e (D36): under an admin's view-as lens the caller reads
   * the VIEWED user's cached payload (built on demand if missing).
   */
  table: authedQuery.query(({ ctx }) => getScreener(effectiveUserId(ctx))),

  /** Force a rebuild of the CALLER's screener cache now (owner op). */
  refresh: adminQuery.mutation(async ({ ctx }) => {
    const rows = await buildScreenerRows(ctx.user.id);
    await getDb()
      .insert(externalCache)
      .values({ key: `screener:u${ctx.user.id}`, payload: JSON.stringify(rows), source: "live" })
      .onDuplicateKeyUpdate({
        set: { payload: sql`VALUES(\`payload\`)`, fetchedAt: sql`VALUES(\`fetchedAt\`)`, source: sql`VALUES(\`source\`)` },
      });
    return { rows: rows.length };
  }),
});

export const eventsRouter = createRouter({
  /** Earnings events of one company, newest first. */
  byCompany: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.cik, input.cik))
      .orderBy(desc(events.eventDate))
      .limit(200);
    return rows;
  }),

  /** Latest earnings events across the VIEWER's universe (4c, D30). */
  recent: authedQuery.input(z.object({ limit: z.number().min(1).max(100).default(20) })).query(async ({ input, ctx }) => {
    const db = getDb();
    return db
      .select({ ticker: companies.ticker, cik: events.cik, type: events.type, eventDate: events.eventDate, filingDate: events.filingDate, accessionNo: events.accessionNo })
      .from(events)
      .innerJoin(companies, eq(companies.cik, events.cik))
      .innerJoin(userUniverse, and(eq(userUniverse.cik, events.cik), eq(userUniverse.userId, effectiveUserId(ctx)), eq(userUniverse.active, true)))
      .orderBy(desc(events.eventDate))
      .limit(input.limit);
  }),
});
