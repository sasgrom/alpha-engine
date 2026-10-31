/**
 * Iteration-3a tRPC router: sentiment scoring (Stage 2.2).
 * Score reads for the UI (Sentiment tab, Sentiment Lab) + score-job
 * launch. Scoring is always a job (never synchronous inside a request): LLM
 * calls are slow and billed; the job log provides spend audit (usageTokens).
 */
import { z } from "zod";
import { and, desc, eq, sql, count } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { companies, filings, sentimentScores } from "@db/schema";
import { createJob } from "../services/runner";

export const sentimentRouter = createRouter({
  /**
   * Launch cloud scoring. The defaults are deliberately small
   * (calibration; LLM calls are billed to the owner): 3 documents, MD&A
   * group only. ADMIN-only since 4c (D31 — billing honesty).
   */
  startScore: adminQuery
    .input(
      z.object({
        tickers: z.string().default("universe"),
        exclude: z.string().default(""),
        maxDocs: z.number().min(1).max(10).default(3),
        sections: z.string().default("mda"), // groups from SECTION_GROUPS: mda,risk,fin
        pairwise: z.boolean().default(true),
      })
    )
    .mutation(({ input, ctx }) => createJob("score", input, ctx.user.id)),

  /**
   * A company's scores: a filings × aspects timeline.
   * By default only the LATEST versions (llmVersion+promptVersion) are
   * returned, so the UI never mixes runs of different prompts/models.
   */
  byCompany: authedQuery
    .input(
      z.object({
        cik: z.number(),
        /** filter by a specific version; defaults to the latest pair */
        llmVersion: z.string().optional(),
        promptVersion: z.string().optional(),
        /** include rows with invalid evidence (for hallucination audits) */
        includeUnverified: z.boolean().default(false),
        limit: z.number().default(2000),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      // the latest version pair for the company (unless a filter is explicit)
      let llmVersion = input.llmVersion;
      let promptVersion = input.promptVersion;
      if (!llmVersion || !promptVersion) {
        const [latest] = await db
          .select({ llmVersion: sentimentScores.llmVersion, promptVersion: sentimentScores.promptVersion })
          .from(sentimentScores)
          .where(eq(sentimentScores.cik, input.cik))
          .orderBy(desc(sentimentScores.scoredAt))
          .limit(1);
        if (!latest) return { rows: [], versions: [] };
        llmVersion = llmVersion ?? latest.llmVersion;
        promptVersion = promptVersion ?? latest.promptVersion;
      }
      const conds = [
        eq(sentimentScores.cik, input.cik),
        eq(sentimentScores.llmVersion, llmVersion),
        eq(sentimentScores.promptVersion, promptVersion),
      ];
      if (!input.includeUnverified) conds.push(eq(sentimentScores.evidenceOk, true));
      const rows = await db
        .select({
          id: sentimentScores.id,
          accessionNo: sentimentScores.accessionNo,
          form: sentimentScores.form,
          sectionKey: sentimentScores.sectionKey,
          aspect: sentimentScores.aspect,
          score: sentimentScores.score,
          confidence: sentimentScores.confidence,
          evidence: sentimentScores.evidence,
          evidenceOk: sentimentScores.evidenceOk,
          pairwise: sentimentScores.pairwise,
          scoredAt: sentimentScores.scoredAt,
          filingDate: filings.filingDate,
          reportDate: filings.reportDate,
        })
        .from(sentimentScores)
        .leftJoin(
          filings,
          and(eq(filings.cik, sentimentScores.cik), eq(filings.accessionNo, sentimentScores.accessionNo))
        )
        .where(and(...conds))
        .orderBy(desc(filings.filingDate), sentimentScores.aspect)
        .limit(input.limit);
      // all existing versions — for the UI switcher (prompt A/B comparison)
      const versions = await db
        .select({
          llmVersion: sentimentScores.llmVersion,
          promptVersion: sentimentScores.promptVersion,
          n: count(),
          last: sql<string>`MAX(${sentimentScores.scoredAt})`,
        })
        .from(sentimentScores)
        .where(eq(sentimentScores.cik, input.cik))
        .groupBy(sentimentScores.llmVersion, sentimentScores.promptVersion);
      return { rows, versions };
    }),

  /** Sentiment Lab summary: coverage, evidence rate, token spend. */
  labStats: authedQuery.query(async () => {
    const db = getDb();
    const totals = await db
      .select({
        llmVersion: sentimentScores.llmVersion,
        promptVersion: sentimentScores.promptVersion,
        rows: count(),
        verified: sql<number>`SUM(CASE WHEN ${sentimentScores.evidenceOk} THEN 1 ELSE 0 END)`,
        companies: sql<number>`COUNT(DISTINCT ${sentimentScores.cik})`,
        docs: sql<number>`COUNT(DISTINCT ${sentimentScores.documentId})`,
      })
      .from(sentimentScores)
      .groupBy(sentimentScores.llmVersion, sentimentScores.promptVersion);
    // usageTokens repeats in each of the ~9 rows of one call — count it
    // over unique (document, section) pairs, otherwise spend is ~9x overstated
    const tok: any = await db.execute(
      sql`SELECT COALESCE(SUM(t.u), 0) AS tokens FROM (
            SELECT DISTINCT documentId, sectionKey, usageTokens AS u FROM sentiment_scores
          ) t`
    );
    return { totals, tokens: Number(tok[0][0]?.tokens ?? 0) };
  }),

  /** ticker for display (join companies) — a small Lab helper */
  tickersWithScores: authedQuery.query(async () => {
    return getDb()
      .selectDistinct({ cik: sentimentScores.cik, ticker: companies.ticker })
      .from(sentimentScores)
      .leftJoin(companies, eq(companies.cik, sentimentScores.cik))
      .limit(500);
  }),
});
