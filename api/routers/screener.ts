/**
 * events router: the materialized 8-K Item 2.02 earnings stream of one company, point-in-time by construction.
 * The classic screener's cached table and its refresh went with the classic view on 2026-11-24.
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { events } from "@db/schema";

export const eventsRouter = createRouter({
  /** Earnings events of one company, newest first. */
  byCompany: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const db = getDb();
    return db.select().from(events).where(eq(events.cik, input.cik)).orderBy(desc(events.eventDate)).limit(200);
  }),
});
