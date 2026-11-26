import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { dashboardRouter, universeRouter } from "./routers/engine";
import { companyRouter } from "./routers/iteration2";
import { adminRouter } from "./routers/admin";
import { pricesRouter } from "./routers/prices";
import { messagesRouter } from "./routers/messages";
import { activityRouter } from "./routers/activity";
import { workersLocalRouter } from "./routers/workers-local";
import { workersMonitorRouter } from "./routers/workers-monitor";
import { reviewerRouter } from "./routers/reviewer";
import { deskRouter } from "./routers/desk";

export const appRouter = createRouter({
  // Health monitors outside this repository may call this tiny endpoint.
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  dashboard: dashboardRouter,
  universe: universeRouter,
  company: companyRouter,
  prices: pricesRouter,
  messages: messagesRouter,
  activity: activityRouter,
  admin: adminRouter,
  workersLocal: workersLocalRouter,
  workersMonitor: workersMonitorRouter,
  reviewer: reviewerRouter,
  desk: deskRouter,
});

export type AppRouter = typeof appRouter;
