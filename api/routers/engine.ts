import { z } from "zod";
import { and, desc, eq, inArray, like, sql, count, max } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, adminQuery, effectiveUserId } from "../middleware";
import { getDb } from "../queries/connection";
import { companies, filings, facts, jobs, jobLogs, users, userUniverse } from "@db/schema";
import { createJob, recordUniverseAction, requestCancel } from "../services/runner";
import { companyInDb, invalidateScreenerCache } from "../services/membership";
import { latestMacro } from "../services/macro";
import { sectorFlows, sectorFlowsDetailed } from "../services/institutional";
import * as edgar from "../services/edgar";

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------
export const dashboardRouter = createRouter({
  stats: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [c] = await db.select({ n: count() }).from(companies);
    // 4c (D30): "Universe" = the VIEWER's own active watchlist, not a global flag
    const [cu] = await db
      .select({ n: count() })
      .from(userUniverse)
      .where(and(eq(userUniverse.userId, effectiveUserId(ctx)), eq(userUniverse.active, true)));
    const [f] = await db.select({ n: count() }).from(filings);
    const [fc] = await db.select({ n: count() }).from(facts);
    const [latest] = await db.select({ d: max(filings.filingDate) }).from(filings);
    const [running] = await db.select({ n: count() }).from(jobs).where(eq(jobs.status, "running"));
    const [queued] = await db.select({ n: count() }).from(jobs).where(eq(jobs.status, "queued"));
    return {
      companies: c.n,
      universe: cu.n,
      filings: f.n,
      facts: fc.n,
      latestFilingDate: latest.d,
      // 4c review fix: the FIFO queue (D24) makes queued jobs invisible in a
      // running-only counter — report both so the IDLE led stops lying
      runningJobs: running.n,
      queuedJobs: queued.n,
    };
  }),

  /**
   * Latest filings of the VIEWER's universe (4c, D30 — the dashboard is a
   * personal world, not a global firehose). Empty universe → empty feed;
   * the page empty-state points at Universe to add tickers.
   */
  latestFilings: authedQuery.input(z.object({ limit: z.number().default(15) })).query(async ({ input, ctx }) => {
    const db = getDb();
    const myCiks = await db
      .select({ cik: userUniverse.cik })
      .from(userUniverse)
      .where(and(eq(userUniverse.userId, effectiveUserId(ctx)), eq(userUniverse.active, true)));
    if (myCiks.length === 0) return [];
    return db
      .select({
        id: filings.id,
        cik: filings.cik,
        ticker: companies.ticker,
        name: companies.name,
        form: filings.form,
        filingDate: filings.filingDate,
        accessionNo: filings.accessionNo,
      })
      .from(filings)
      .innerJoin(companies, eq(filings.cik, companies.cik))
      .where(inArray(filings.cik, myCiks.map((r) => r.cik)))
      .orderBy(desc(filings.filingDate), desc(filings.id))
      .limit(input.limit);
  }),

  /** 4m (D46): the FRED regime pack's latest values — the Stage 4 seed card. */
  macro: authedQuery.query(() => latestMacro()),

  /** 13F flows use the same guarded rows in both shapes; detailed adds coverage. */
  sectorFlows: authedQuery.query(() => sectorFlows()),
  sectorFlowsDetailed: authedQuery.query(() => sectorFlowsDetailed()),
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
   * The hide switch (4c, D30): active on/off on MY membership only. Never
   * touches shared data; nobody else's universe changes.
   */
  setActive: authedQuery
    .input(z.object({ cik: z.number(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.viewAsUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "read-only view-as mode" });
      const res = await getDb()
        .update(userUniverse)
        .set({ active: input.active })
        .where(and(eq(userUniverse.userId, ctx.user.id), eq(userUniverse.cik, input.cik)));
      if (!Number((res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "not in your universe" });
      }
      await invalidateScreenerCache(ctx.user.id);
      return { ok: true };
    }),

  /**
   * Add a ticker to MY universe (4c, D30/D31). Re-adding a removed company is
   * the same upsert — a fresh ACTIVE row, exactly like a brand-new one
   * (owner directive). When the company is missing from the shared registry,
   * a light auto-ingest (single-ticker bootstrap, startedBy = the user) is
   * queued server-side: users cannot launch ingestion themselves (D31), this
   * sanctioned exception is limited to one ticker per call.
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
      const db = getDb();
      await db
        .insert(userUniverse)
        .values({ userId: ctx.user.id, cik: dir.cik, ticker: dir.ticker, name: dir.name, active: true })
        .onDuplicateKeyUpdate({ set: { active: true, ticker: dir.ticker, name: dir.name } });
      const ingesting = !(await companyInDb(dir.cik));
      let ingestJobId: number | null = null;
      if (ingesting) {
        ingestJobId = await createJob(
          "bootstrap",
          { tickers: dir.ticker, exclude: "", forms: "10-K,10-Q,8-K", withFacts: true },
          ctx.user.id
        );
      }
      const jobId = await recordUniverseAction(
        "universe-add",
        { cik: dir.cik, ticker: dir.ticker, name: dir.name },
        ctx.user
      );
      await invalidateScreenerCache(ctx.user.id);
      return { ok: true, cik: dir.cik, ticker: dir.ticker, ingesting, ingestJobId, jobId };
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

  lookupTicker: authedQuery.input(z.object({ ticker: z.string() })).query(async ({ input }) => {
    return edgar.cikForTicker(input.ticker);
  }),

  /**
   * Typeahead over the full SEC filer directory (company_tickers.json,
   * cached in-process after the first fetch — ~12k rows, one SEC request).
   * Ranking: ticker prefix matches first, then name substring matches.
   * This is the source for the Add Ticker autocomplete: the user can search
   * by company NAME, not only by ticker.
   */
  directorySearch: authedQuery
    .input(z.object({ q: z.string().min(1).max(60) }))
    .query(async ({ input }) => {
      const q = input.q.trim().toUpperCase();
      const map = await edgar.tickerMap();
      const prefix: typeof map = [];
      const nameHit: typeof map = [];
      for (const r of map) {
        if (r.ticker.startsWith(q)) prefix.push(r);
        else if (r.name.toUpperCase().includes(q)) nameHit.push(r);
        if (prefix.length >= 8 && nameHit.length >= 8) break;
      }
      return [...prefix.slice(0, 8), ...nameHit.slice(0, 8)].slice(0, 12);
    }),

  sp500Preview: authedQuery.query(async () => {
    // Wikipedia may be unreachable (sandbox / network failure) — then we
    // honestly show "n/a" on the bootstrap button instead of 500ing the page.
    try {
      const tickers = await edgar.sp500Constituents();
      return { count: tickers.length, sample: tickers.slice(0, 12), unavailable: false };
    } catch {
      return { count: null, sample: [], unavailable: true };
    }
  }),
});

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------
const tickersInput = z.object({
  // scope grammar (services/scope.ts):
  // 'universe' | 'sp500' | 'ndx' | 'dow' | 'sector:X' | 'industry:Y' | 'preset:N' | 'AAPL,MSFT'
  tickers: z.string().default("universe"),
  // comma-separated excluded tickers — subtracted after the base resolves
  exclude: z.string().default(""),
  forms: z.string().default("10-K,10-Q,8-K"),
});

