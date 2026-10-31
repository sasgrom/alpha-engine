import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { dashboardRouter, universeRouter, jobsRouter, browseRouter } from "./routers/engine";
import { documentsRouter, seriesRouter, companyRouter, pipelineRouter, sectionsRouter } from "./routers/iteration2";
import { scopeRouter } from "./routers/scope";
import { sentimentRouter } from "./routers/sentiment";
import { adminRouter } from "./routers/admin";
import { pricesRouter } from "./routers/prices";
import { screenerRouter, eventsRouter } from "./routers/screener";
import { messagesRouter } from "./routers/messages";
import { activityRouter } from "./routers/activity";
import { workersLocalRouter } from "./routers/workers-local";
import { digestsRouter } from "./routers/digests";
import { workersMonitorRouter } from "./routers/workers-monitor";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  dashboard: dashboardRouter,
  universe: universeRouter,
  jobs: jobsRouter,
  browse: browseRouter,
  documents: documentsRouter,
  series: seriesRouter,
  company: companyRouter,
  pipeline: pipelineRouter,
  scope: scopeRouter,
  sections: sectionsRouter,
  sentiment: sentimentRouter,
  prices: pricesRouter,
  screener: screenerRouter,
  events: eventsRouter,
  messages: messagesRouter,
  activity: activityRouter,
  admin: adminRouter,
  workersLocal: workersLocalRouter,
  workersMonitor: workersMonitorRouter,
  digests: digestsRouter,
});

export type AppRouter = typeof appRouter;
