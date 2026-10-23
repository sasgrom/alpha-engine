/**
 * 5e — digests router: read side of the morning briefs written by the home
 * worker via the ingest contract (kind "digests").
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { digests } from "@db/schema";

export const digestsRouter = createRouter({
  /** latest brief of a kind (default: morning) */
  latest: authedQuery.input(z.object({ kind: z.string().max(24).default("morning") }).optional()).query(async ({ input }) => {
    const [row] = await getDb().select().from(digests)
      .where(eq(digests.kind, input?.kind ?? "morning"))
      .orderBy(desc(digests.forDate)).limit(1);
    return row ?? null;
  }),

  /** recent briefs list (bodies included — they are short) */
  list: authedQuery.input(z.object({ limit: z.number().int().min(1).max(30).default(14) }).optional()).query(async ({ input }) => {
    return getDb().select().from(digests).orderBy(desc(digests.forDate)).limit(input?.limit ?? 14);
  }),
});