export const jobsRouter = createRouter({
  /**
   * Job visibility: admins see all jobs (with launcher names), role="user"
   * sees only their own (startedBy = their users.id). Legacy rows with
   * startedBy NULL predate per-user tracking and are admin-only.
   */
  list: authedQuery.input(z.object({ limit: z.number().default(30) })).query(async ({ input, ctx }) => {
    const db = getDb();
    const q = db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        params: jobs.params,
        processed: jobs.processed,
        total: jobs.total,
        message: jobs.message,
        createdAt: jobs.createdAt,
        startedAt: jobs.startedAt,
        finishedAt: jobs.finishedAt,
        startedBy: jobs.startedBy,
        startedByName: users.name,
      })
      .from(jobs)
      .leftJoin(users, eq(jobs.startedBy, users.id))
      .orderBy(desc(jobs.id))
      .limit(input.limit);
    if (ctx.user.role !== "admin") {
      return q.where(eq(jobs.startedBy, ctx.user.id));
    }
    // 4e (D36): in view-as mode the admin reads the VIEWED user's queue
    if (ctx.viewAsUserId) return q.where(eq(jobs.startedBy, ctx.viewAsUserId));
    return q;
  }),

  logs: authedQuery
    .input(z.object({ jobId: z.number(), afterId: z.number().default(0), limit: z.number().default(500) }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(jobLogs)
        .where(and(eq(jobLogs.jobId, input.jobId), sql`${jobLogs.id} > ${input.afterId}`))
        .orderBy(jobLogs.id)
        .limit(input.limit);
    }),

  // 4c (D31): launching ingestion is an ADMIN op — jobs write shared tables
  // and hit SEC against the fair-access budget; users get their coverage via
  // the single-ticker auto-ingest inside universe.add.
  startBootstrap: adminQuery
    .input(tickersInput.extend({ withFacts: z.boolean().default(true) }))
    .mutation(({ input, ctx }) => createJob("bootstrap", input, ctx.user.id)),

  startFilingRefresh: adminQuery
    .input(tickersInput)
    .mutation(({ input, ctx }) => createJob("filings", input, ctx.user.id)),

  startStream: adminQuery
    .input(
      tickersInput.extend({
        cycles: z.number().min(1).max(100).default(1),
        intervalSec: z.number().min(30).max(86400).default(300),
      })
    )
    .mutation(({ input, ctx }) => createJob("stream", input, ctx.user.id)),

  cancel: authedQuery.input(z.object({ jobId: z.number() })).mutation(async ({ input, ctx }) => {
    // 3i: returns WHAT happened — "flagged" (live job will stop at its next
    // checkpoint), "force-cancelled" (orphan/queued row flipped in the DB) or
    // "not-cancellable" (terminal already / no such job). The UI toasts it.
    // 4c (D31): a non-admin may cancel only their OWN jobs — the queue is
    // shared infrastructure.
    if (ctx.user.role !== "admin") {
      const [j] = await getDb().select({ startedBy: jobs.startedBy }).from(jobs).where(eq(jobs.id, input.jobId));
      if (!j || j.startedBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "you can cancel only your own jobs" });
      }
    }
    const action = await requestCancel(input.jobId);
    return { ok: action !== "not-cancellable", action };
  }),
});

