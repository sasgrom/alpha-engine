/**
 * Desk view (the new standalone UI at /desk). Reads only:
 * - the precomputed market snapshot, for every signed-in user; option-derived fields only for the owner and
 *   NDA-accepted reviewers (see services/desk-snapshot.ts);
 * - five-minute company/session views and the shared intraday market summary, for every signed-in user;
 * - the fund-flow files (overview, one fund, one company), for every signed-in user (owner's decision of
 *   2026-11-11); reviewers reach them, like everything else, only after accepting the NDA (middleware);
 * - the company files built from the research standards (one file per company): the statements, the splits and
 *   dividends, the fund holdings, the insider transactions, the list of filings and the text of cached earnings
 *   releases for every signed-in user (what the companies, the funds and the insiders filed with the SEC, and public
 *   corporate actions); the guidance
 *   history, which is our own reading of the releases, only for the owner and NDA-accepted reviewers;
 * - the engine-flow files (the prediction engine's working, decision by decision), for the owner only;
 * - the home operations' health (scheduler, failed jobs, the evening market run, failed production pushes), for the
 *   owner only: the desk shows it as a banner, so a stopped collection is never silent.
 */
import { z } from "zod";
import { readDeskOptionChain } from "../services/desk-option-chain";
import type { DeskCompanyActions, DeskCompanyFilings, DeskCompanyGuidance, DeskCompanyHolders, DeskCompanyInsiders, DeskCompanyStatements, DeskGuidanceMarket, DeskInsiderMarket, DeskScreen } from "@contracts/desk-company";
import type { EngineFlowCompany, EngineFlowIndex } from "@contracts/engine-flow";
import type { FundFlowsCompany, FundFlowsFund, FundFlowsOverview } from "@contracts/fund-flows";
import { operationsHealth } from "../../worker/lib/operations-health";
import { readSourceFreshness } from "../services/source-freshness";
import { readSecuritySummary } from "../services/security-events";
import { loadOperationsState } from "../../worker/lib/operations-scheduler";
import { adminQuery, createRouter, authedQuery } from "../middleware";
import { readDeskCompanyFile } from "../services/desk-company-files";
import { readDeskDocumentText } from "../services/desk-documents";
import { deskSnapshotFor, readDeskSnapshot } from "../services/desk-snapshot";
import { intradayForCompany, readIntradayMarketReport } from "../services/intraday";
import { readEngineFlowFile } from "../services/engine-flow-files";
import { readFundFlowsFile } from "../services/fund-flows-files";

const entity = z.object({ cik: z.number().int().positive() });

export const deskRouter = createRouter({
  snapshot: authedQuery.query(({ ctx }) => {
    const snapshot = readDeskSnapshot();
    if (!snapshot) return null;
    const presentation = ctx.user.role === "admin" || Boolean(ctx.reviewerAccess?.acceptedAt);
    return deskSnapshotFor(snapshot, presentation);
  }),
  intraday: authedQuery.input(z.object({ ticker: z.string().trim().min(1).max(20), sessions: z.number().int().min(1).max(5).default(1) })).query(({ input }) => intradayForCompany(input)),
  intradayMarket: authedQuery.query(() => readIntradayMarketReport()),
  flowsOverview: authedQuery.query(() => readFundFlowsFile<FundFlowsOverview>("overview.json")),
  flowsFund: authedQuery.input(entity).query(({ input }) => readFundFlowsFile<FundFlowsFund>(`fund/${input.cik}.json`)),
  flowsCompany: authedQuery.input(entity).query(({ input }) => readFundFlowsFile<FundFlowsCompany>(`company/${input.cik}.json`)),
  companyStatements: authedQuery.input(entity).query(({ input }) => readDeskCompanyFile<DeskCompanyStatements>(`statements/${input.cik}.json`)),
  companyActions: authedQuery.input(entity).query(({ input }) => readDeskCompanyFile<DeskCompanyActions>(`actions/${input.cik}.json`)),
  companyHolders: authedQuery.input(entity).query(({ input }) => readDeskCompanyFile<DeskCompanyHolders>(`holders/${input.cik}.json`)),
  companyInsiders: authedQuery.input(entity).query(({ input }) => readDeskCompanyFile<DeskCompanyInsiders>(`insiders/${input.cik}.json`)),
  // insider trading across companies, from the same build as the company files (public Form 4 reports)
  insiderMarket: authedQuery.query(() => readDeskCompanyFile<DeskInsiderMarket>("insiders-market.json")),
  // the Screener's fundamentals for all companies (figures from public filings and prices)
  screen: authedQuery.query(() => readDeskCompanyFile<DeskScreen>("screen.json")),
  companyFilings: authedQuery.input(entity).query(({ input }) => readDeskCompanyFile<DeskCompanyFilings>(`filings/${input.cik}.json`)),
  // the text of a cached earnings-release exhibit; the service opens only a file the company's filings list names
  companyDocument: authedQuery
    .input(z.object({ cik: z.number().int().positive(), accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/), file: z.string().min(8).max(120) }))
    .query(({ input }) => readDeskDocumentText(input)),
  // guidance is our own reading of the releases (a research product): the owner and NDA-accepted reviewers only, like the option fields
  companyGuidance: authedQuery.input(entity).query(({ ctx, input }) =>
    ctx.user.role === "admin" || ctx.reviewerAccess?.acceptedAt ? readDeskCompanyFile<DeskCompanyGuidance>(`guidance/${input.cik}.json`) : null),
  // the latest option chain of a company, read from the raw Schwab archive on request; option data is for the owner and
  // NDA-accepted reviewers, like the option fields of the snapshot
  companyOptionChain: authedQuery
    .input(z.object({ ticker: z.string().regex(/^[A-Z][A-Z0-9.\-/]{0,9}$/), expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .query(({ ctx, input }) => (ctx.user.role === "admin" || ctx.reviewerAccess?.acceptedAt ? readDeskOptionChain(input) : null)),
  guidanceMarket: authedQuery.query(({ ctx }) =>
    ctx.user.role === "admin" || ctx.reviewerAccess?.acceptedAt ? readDeskCompanyFile<DeskGuidanceMarket>("guidance-market.json") : null),
  engineIndex: adminQuery.query(() => readEngineFlowFile<EngineFlowIndex>("index.json")),
  engineCompany: adminQuery.input(entity).query(({ input }) => readEngineFlowFile<EngineFlowCompany>(`company/${input.cik}.json`)),
  opsHealth: adminQuery.query(() => {
    const health = operationsHealth(loadOperationsState(), new Date());
    // someone guessing passwords is the owner's business at once, on every page
    const security = readSecuritySummary();
    if (security.spike) health.alerts.push({ level: "error", code: "sign-in-attempts", text: `${security.failedSignInsLastHour} failed sign-ins in the last hour: see Operations, Sign-in attempts.` });
    return health;
  }),
  // the server's security events (refusals, failed and successful sign-ins) for the Operations page
  securityEvents: adminQuery.query(() => readSecuritySummary()),
  // how current each data source is, by the newest day in its own data (the Operations page's Sources table)
  sourceFreshness: adminQuery.query(() => readSourceFreshness()),
});
