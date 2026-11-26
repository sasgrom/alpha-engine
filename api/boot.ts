import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { reviewerReportAccess, reviewerSecurityHeaders } from "./services/reviewer-http";
import { perimeter } from "./services/perimeter";

const app = new Hono<{ Bindings: HttpBindings }>();

// first of all: local connections only, machine routes not through the proxy, same-origin writes, security headers
app.use("*", perimeter);
app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("*", reviewerSecurityHeaders);
app.use("/reports/*", reviewerReportAccess);
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

// 4k (D45): the home worker's ingest endpoint (Variant C). Sources that block
// datacenter IPs (GDELT/Stocktwits/Reddit/YouTube-CC — proven 2026-10-19) are
// collected on the home machine and POSTed here; Bearer key auth against
// worker_keys; ingestedAt is stamped SERVER-side (the no-lookahead anchor,
// D43). Raw route, not tRPC — worker payloads are not superjson.
app.post("/api/worker/ingest", async (c) => {
  const { verifyWorkerKey, workerIngestBodyZ, ingestSignals, ingestDigests, ingestHoldings, ingestHoldingsSnapshot, ingestFundQuarters, ingestFactsSnapshot } = await import("./services/worker");
  const label = await verifyWorkerKey(c.req.header("authorization") ?? null);
  if (!label) return c.json({ error: "unknown or revoked worker key" }, 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON body required" }, 400);
  }
  const parsed = workerIngestBodyZ.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid payload", issues: parsed.error.issues.slice(0, 10) }, 400);
  }
  if (parsed.data.kind === "signals") {
    const r = await ingestSignals(parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "digests") {
    const r = await ingestDigests(parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "holdings") {
    const r = await ingestHoldings(parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "holdingsSnapshot") {
    const r = await ingestHoldingsSnapshot(parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "fundQuarters") {
    const r = await ingestFundQuarters(parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "factsSnapshot") {
    const r = await ingestFactsSnapshot(parsed.data.cik, parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "pricesDaily") {
    const { ingestPricesDaily } = await import("./services/worker-operational");
    const r = await ingestPricesDaily(parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "macroPoints") {
    const { ingestMacroPoints } = await import("./services/worker-operational");
    const r = await ingestMacroPoints(parsed.data.rows);
    return c.json({ ok: true, worker: label, ...r });
  }
  if (parsed.data.kind === "reportFile") {
    const { ingestReportFile } = await import("./services/worker-operational");
    const r = await ingestReportFile(parsed.data);
    return c.json({ ok: true, worker: label, ...r });
  }
  return c.json({ error: "unsupported kind" }, 400);
});

app.post("/api/worker/backup-expectations", async (c) => {
  const { handleWorkerExpectationsBackup } = await import("./services/worker-expectations-http");
  return handleWorkerExpectationsBackup(c.req.raw);
});
app.post("/api/worker/apply-expectations-reviewed", async (c) => {
  const { handleWorkerExpectationsApply } = await import("./services/worker-expectations-http");
  return handleWorkerExpectationsApply(c.req.raw);
});
app.get("/reports/:name", async (c) => {
  const { reportFileResponse } = await import("./services/report-files");
  return reportFileResponse(c.req.param("name"), { acceptEncoding: c.req.header("accept-encoding") });
});

// 3i: orphan sweep at worker start — jobs left "running"/"queued" by a dead
// process (redeploy, crash) are marked error honestly instead of hanging in
// the queue forever with an un-cancelable cancel button. Single-instance
// deployment by design (the runner is in-process).
void import("./services/runner").then(({ sweepOrphanedJobs }) =>
  sweepOrphanedJobs()
    .then((n) => { if (n > 0) console.log(`[runner] orphan sweep: ${n} stale job(s) marked error`); })
    .catch((e) => console.warn("[runner] orphan sweep failed (non-fatal):", e))
);

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

// 5f marker: 13f ingest source live
