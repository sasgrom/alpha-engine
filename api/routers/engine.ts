import { z } from "zod";
import { and, eq, sql, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { DeskLatestFilings } from "@contracts/desk-company";
import { createRouter, authedQuery, effectiveUserId } from "../middleware";
import { getDb } from "../queries/connection";
import { companies, userUniverse } from "@db/schema";
import { latestWatchlistFilings, readDeskCompanyFile } from "../services/desk-company-files";
import { recordUniverseAction } from "../services/runner";
import { companyInDb, invalidateScreenerCache } from "../services/membership";
import { latestMacro } from "../services/macro";
import * as edgar from "../services/edgar";

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------
export const dashboardRouter = createRouter({

  /**
   * Latest filings of the VIEWER's universe (4c, D30 — the dashboard is a
   * personal world, not a global firehose). Empty universe → empty feed;
   * the page empty-state points at Universe to add tickers.
   */
  latestFilings: authedQuery.input(z.object({ limit: z.number().int().min(1).max(100).default(15) })).query(async ({ input, ctx }) => {
    const db = getDb();
    const myCiks = await db
      .select({ cik: userUniverse.cik })
      .from(userUniverse)
      .where(and(eq(userUniverse.userId, effectiveUserId(ctx)), eq(userUniverse.active, true)));
    if (myCiks.length === 0) return [];
    // The feed is read from the desk's own file (scripts/build-desk-company.mts: the release calendar and, after it,
    // the nightly SEC cache). The app's filings table is not read: nothing has filled it since 2026-11-05.
    return latestWatchlistFilings(readDeskCompanyFile<DeskLatestFilings>("filings-latest.json"), myCiks.map((row) => row.cik), input.limit);
  }),

  /** 4m (D46): the FRED regime pack's latest values — the Stage 4 seed card. */
  macro: authedQuery.query(() => latestMacro()),
});

// ---------------------------------------------------------------------------
// universe management
// ---------------------------------------------------------------------------
export const universeRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        search: z.string().default(""),
        onlyUniverse: z.boolean().default(false),
        page: z.number().default(0),
        pageSize: z.number().default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      // 4c (D30): the universe is PER-USER — the caller's memberships joined
      // with the shared registry. Companies whose auto-ingest is still queued
      // come back with inDb=false (honest placeholder, not a missing row).
      const conds = [eq(userUniverse.userId, effectiveUserId(ctx))];
      if (input.onlyUniverse) conds.push(eq(userUniverse.active, true));
      if (input.search.trim()) {
        const like = `%${input.search.trim()}%`;
        conds.push(
          sql`(${userUniverse.ticker} LIKE ${like} OR ${userUniverse.name} LIKE ${like} OR ${companies.name} LIKE ${like})`
        );
      }
      const where = and(...conds);
      const rows = await db
        .select({
          cik: userUniverse.cik,
          ticker: userUniverse.ticker,
          active: userUniverse.active,
          addedAt: userUniverse.createdAt,
          inDb: sql<boolean>`${companies.cik} IS NOT NULL`,
          name: sql<string | null>`COALESCE(${companies.name}, ${userUniverse.name})`,
          exchange: companies.exchange,
          sector: companies.sector,
          industry: companies.industry,
          sicDescription: companies.sicDescription,
          fiscalYearEnd: companies.fiscalYearEnd,
        })
        .from(userUniverse)
        .leftJoin(companies, eq(userUniverse.cik, companies.cik))
        .where(where)
        .orderBy(userUniverse.ticker)
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);
      const [total] = await db
        .select({ n: count() })
        .from(userUniverse)
        .leftJoin(companies, eq(userUniverse.cik, companies.cik))
        .where(where);
      return { rows, total: total.n };
    }),

  /**
   * Add a ticker to MY universe (4c, D30/D31). Re-adding a removed company is
   * the same upsert — a fresh ACTIVE row, exactly like a brand-new one
   * (owner directive). Only companies of the shared registry can be added:
   * the auto-ingest of a company outside it was dropped on 2026-11-23 (the
   * desk reads the research standards, which cover the registry).
   */
  add: authedQuery
    .input(z.object({ ticker: z.string().min(1).max(20) }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.viewAsUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "read-only view-as mode" });
      const t = input.ticker.trim().toUpperCase().replace(/\./g, "-");
      const dir = await edgar.cikForTicker(t);
      if (!dir) {
        throw new TRPCError({ code: "NOT_FOUND", message: `${t} not found in the SEC filer directory` });
      }
      // A company outside the registry is not added (owner, 2026-11-23): the desk reads the research standards,
      // which cover the registry's companies, and adding another one only started the old ingest job.
      if (!(await companyInDb(dir.cik))) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${dir.ticker} is not among the companies covered here` });
      }
      const db = getDb();
      await db
        .insert(userUniverse)
        .values({ userId: ctx.user.id, cik: dir.cik, ticker: dir.ticker, name: dir.name, active: true })
        .onDuplicateKeyUpdate({ set: { active: true, ticker: dir.ticker, name: dir.name } });
      const jobId = await recordUniverseAction(
        "universe-add",
        { cik: dir.cik, ticker: dir.ticker, name: dir.name },
        ctx.user
      );
      await invalidateScreenerCache(ctx.user.id);
      return { ok: true, cik: dir.cik, ticker: dir.ticker, ingesting: false, ingestJobId: null as number | null, jobId };
    }),

  /**
   * The trash can (4c, D30): remove a company from MY universe — the
   * membership row is deleted; shared company data is never touched.
   * Re-adding later creates a fresh active membership (universe.add).
   * Idempotent; every removal is logged as a terminal micro-job (D29).
   */
  remove: authedQuery
    .input(z.object({ cik: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.viewAsUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "read-only view-as mode" });
      const db = getDb();
      const [m] = await db
        .select()
        .from(userUniverse)
        .where(and(eq(userUniverse.userId, ctx.user.id), eq(userUniverse.cik, input.cik)))
        .limit(1);
      if (!m) return { ok: true, already: true, jobId: null, ticker: null as string | null };
      await db.delete(userUniverse).where(eq(userUniverse.id, m.id));
      const jobId = await recordUniverseAction(
        "universe-remove",
        { cik: m.cik, ticker: m.ticker, name: m.name },
        ctx.user
      );
      await invalidateScreenerCache(ctx.user.id);
      return { ok: true, already: false, jobId, ticker: m.ticker };
    }),
});