// ---------------------------------------------------------------------------
// database browser + company fundamentals
// ---------------------------------------------------------------------------
export const browseRouter = createRouter({
  filingsList: authedQuery
    .input(
      z.object({
        cik: z.number().optional(),
        form: z.string().optional(),
        search: z.string().default(""),
        page: z.number().default(0),
        pageSize: z.number().default(50),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input.cik) conds.push(eq(filings.cik, input.cik));
      if (input.form) conds.push(eq(filings.form, input.form));
      if (input.search) conds.push(like(companies.ticker, `%${input.search}%`));
      const where = conds.length ? and(...conds) : undefined;
      const rows = await db
        .select({
          id: filings.id,
          cik: filings.cik,
          ticker: companies.ticker,
          name: companies.name,
          form: filings.form,
          filingDate: filings.filingDate,
          reportDate: filings.reportDate,
          accessionNo: filings.accessionNo,
          primaryDoc: filings.primaryDoc,
        })
        .from(filings)
        .leftJoin(companies, eq(filings.cik, companies.cik))
        .where(where)
        .orderBy(desc(filings.filingDate), desc(filings.id))
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);
      const [total] = await db.select({ n: count() }).from(filings).leftJoin(companies, eq(filings.cik, companies.cik)).where(where);
      return { rows, total: total.n };
    }),

  concepts: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const rows = await db
      .selectDistinct({ concept: facts.concept, taxonomy: facts.taxonomy })
      .from(facts)
      .where(eq(facts.cik, input.cik))
      .orderBy(facts.concept)
      .limit(2000);
    return rows;
  }),

  conceptSeries: authedQuery
    .input(
      z.object({
        cik: z.number(),
        concept: z.string(),
        form: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [eq(facts.cik, input.cik), eq(facts.concept, input.concept)];
      if (input.form) conds.push(eq(facts.form, input.form));
      return db
        .select({
          endDate: facts.endDate,
          startDate: facts.startDate,
          val: facts.val,
          unit: facts.unit,
          form: facts.form,
          fy: facts.fy,
          fp: facts.fp,
          filed: facts.filed,
        })
        .from(facts)
        .where(and(...conds))
        .orderBy(facts.endDate)
        .limit(500);
    }),

  filingDocument: authedQuery
    .input(z.object({ cik: z.number(), accessionNo: z.string(), primaryDoc: z.string().nullable().optional() }))
    .query(async ({ input }) => {
      const { docName, html } = await edgar.fetchFilingDocument(input.cik, input.accessionNo, input.primaryDoc);
      // strip to readable text-ish excerpt; full rendering happens later in Stage 2
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { docName, length: text.length, excerpt: text.slice(0, 20000) };
    }),
});
