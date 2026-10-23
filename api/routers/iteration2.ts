/**
 * Iteration-2 tRPC routers: documents (Stage 1.5 corpus), series (Stage 1.6
 * canonical time series), company (aggregated per-company view).
 * All endpoints are authenticated; mutations that consume quota (harvest)
 * go through the job queue, never synchronous request handlers.
 */
import { z } from "zod";
import { and, desc, eq, sql, count } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { companies, documents, documentSections, seriesPoints, seriesHealth, companyDataHealth, filings, sentimentScores, insiderTrades, signals, externalCache } from "@db/schema";
import { storage } from "../lib/storage";
import { createJob } from "../services/runner";
import { DOCUMENT_FORM_SCOPE, derivePlaintext } from "../services/documents";

/** Direct SEC Archives URL for a document — always public, no storage needed. */
function secArchivesDocUrl(cik: number, accessionNo: string, docName: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNo.replace(/-/g, "")}/${docName}`;
}
import { computeCompanyFactors } from "../services/factors";
import { computeCompanyValue } from "../services/valuation";
import { cachedExternal } from "../services/ext-cache";
import { latestShortInterest } from "../services/short-interest";
import { sectionText } from "../services/sections";
import { buildStatements, STATEMENT_CONCEPTS } from "../services/statements";

// ---------------------------------------------------------------------------
// documents — the text corpus registry
// ---------------------------------------------------------------------------
export const documentsRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        cik: z.number().optional(),
        form: z.string().optional(),
        role: z.enum(["primary", "exhibit", "other"]).optional(),
        status: z.enum(["pending", "fetched", "failed"]).optional(),
        page: z.number().default(0),
        pageSize: z.number().default(40),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input.cik) conds.push(eq(documents.cik, input.cik));
      if (input.form) conds.push(eq(documents.form, input.form));
      if (input.role) conds.push(eq(documents.role, input.role));
      if (input.status) conds.push(eq(documents.fetchStatus, input.status));
      const where = conds.length ? and(...conds) : undefined;
      const rows = await db
        .select({
          id: documents.id,
          cik: documents.cik,
          ticker: companies.ticker,
          accessionNo: documents.accessionNo,
          form: documents.form,
          docName: documents.docName,
          docType: documents.docType,
          role: documents.role,
          sizeBytes: documents.sizeBytes,
          textLength: documents.textLength,
          location: documents.location,
          fetchStatus: documents.fetchStatus,
          fetchedAt: documents.fetchedAt,
        })
        .from(documents)
        .leftJoin(companies, eq(documents.cik, companies.cik))
        .where(where)
        .orderBy(desc(documents.id))
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);
      const [total] = await db.select({ n: count() }).from(documents).where(where);
      return { rows, total: total.n };
    }),

  stats: authedQuery.query(async () => {
    const db = getDb();
    const byStatus = await db
      .select({ status: documents.fetchStatus, n: count() })
      .from(documents)
      .groupBy(documents.fetchStatus);
    const [sizes] = await db
      .select({
        rawBytes: sql<number>`COALESCE(SUM(${documents.sizeBytes}),0)`,
        textChars: sql<number>`COALESCE(SUM(${documents.textLength}),0)`,
      })
      .from(documents);
    return { byStatus, ...sizes };
  }),

  /**
   * Plaintext excerpt for in-browser viewing. The text is read server-side
   * from object storage by key (keys persist, URLs never do).
   * LOCAL fallback (5f): a home dev box has no object storage (api/lib throws
   * a raw platform error — never leak it to the UI); instead we serve from
   * the worker EDGAR cache (worker/cache/edgar/<cik>/<accn>[.ex].htm) when
   * the cached document matches the manifest. UI copy stays ENGLISH-only.
   */
  text: authedQuery
    .input(z.object({ id: z.number(), maxChars: z.number().default(30000) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [doc] = await db.select().from(documents).where(eq(documents.id, input.id)).limit(1);
      if (!doc) throw new Error("document not found");
      if (!doc.textKey) throw new Error("no derived text available");
      try {
        const bytes = await storage.readFile({ fileKey: doc.textKey });
        const text = Buffer.from(bytes).toString("utf-8");
        return {
          docName: doc.docName, form: doc.form, length: text.length,
          excerpt: text.slice(0, input.maxChars), truncated: text.length > input.maxChars,
          source: "storage" as const,
        };
      } catch {
        const cached = readWorkerCacheDoc(doc.cik, doc.accessionNo, doc.docName);
        if (cached) {
          const text = derivePlaintext(cached);
          return {
            docName: doc.docName, form: doc.form, length: text.length,
            excerpt: text.slice(0, input.maxChars), truncated: text.length > input.maxChars,
            source: "local-cache" as const,
          };
        }
        // default fallback: the filing lives on SEC EDGAR anyway — hand the UI
        // a real link instead of a dead-end error message
        return {
          docName: doc.docName, form: doc.form, length: 0,
          excerpt: "", truncated: false, source: "sec" as const,
          secUrl: secArchivesDocUrl(doc.cik, doc.accessionNo, doc.docName),
        };
      }
    }),

  /** Short-lived URL to the immutable raw document (for iframe/download). */
  rawUrl: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [doc] = await db.select().from(documents).where(eq(documents.id, input.id)).limit(1);
      if (!doc?.storageKey) throw new Error("raw document not in cloud storage");
      try {
        const { url } = await storage.getPresignedUrl({ key: doc.storageKey });
        return { url };
      } catch {
        // the raw document is public on SEC EDGAR — the fallback IS the data
        return { url: secArchivesDocUrl(doc.cik, doc.accessionNo, doc.docName) };
      }
    }),
});

// ---------------------------------------------------------------------------
// 5f local document fallback helpers — read the worker EDGAR cache on the
// home box. Kept here (not api/lib) per the read-only api/lib rule.
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Match a documents row to a cached worker file via the cache manifest. */
function readWorkerCacheDoc(cik: number, accessionNo: string, docName: string): string | null {
  try {
    const dir = path.resolve(process.cwd(), "worker", "cache", "edgar", String(cik));
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as any[];
    const entry = manifest.find((m) => m.accessionNo === accessionNo);
    const base = accessionNo.replace(/-/g, "");
    let file: string | null = null;
    if (entry?.docName === docName) file = path.join(dir, `${base}.htm`);
    else if (entry?.exFile === docName) file = path.join(dir, `${base}.ex.htm`);
    if (file && existsSync(file)) return readFileSync(file, "utf8");
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// series — canonical quarterly time series
// ---------------------------------------------------------------------------
export const seriesRouter = createRouter({
  /** Concepts with built series for a company, with health summary. */
  concepts: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    return getDb()
      .select()
      .from(seriesHealth)
      .where(eq(seriesHealth.cik, input.cik))
      .orderBy(seriesHealth.concept)
      .limit(2000);
  }),

  /** Quarterly points for one series in one vintage. */
  points: authedQuery
    .input(
      z.object({
        cik: z.number(),
        concept: z.string(),
        kind: z.enum(["flow", "stock"]),
        vintage: z.enum(["first", "latest"]).default("latest"),
      })
    )
    .query(async ({ input }) => {
      return getDb()
        .select()
        .from(seriesPoints)
        .where(
          and(
            eq(seriesPoints.cik, input.cik),
            eq(seriesPoints.concept, input.concept),
            eq(seriesPoints.kind, input.kind),
            eq(seriesPoints.vintage, input.vintage)
          )
        )
        .orderBy(seriesPoints.periodEnd)
        .limit(500);
    }),

  /**
   * Curated statement tables (3e): income / balance / cash flow / ratios over
   * the fiscal-quarter grid, with vintage control (latest | first | as-of).
   * Resolved from series_points — a company without a built series gets an
   * empty view (the UI then suggests running the series job).
   */
  statements: authedQuery
    .input(
      z.object({
        cik: z.number(),
        mode: z.enum(["quarterly", "annual"]).default("quarterly"),
        vintage: z.enum(["latest", "first", "asOf"]).default("latest"),
        asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        periods: z.number().int().min(4).max(20).default(12),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const [company] = await db
        .select({ fiscalYearEnd: companies.fiscalYearEnd })
        .from(companies)
        .where(eq(companies.cik, input.cik))
        .limit(1);
      // fetch both vintages of every map concept — resolution picks per cell
      const pts = await db
        .select({
          concept: seriesPoints.concept,
          kind: seriesPoints.kind,
          periodEnd: seriesPoints.periodEnd,
          vintage: seriesPoints.vintage,
          val: seriesPoints.val,
          sourceFiled: seriesPoints.sourceFiled,
        })
        .from(seriesPoints)
        .where(eq(seriesPoints.cik, input.cik))
        .limit(50000);
      const health = await db
        .select({ concept: seriesHealth.concept, flags: seriesHealth.flags })
        .from(seriesHealth)
        .where(eq(seriesHealth.cik, input.cik))
        .limit(2000);
      const flagged = new Set(
        health.filter((h) => h.flags && h.flags !== "[]" && STATEMENT_CONCEPTS.includes(h.concept)).map((h) => h.concept)
      );
      return buildStatements({
        points: pts,
        fyEnd: company?.fiscalYearEnd ?? null,
        mode: input.mode,
        vintage: input.vintage,
        asOf: input.asOf ?? null,
        periods: input.periods,
        flaggedConcepts: flagged,
      });
    }),

  /** Company-level data integrity rollup (Stage 4 feature input). */
  companyHealth: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const [row] = await getDb()
      .select()
      .from(companyDataHealth)
      .where(eq(companyDataHealth.cik, input.cik))
      .limit(1);
    return row ?? null;
  }),

  /** Series with continuity flags (the Data Health page's main list). */
  flagged: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    return getDb()
      .select()
      .from(seriesHealth)
      .where(and(eq(seriesHealth.cik, input.cik), sql`${seriesHealth.flags} IS NOT NULL`))
      .orderBy(seriesHealth.concept)
      .limit(500);
  }),
});

// ---------------------------------------------------------------------------
// company — aggregated per-company view for the /company/:ticker page
// ---------------------------------------------------------------------------
export const companyRouter = createRouter({
  overview: authedQuery.input(z.object({ ticker: z.string() })).query(async ({ input }) => {
    const db = getDb();
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.ticker, input.ticker.toUpperCase()))
      .limit(1);
    if (!company) return null;
    const [filingsCount] = await db.select({ n: count() }).from(filings).where(eq(filings.cik, company.cik));
    const [docsCount] = await db.select({ n: count() }).from(documents).where(eq(documents.cik, company.cik));
    const [docsFetched] = await db
      .select({ n: count() })
      .from(documents)
      .where(and(eq(documents.cik, company.cik), eq(documents.fetchStatus, "fetched")));
    const [seriesCount] = await db.select({ n: count() }).from(seriesHealth).where(eq(seriesHealth.cik, company.cik));
    // scores count drives the conditional Sentiment tab on the company page:
    // no scored sections → the tab is not rendered at all (declutter, 3c)
    const [scoresCount] = await db.select({ n: count() }).from(sentimentScores).where(eq(sentimentScores.cik, company.cik));
    // 4j (D43): signals coverage gates the conditional Signals tab
    const [signalsCount] = await db.select({ n: count() }).from(signals).where(eq(signals.cik, company.cik));
    const [health] = await db
      .select()
      .from(companyDataHealth)
      .where(eq(companyDataHealth.cik, company.cik))
      .limit(1);
    return {
      company,
      counts: {
        filings: filingsCount.n,
        documents: docsCount.n,
        documentsFetched: docsFetched.n,
        series: seriesCount.n,
        scores: scoresCount.n,
        signals: signalsCount.n,
      },
      health: health ?? null,
    };
  }),

  /** Available document form scope (drives UI filters). */
  formScope: authedQuery.query(() => [...DOCUMENT_FORM_SCOPE]),

  /**
   * 4i (D41): factor library snapshot for one company — computed from our own
   * series/prices on demand, cached 20 h in external_cache (D27). nulls are
   * honest "can't compute from our data".
   */
  factors: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const key = `factors:${input.cik}`;
    let r = await cachedExternal(key, 20 * 3600_000, () => computeCompanyFactors(input.cik));
    // 4l: a pre-4j cached payload lacks `detail` (per-factor histories) —
    // serving it crashes the Value tab. Rebuild stale keys on read.
    if (!("detail" in (r.data as Record<string, unknown>))) {
      await getDb().delete(externalCache).where(eq(externalCache.key, key));
      r = await cachedExternal(key, 20 * 3600_000, () => computeCompanyFactors(input.cik));
    }
    return { ...r.data, asOf: r.asOf, fresh: r.fresh };
  }),

  /** 4i (D41): intrinsic value panel — reverse-DCF implied growth, RIM range, EPV floor, V/P, P/E z. */
  value: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const r = await cachedExternal(`value:${input.cik}`, 20 * 3600_000, () => computeCompanyValue(input.cik));
    return { ...r.data, asOf: r.asOf, fresh: r.fresh };
  }),

  /**
   * 4j (D42): recent insider transactions (Form 4) for the company Overview
   * panel — newest first, coded (P/S/A/M/F/G) with the 10b5-1 flag.
   */
  insiderTrades: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(insiderTrades)
      .where(eq(insiderTrades.cik, input.cik))
      .orderBy(desc(insiderTrades.tradeDate))
      .limit(25);
    return rows;
  }),

  /**
   * 4j (D43): the signals feed of one company — recent rows newest first,
   * plus 7-day aggregates (mean tone, total buzz). The no-lookahead pair
   * (eventTs/ingestedAt) rides every row.
   */
  signals: authedQuery.input(z.object({ cik: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const recent = await db
      .select()
      .from(signals)
      .where(eq(signals.cik, input.cik))
      .orderBy(desc(signals.eventTs))
      .limit(100);
    const agg: any = await db.execute(sql`
      SELECT source, signalType, COUNT(*) n,
             AVG(score) avgScore, SUM(magnitude) totalMagnitude
      FROM signals
      WHERE cik=${input.cik} AND eventTs > NOW() - INTERVAL 7 DAY
      GROUP BY source, signalType`);
    return { recent, aggregates: agg[0] };
  }),

  /** 4m (D46): short interest state — current + prior + share delta. */
  shortInterest: authedQuery.input(z.object({ cik: z.number() })).query(({ input }) => latestShortInterest(input.cik)),
});

// ---------------------------------------------------------------------------
// job launchers for the new stage-1.5 / 1.6 pipelines
// ---------------------------------------------------------------------------
export const pipelineRouter = createRouter({
  // 4c (D31): all job launchers are ADMIN-only — they write shared tables /
  // burn owner-billed resources; users get coverage via universe.add.
  startHarvest: adminQuery
    .input(
      z.object({
        // scope grammar: see services/scope.ts; exclude = tickers to subtract
        tickers: z.string().default("universe"),
        exclude: z.string().default(""),
        forms: z.string().default(DOCUMENT_FORM_SCOPE.join(",")),
        maxFilingsPerForm: z.number().min(1).max(100).default(5),
      })
    )
    .mutation(({ input, ctx }) => createJob("harvest", input, ctx.user.id)),

  startSeriesBuild: adminQuery
    .input(z.object({ tickers: z.string().default("universe"), exclude: z.string().default("") }))
    .mutation(({ input, ctx }) => createJob("series", input, ctx.user.id)),

  // Stage 2.1: section cutting inside downloaded primary documents (offline work)
  startSectionParse: adminQuery
    .input(z.object({ tickers: z.string().default("universe"), exclude: z.string().default("") }))
    .mutation(({ input, ctx }) => createJob("sections", input, ctx.user.id)),
});

// ---------------------------------------------------------------------------
// sections — semantic document sections (Stage 2.1, offsets into plaintext)
// ---------------------------------------------------------------------------
export const sectionsRouter = createRouter({
  /** A company's document sections (or one filing's) for inspection. */
  list: authedQuery
    .input(
      z.object({
        cik: z.number(),
        accessionNo: z.string().optional(),
        sectionKey: z.string().optional(),
        parserVersion: z.number().optional(),
        limit: z.number().default(500),
      })
    )
    .query(async ({ input }) => {
      const conds = [eq(documentSections.cik, input.cik)];
      if (input.accessionNo) conds.push(eq(documentSections.accessionNo, input.accessionNo));
      if (input.sectionKey) conds.push(eq(documentSections.sectionKey, input.sectionKey));
      if (input.parserVersion) conds.push(eq(documentSections.parserVersion, input.parserVersion));
      return getDb()
        .select()
        .from(documentSections)
        .where(and(...conds))
        .orderBy(desc(documentSections.id))
        .limit(input.limit);
    }),

  /** Section text (plaintext slice of the document by offsets) — preview. */
  text: authedQuery
    .input(z.object({ id: z.number(), maxChars: z.number().default(12000) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [sec] = await db.select().from(documentSections).where(eq(documentSections.id, input.id)).limit(1);
      if (!sec) throw new Error("section not found");
      const [doc] = await db.select().from(documents).where(eq(documents.id, sec.documentId)).limit(1);
      if (!doc) throw new Error("document not found");
      const text = await sectionText(doc, sec);
      if (text === null) throw new Error("no derived text for document");
      return {
        sectionKey: sec.sectionKey,
        title: sec.title,
        length: text.length,
        excerpt: text.slice(0, input.maxChars),
        truncated: text.length > input.maxChars,
      };
    }),
});
