/**
 * In-process job runner for Stage-1 ingestion jobs.
 *
 * Hybrid-ready by design: jobs are persisted rows with params + progress,
 * and this module is the *cloud worker* executing them. A future local
 * worker (the Python engine on the user's machine) can poll the same
 * jobs table and execute with identical semantics.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companies, filings, facts, jobs, jobLogs } from "@db/schema";
import * as edgar from "./edgar";
import { harvestCompanyDocuments, DOCUMENT_FORM_SCOPE } from "./documents";
import { resolveScope, enrichClassification } from "./scope";

const cancelFlags = new Map<number, { cancelled: boolean }>();

/**
 * Global FIFO serialization (3h review, D24): exactly ONE job executes at a
 * time. A job row is created with status "queued" and appended to this
 * chain; the chain drains in creation order. Rationale: (a) concurrent runs
 * race on the same tables and double-hit SEC against the fair-access
 * discipline; (b) one-at-a-time is exactly the semantics of the future home
 * worker — the cloud prototype now models it honestly. Cancellation works
 * for queued jobs as well: requestCancel flips a queued row straight to
 * "cancelled" and the drain skips it when its turn comes. On process restart
 * orphaned "queued"/"running" rows stay as-is (same as before — jobs never
 * outlive the worker process).
 */
let drainChain: Promise<void> = Promise.resolve();

export async function log(jobId: number, level: "info" | "warn" | "error", message: string) {
  await getDb().insert(jobLogs).values({ jobId, level, message: message.slice(0, 6000) });
}

/**
 * User-facing error text: the LLM gateway returns Chinese AiTransient strings
 * that must not leak into the UI. Known patterns get an English equivalent;
 * any other CJK-containing message is replaced by a generic English line
 * (the raw provider text stays available in the job log for the owner).
 */
function humanizeError(msg: string): string {
  if (/无法连接网关|读取模型清单/.test(msg)) {
    return "LLM gateway temporarily unreachable (AiTransient) — safe to retry; nothing is billed before the model is resolved.";
  }
  if (/[\u4e00-\u9fff]/.test(msg)) {
    return "External LLM service error (transient). Raw provider message is in the job log.";
  }
  return msg;
}

function errText(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string; code?: string } };
  const parts = [e?.message ?? String(err)];
  if (e?.cause?.code) parts.push(`[${e.cause.code}]`);
  if (e?.cause?.message) parts.push(e.cause.message.slice(0, 300));
  return parts.join(" ");
}

async function setJob(jobId: number, fields: Partial<typeof jobs.$inferInsert>) {
  await getDb().update(jobs).set(fields).where(eq(jobs.id, jobId));
}

export async function createJob(
  type: "bootstrap" | "filings" | "stream" | "facts" | "harvest" | "series" | "sections" | "score" | "prices",
  params: Record<string, unknown>,
  /** users.id of the launcher; drives per-user visibility in jobs.list */
  startedBy?: number
): Promise<number> {
  const res = await getDb().insert(jobs).values({ type, params: JSON.stringify(params), startedBy: startedBy ?? null });
  const id = Number(res[0].insertId);
  // the cancel flag exists from creation time — a queued job is cancellable
  cancelFlags.set(id, { cancelled: false });
  // FIFO: wait for every earlier job, then run (executeJob never throws —
  // it converts failures into the job row; the catch here is a last resort).
  // startedBy rides along: scope "universe" resolves against the LAUNCHER's
  // own universe (4c, D30).
  drainChain = drainChain.then(async () => {
    await executeJob(id, type, params, startedBy).catch(async (err) => {
      await log(id, "error", `Unhandled job failure: ${String(err)}`);
      await setJob(id, { status: "error", finishedAt: new Date(), message: humanizeError(String(err)).slice(0, 490) });
    });
  });
  return id;
}

/**
 * Universe-membership audit record (4b/4c, D29/D30). An add/remove click is
 * not pipeline work — it never enters the drain chain (it would otherwise
 * queue behind a running bootstrap and feel broken). But the action MUST be
 * visible in the logs, so we write a TERMINAL micro-job row (jobs.type
 * 'universe-add'/'universe-remove', startedBy = the acting user) plus a
 * job_logs line with the full who/what/when meta. The Jobs page lists it
 * (per-user scoped as usual), Admin → Logs shows the meta.
 * ('universe-restore' is the deprecated 4b type — kept only so legacy rows
 * still parse.)
 */
export async function recordUniverseAction(
  type: "universe-add" | "universe-remove" | "universe-restore",
  company: { cik: number; ticker: string; name: string | null },
  user: { id: number; name: string | null }
): Promise<number> {
  const db = getDb();
  const now = new Date();
  const verb =
    type === "universe-add" ? "added to" : type === "universe-remove" ? "removed from" : "restored to";
  const res = await db.insert(jobs).values({
    type,
    params: JSON.stringify({ cik: company.cik, ticker: company.ticker }),
    startedBy: user.id,
    status: "done",
    processed: 1,
    total: 1,
    message: `${company.ticker} ${verb} ${user.name ?? `user ${user.id}`}'s universe`,
    startedAt: now,
    finishedAt: now,
  });
  const id = Number(res[0].insertId);
  const who = `${user.name ?? "unknown"} (id ${user.id})`;
  const detail =
    type === "universe-add"
      ? `UNIVERSE-ADD · ${company.ticker} — ${company.name ?? "?"} (CIK ${company.cik}) added to the personal universe of ${who} at ${now.toISOString()} · active immediately · shared company data untouched`
      : type === "universe-remove"
        ? `UNIVERSE-REMOVE · ${company.ticker} — ${company.name ?? "?"} (CIK ${company.cik}) removed from the personal universe of ${who} at ${now.toISOString()} · membership row deleted; shared company data untouched (filings/facts/series/sections/scores/prices kept) · re-add via search`
        : `UNIVERSE-RESTORE · ${company.ticker} — ${company.name ?? "?"} (CIK ${company.cik}) restored to the universe view by ${who} at ${now.toISOString()} · legacy 4b action`;
  await log(id, "info", detail);
  return id;
}

/**
 * Cancel a job. Three honest outcomes (3i — the "silent cancel button" fix):
 *  - "flagged"        — the job is live IN THIS PROCESS (a flag exists): it
 *                       will throw JobCancelled at its next checkpoint;
 *  - "force-cancelled"— the row says running/queued but no executor holds it
 *                       (orphan of a dead process, e.g. after a redeploy) —
 *                       flip it in the DB directly, no flag to wait on;
 *  - "not-cancellable"— no such job, or it is already in a terminal state.
 * Before 3i the second case returned ok:true and changed nothing — the UI
 * button looked dead on orphaned rows.
 */
export type CancelAction = "flagged" | "force-cancelled" | "not-cancellable";

export async function requestCancel(jobId: number): Promise<CancelAction> {
  const db = getDb();
  const [row] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!row || (row.status !== "running" && row.status !== "queued")) return "not-cancellable";

  const live = cancelFlags.has(jobId); // a flag exists only while THIS process executes the job
  if (live) {
    cancelFlags.get(jobId)!.cancelled = true;
  }
  if (!live || row.status === "queued") {
    // queued (drain will skip it) or orphaned (no live executor anywhere):
    // flip the row now so the UI and the queue both move on
    await db
      .update(jobs)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
        message: row.status === "queued" ? "Cancelled while queued" : "Cancelled — no live executor (orphan of a restarted worker)",
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, row.status)));
    return "force-cancelled";
  }
  return "flagged";
}

/**
 * Orphan sweep (3i): at worker start, every job still marked running/queued
 * belongs to a DEAD process (executors are in-process and never survive a
 * restart; the deployment is single-instance by design). Mark them honestly
 * instead of leaving "RUNNING" rows that nothing can cancel.
 */
export async function sweepOrphanedJobs(): Promise<number> {
  const r = await getDb()
    .update(jobs)
    .set({
      status: "error",
      finishedAt: new Date(),
      message: "Worker process restarted — job orphaned and stopped (in-process executor lost)",
    })
    .where(sql`${jobs.status} IN ('running','queued')`);
  return Number(r[0]?.affectedRows ?? 0);
}

function checkCancel(jobId: number) {
  if (cancelFlags.get(jobId)?.cancelled) {
    throw new JobCancelled();
  }
}

class JobCancelled extends Error {
  constructor() {
    super("cancelled by user");
  }
}

/**
 * 4a (D27/D28): after a job that changed screener inputs, refresh the cached
 * screener payload in the background — the job itself completes immediately,
 * and the next reader never waits on a rebuild. 4c (D30): the payload is
 * PER-USER — refresh every user who holds at least one membership (the
 * platform is small; at real user scale this becomes a scoped diff).
 */
const SCREENER_INPUT_JOBS = new Set(["bootstrap", "filings", "stream", "series", "score", "prices"]);function screenerRefreshInBackground(jobId: number) {
  void (async () => {
    try {
      const { buildScreenerRows } = await import("./screener");
      const { usersWithUniverse } = await import("./membership");
      const { externalCache } = await import("@db/schema");
      const uids = await usersWithUniverse();
      for (const uid of uids) {
        const rows = await buildScreenerRows(uid);
        await getDb()
          .insert(externalCache)
          .values({ key: `screener:u${uid}`, payload: JSON.stringify(rows), source: "live" })
          .onDuplicateKeyUpdate({
            set: { payload: sql`VALUES(\`payload\`)`, fetchedAt: sql`VALUES(\`fetchedAt\`)`, source: sql`VALUES(\`source\`)` },
          });
      }
      await log(jobId, "info", `Screener cache refreshed for ${uids.length} user(s)`);
    } catch (e) {
      console.warn("[screener] background refresh failed:", String(e));
    }
  })();
}

/**
 * 4n (D47): after prices/series jobs, rebuild the metric history of the
 * job's scope in the background — the quote-grid tiles chart instantly off
 * metric_history.
 */
const METRIC_INPUT_JOBS = new Set(["prices", "series"]);
function metricHistoryRefreshInBackground(jobId: number, params: Record<string, unknown>, userId?: number) {
  void (async () => {
    try {
      const { computeCompanyMetricHistory } = await import("./metric-history");
      const tickers = await resolveTickers(params, jobId, userId);
      if (tickers.length === 0) return;
      const db = getDb();
      const rows = await db
        .select({ cik: companies.cik })
        .from(companies)
        .where(inArray(companies.ticker, tickers.map((t) => t.toUpperCase())))
        .limit(2000);
      for (const c of rows) await computeCompanyMetricHistory(c.cik);
      await log(jobId, "info", `Metric history refreshed for ${rows.length} companies`);
    } catch (e) {
      console.warn("[metric-history] background refresh failed:", String(e));
    }
  })();
}

async function executeJob(jobId: number, type: string, params: Record<string, unknown>, startedBy?: number) {
  // the flag was created in createJob and may already be cancelled (queued
  // cancel) — never reset it here, just honour it
  const flag = cancelFlags.get(jobId) ?? { cancelled: false };
  cancelFlags.set(jobId, flag);
  if (flag.cancelled) {
    await setJob(jobId, { status: "cancelled", finishedAt: new Date(), message: "Cancelled while queued" });
    await log(jobId, "warn", "Job cancelled while queued — skipped");
    cancelFlags.delete(jobId);
    return;
  }
  await setJob(jobId, { status: "running", startedAt: new Date() });
  try {
    if (type === "bootstrap") await runBootstrap(jobId, params, startedBy);
    else if (type === "filings") await runFilingIndexRefresh(jobId, params, startedBy);
    else if (type === "facts") await runFactsRefresh(jobId, params, startedBy);
    else if (type === "stream") await runStream(jobId, params, startedBy);
    else if (type === "harvest") await runHarvest(jobId, params, startedBy);
    else if (type === "series") await runSeriesBuild(jobId, params, startedBy);
    else if (type === "sections") await runSectionsParse(jobId, params, startedBy);
    else if (type === "score") await runScore(jobId, params, startedBy);
    else if (type === "prices") await runPrices(jobId, params, startedBy);
    await setJob(jobId, { status: "done", finishedAt: new Date() });
    await log(jobId, "info", "Job finished successfully");
    if (SCREENER_INPUT_JOBS.has(type)) screenerRefreshInBackground(jobId);
    if (METRIC_INPUT_JOBS.has(type)) metricHistoryRefreshInBackground(jobId, params, startedBy); // 4n
  } catch (err) {
    if (err instanceof JobCancelled) {
      await setJob(jobId, { status: "cancelled", finishedAt: new Date(), message: "Cancelled by user" });
      await log(jobId, "warn", "Job cancelled by user");
    } else {
      await setJob(jobId, { status: "error", finishedAt: new Date(), message: humanizeError(String(err)).slice(0, 490) });
      await log(jobId, "error", `Job failed: ${String(err)}`);
    }
  } finally {
    cancelFlags.delete(jobId);
  }
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
/**
 * Resolve a job's scope string into a concrete ticker list.
 * The full grammar (universe|sp500|ndx|dow|sector:X|industry:Y|preset:N|list)
 * and exclude subtraction live in services/scope.ts; this is an adapter with
 * job-log logging so the journal shows WHAT was actually processed
 * (selection auditability is a Stage 2 requirement).
 *
 * 4c (D30): "universe" resolves against the LAUNCHER's own universe —
 * userId comes from jobs.startedBy (undefined = legacy row → admin's
 * universe fallback inside scope.ts).
 */
async function resolveTickers(params: Record<string, unknown>, jobId?: number, userId?: number): Promise<string[]> {
  const spec = String(params.tickers ?? "universe");
  const exclude = typeof params.exclude === "string" ? params.exclude : "";
  const r = await resolveScope(spec, exclude, userId);
  if (jobId) {
    const exInfo =
      r.excluded.length > 0
        ? `, excluded ${r.excluded.length} (${r.excluded.slice(0, 10).join(",")}${r.excluded.length > 10 ? ",..." : ""})`
        : "";
    await log(jobId, "info", `Scope resolved: "${r.base}" -> ${r.baseCount} base tickers${exInfo}; final ${r.tickers.length}`);
  }
  return r.tickers;
}

const DEFAULT_FORMS = ["10-K", "10-Q", "8-K"];

/**
 * 4a (D28): earnings events rebuild — a cheap DB-only scan over
 * filings.items (8-K Item 2.02). Runs at the end of every job that can
 * change the filings table. Non-fatal by design.
 */
async function rebuildEventsHook(jobId: number) {
  try {
    const { rebuildAllEvents } = await import("./events");
    const r = await rebuildAllEvents();
    await log(jobId, "info", `Events rebuild: ${r.companies} companies scanned (${r.scanned} itemized 8-Ks), ${r.added} new earnings events`);
  } catch (err) {
    await log(jobId, "warn", `Events rebuild failed (non-fatal): ${errText(err)}`);
  }
}

async function ingestOneCompany(
  jobId: number,
  ticker: string,
  cik: number,
  name: string,
  forms: string[],
  withFacts: boolean
) {
  const db = getDb();
  // company row
  const payload = await edgar.submissions(cik);
  await db
    .insert(companies)
    .values({
      cik,
      ticker,
      name: payload?.name ?? name,
      sic: payload?.sic ?? null,
      sicDescription: payload?.sicDescription ?? null,
      exchange: payload?.exchanges?.[0] ?? null,
      fiscalYearEnd: payload?.fiscalYearEnd ?? null,
      // 4c (D30): the global inUniverse/removedAt flags are deprecated —
      // universe membership lives in user_universe per user; ingestion only
      // maintains the shared company registry
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        ticker,
        name: payload?.name ?? name,
        sic: payload?.sic ?? null,
        sicDescription: payload?.sicDescription ?? null,
        exchange: payload?.exchanges?.[0] ?? null,
        fiscalYearEnd: payload?.fiscalYearEnd ?? null,
        updatedAt: new Date(),
      },
    });

  // filing index (skip duplicates)
  const idx = await edgar.filingIndex(cik, forms);
  let newFilings = 0;
  for (const f of idx) {
    const r = await db
      .insert(filings)
      .values({
        cik: f.cik,
        accessionNo: f.accessionNo,
        form: f.form,
        filingDate: f.filingDate,
        reportDate: f.reportDate,
        primaryDoc: f.primaryDoc,
        items: f.items, // 4a: 8-K item list feeds the events stream
      })
      .onDuplicateKeyUpdate({ set: { primaryDoc: f.primaryDoc, items: sql`COALESCE(VALUES(\`items\`), \`items\`)` } });
    if (Number(r[0].affectedRows) === 1) newFilings++;
  }

  // XBRL facts (cumulative payload → transactional full replace, 4f/D37)
  let factRows = 0;
  if (withFacts) {
    checkCancel(jobId); // never cancel between wipe and refill — see D37
    factRows = await replaceCompanyFacts(cik, ticker, (level, m) => log(jobId, level, m));
  }
  await log(jobId, "info", `${ticker} (${cik}): ${newFilings} new filings, ${factRows} fact rows`);
}

/**
 * Transactional per-cik facts replace (4f, D37) — the 2026-10-12 incident:
 * a cancelled bootstrap wiped AAPL facts (DELETE landed, the insert chunks
 * never ran). Rules: an empty parse = a broken payload → keep existing rows
 * and warn; the wipe+refill is ONE transaction (cancel/failure rolls back);
 * callers check cancel BEFORE this, never during. Shared by the bootstrap
 * job and the repair scripts. Returns rows written (0 = skipped anomalous).
 */
export async function replaceCompanyFacts(
  cik: number,
  ticker: string,
  logFn?: (level: "info" | "warn" | "error", message: string) => Promise<void>
): Promise<number> {
  const factsPayload = await edgar.companyFacts(cik);
  const rows = edgar.factsToRows(factsPayload);
  if (rows.length === 0) {
    await logFn?.("warn", `${ticker} (${cik}): SEC returned 0 fact rows — keeping existing facts (payload anomaly)`);
    return 0;
  }
  await getDb().transaction(async (tx) => {
    await tx.delete(facts).where(eq(facts.cik, cik));
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(facts).values(rows.slice(i, i + CHUNK));
    }
  });
  return rows.length;
}

// ---------------------------------------------------------------------------
// job implementations
// ---------------------------------------------------------------------------
async function runBootstrap(jobId: number, params: Record<string, unknown>, userId?: number) {
  const forms = String(params.forms ?? DEFAULT_FORMS.join(",")).split(",").map((s) => s.trim());
  const withFacts = params.withFacts !== false;
  const tickers = await resolveTickers(params, jobId, userId);
  await setJob(jobId, { total: tickers.length, processed: 0 });
  await log(jobId, "info", `Bootstrap started: ${tickers.length} tickers, forms=${forms.join("/")}, facts=${withFacts}`);
  const map = await edgar.tickerMap();
  let processed = 0;
  for (const ticker of tickers) {
    checkCancel(jobId);
    const row = map.find((r) => r.ticker === ticker);
    if (!row) {
      await log(jobId, "warn", `Ticker not found in EDGAR map: ${ticker}`);
    } else {
      try {
        await ingestOneCompany(jobId, ticker, row.cik, row.name, forms, withFacts);
      } catch (err) {
        await log(jobId, "error", `Bootstrap failed for ${ticker}: ${errText(err)}`);
      }
    }
    processed++;
    if (processed % 10 === 0 || processed === tickers.length) {
      await setJob(jobId, { processed, message: `${processed}/${tickers.length} companies` });
    }
  }
  // Automatic GICS enrichment (D14/D16): the snapshot is static and offline,
  // so every ingest re-applies it. Log the outcome honestly: who matched,
  // who did not and why — "0 updated" alone reads like a silent failure.
  try {
    const r = await enrichClassification();
    await log(
      jobId,
      "info",
      `GICS enrichment: ${r.updated} updated, ${r.inDb} matched [${r.matched.join(", ") || "—"}] (snapshot as of ${r.asOf})`,
    );
    for (const u of r.unmatched) {
      await log(jobId, "warn", `GICS enrichment: ${u.ticker} skipped — ${u.reason}; SEC SIC shown in the UI instead`);
    }
  } catch (err) {
    await log(jobId, "warn", `GICS enrichment failed (non-fatal): ${errText(err)}`);
  }
  await rebuildEventsHook(jobId);
}

async function runFilingIndexRefresh(jobId: number, params: Record<string, unknown>, userId?: number) {
  const forms = String(params.forms ?? DEFAULT_FORMS.join(",")).split(",").map((s) => s.trim());
  const tickers = await resolveTickers({ ...params, tickers: params.tickers ?? "universe" }, jobId, userId);
  await setJob(jobId, { total: tickers.length, processed: 0 });
  await log(jobId, "info", `Filing-index refresh: ${tickers.length} tickers`);
  const map = await edgar.tickerMap();
  let processed = 0;
  for (const ticker of tickers) {
    checkCancel(jobId);
    const row = map.find((r) => r.ticker === ticker);
    if (row) {
      try {
        await ingestOneCompany(jobId, ticker, row.cik, row.name, forms, false);
      } catch (err) {
        await log(jobId, "error", `Refresh failed for ${ticker}: ${errText(err)}`);
      }
    }
    processed++;
    if (processed % 25 === 0 || processed === tickers.length) {
      await setJob(jobId, { processed, message: `${processed}/${tickers.length} companies` });
    }
  }
  await rebuildEventsHook(jobId);
}

async function runFactsRefresh(jobId: number, params: Record<string, unknown>, userId?: number) {
  await runBootstrap(jobId, { ...params, withFacts: true, forms: "10-K" }, userId);
}

/**
 * Stage 1.5 job: harvest filing documents (primary + exhibits) into the
 * Document Registry + object storage. Bounded per form type while in the
 * cloud test scope; the future local worker runs it unbounded.
 */
async function runHarvest(jobId: number, params: Record<string, unknown>, userId?: number) {
  const forms = String(params.forms ?? DOCUMENT_FORM_SCOPE.join(",")).split(",").map((s) => s.trim());
  const maxPerForm = Number(params.maxFilingsPerForm ?? 5);
  const tickers = await resolveTickers(params, jobId, userId);
  await setJob(jobId, { total: tickers.length, processed: 0 });
  await log(jobId, "info", `Harvest started: ${tickers.length} tickers, forms=${forms.join("/")}, max ${maxPerForm} filings/form`);
  const map = await edgar.tickerMap();
  let processed = 0;
  for (const ticker of tickers) {
    checkCancel(jobId);
    const row = map.find((r) => r.ticker === ticker);
    if (!row) {
      await log(jobId, "warn", `Ticker not found in EDGAR map: ${ticker}`);
    } else {
      try {
        const r = await harvestCompanyDocuments(row.cik, ticker, forms, maxPerForm,
          (level, message) => log(jobId, level, message));
        await log(jobId, "info", `${ticker}: ${r.filings} filings harvested, ${r.docs} documents stored`);
      } catch (err) {
        await log(jobId, "error", `Harvest failed for ${ticker}: ${errText(err)}`);
      }
    }
    processed++;
    await setJob(jobId, { processed, message: `${processed}/${tickers.length} companies` });
  }
}

/**
 * Stage 1.6 job: build canonical quarterly series from raw facts.
 * Implemented in services/series.ts; registered here so the queue treats
 * series builds like any other background job.
 */
async function runSeriesBuild(jobId: number, params: Record<string, unknown>, userId?: number) {
  const { buildCompanySeries } = await import("./series");
  const tickers = await resolveTickers(params, jobId, userId);
  await setJob(jobId, { total: tickers.length, processed: 0 });
  await log(jobId, "info", `Series build started: ${tickers.length} tickers`);
  const map = await edgar.tickerMap();
  let processed = 0;
  for (const ticker of tickers) {
    checkCancel(jobId);
    const row = map.find((r) => r.ticker === ticker);
    if (!row) continue;
    try {
      const r = await buildCompanySeries(row.cik);
      await log(jobId, "info", `${ticker}: ${r.series} series, ${r.points} points, coverage ${(r.avgCoverage * 100).toFixed(0)}%`);
    } catch (err) {
      await log(jobId, "error", `Series build failed for ${ticker}: ${errText(err)}`);
    }
    processed++;
    await setJob(jobId, { processed, message: `${processed}/${tickers.length} companies` });
  }
}

/**
 * Stage 2.1 job: section slicing of already-downloaded primary documents.
 * Runs fully offline (DB + object storage), SEC is not touched —
 * so ticker→cik resolves via the companies table, not the EDGAR map.
 */
async function runSectionsParse(jobId: number, params: Record<string, unknown>, userId?: number) {
  const { parseCompanySections, ciksForTickers } = await import("./sections");
  const tickers = await resolveTickers(params, jobId, userId);
  const pairs = await ciksForTickers(tickers);
  const found = new Set(pairs.map((p) => p.ticker));
  for (const t of tickers) {
    if (!found.has(t)) await log(jobId, "warn", `${t}: not in companies table (not ingested), skipped`);
  }
  await setJob(jobId, { total: pairs.length, processed: 0 });
  await log(jobId, "info", `Sections parse started: ${pairs.length} companies`);
  let processed = 0;
  for (const p of pairs) {
    checkCancel(jobId);
    try {
      const r = await parseCompanySections(p.cik, p.ticker, (level, message) => log(jobId, level, message));
      await log(jobId, "info", `${p.ticker}: ${r.docs} docs -> ${r.sections} sections`);
    } catch (err) {
      await log(jobId, "error", `Sections parse failed for ${p.ticker}: ${errText(err)}`);
    }
    processed++;
    await setJob(jobId, { processed, message: `${processed}/${pairs.length} companies` });
  }
}

/**
 * Stage 2.2 job: cloud prototype of LLM scoring (rubric calibration).
 * NOTE: LLM calls are billed to the site owner — defaults are deliberately
 * small (maxDocs=3, mda group), and idempotency on (llmVersion, promptVersion)
 * is checked BEFORE any model call.
 */
async function runScore(jobId: number, params: Record<string, unknown>, userId?: number) {
  const { scoreCompany, companiesForTickers, currentLlmVersion } = await import("./sentiment/score");
  const maxDocs = Number(params.maxDocs ?? 3);
  const groups = String(params.sections ?? "mda").split(",").map((s) => s.trim()).filter(Boolean);
  const pairwise = params.pairwise !== false;
  const tickers = await resolveTickers(params, jobId, userId);
  const pairs = await companiesForTickers(tickers);
  await setJob(jobId, { total: pairs.length, processed: 0 });

  // the model is resolved once per job — every row of the run carries one llmVersion
  const { modelId, llmVersion } = await currentLlmVersion();
  await log(jobId, "info", `Score started: ${pairs.length} companies, groups=${groups.join("/")}, pairwise=${pairwise}, maxDocs=${maxDocs}, model=${llmVersion}, prompt=${(await import("./sentiment/rubric")).PROMPT_VERSION}`);

  let processed = 0;
  let totalTokens = 0;
  for (const p of pairs) {
    checkCancel(jobId);
    try {
      const r = await scoreCompany(p.cik, p.ticker, { maxDocs, groups, pairwise, modelId, llmVersion },
        (level, message) => log(jobId, level, message));
      totalTokens += r.tokens;
    } catch (err) {
      await log(jobId, "error", `Score failed for ${p.ticker}: ${errText(err)}`);
    }
    processed++;
    await setJob(jobId, { processed, message: `${processed}/${pairs.length} companies, ${totalTokens} tokens` });
  }
  await log(jobId, "info", `Score finished: total ${totalTokens} tokens (billed to site owner)`);
}

async function runStream(jobId: number, params: Record<string, unknown>, userId?: number) {
  const forms = String(params.forms ?? "8-K").split(",").map((s) => s.trim());
  const cycles = Number(params.cycles ?? 1);
  const intervalSec = Number(params.intervalSec ?? 300);
  const tickers = await resolveTickers({ ...params, tickers: params.tickers ?? "universe" }, jobId, userId);
  const db = getDb();
  await setJob(jobId, { total: cycles, processed: 0 });
  await log(jobId, "info", `Stream: ${cycles} cycle(s) over ${tickers.length} tickers, interval ${intervalSec}s`);
  const map = await edgar.tickerMap();

  for (let cycle = 1; cycle <= cycles; cycle++) {
    checkCancel(jobId);
    let newCount = 0;
    for (const ticker of tickers) {
      checkCancel(jobId);
      const row = map.find((r) => r.ticker === ticker);
      if (!row) continue;
      try {
        const feed = await edgar.recentFilingsFeed(row.cik, undefined, 10);
        // lazily fetched submissions payload per company — only when a NEW
        // 8-K appears (the Atom feed carries no items; 4a events need them)
        let subs: any = null;
        for (const entry of feed) {
          if (!forms.includes(entry.form)) continue;
          const r = await db
            .insert(filings)
            .values({
              cik: entry.cik,
              accessionNo: entry.accessionNo,
              form: entry.form,
              filingDate: entry.filingDate,
              reportDate: null,
              primaryDoc: null,
            })
            .onDuplicateKeyUpdate({ set: { form: entry.form } });
          if (Number(r[0].affectedRows) === 1) {
            newCount++;
            await log(jobId, "info", `NEW FILING: ${ticker} ${entry.form} ${entry.accessionNo}`);
            // fill items for fresh 8-Ks so the events stream sees them now
            if (entry.form === "8-K") {
              try {
                subs = subs ?? (await edgar.submissions(entry.cik));
                const items = await edgar.itemsForFiling(entry.cik, entry.accessionNo, subs);
                if (items) {
                  await db.update(filings).set({ items }).where(and(eq(filings.cik, entry.cik), eq(filings.accessionNo, entry.accessionNo)));
                  if (items.includes("2.02")) await log(jobId, "info", `EARNINGS EVENT: ${ticker} 8-K Item 2.02 ${entry.accessionNo}`);
                }
              } catch (e2) {
                await log(jobId, "warn", `items fetch failed for ${entry.accessionNo} (non-fatal): ${errText(e2)}`);
              }
            }
          }
        }
      } catch (err) {
        await log(jobId, "warn", `Feed poll failed for ${ticker}: ${errText(err)}`);
      }
    }
    await setJob(jobId, { processed: cycle, message: `cycle ${cycle}/${cycles}: ${newCount} new filings` });
    await log(jobId, "info", `Cycle ${cycle}/${cycles} complete: ${newCount} new filings`);
    if (cycle < cycles) {
      const until = Date.now() + intervalSec * 1000;
      while (Date.now() < until) {
        checkCancel(jobId);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Stage 1.7 hook (D22): after the last stream cycle, top up daily price
  // bars for the same scope. Incremental and fully resumable — a daily
  // scheduled stream run thereby doubles as the price-accumulation driver.
  // Disable with withPrices=false (e.g. tight debug cycles).
  if (params.withPrices !== false) {
    try {
      await runPricesSync(jobId, tickers, { fullBackfill: false });
    } catch (err) {
      await log(jobId, "warn", `Price top-up failed (non-fatal): ${errText(err)}`);
    }
  }
  // 4a: new 8-Ks caught this run may carry Item 2.02 — rebuild events
  await rebuildEventsHook(jobId);
}

// ---------------------------------------------------------------------------
// Stage 1.7 job: historical daily prices (free providers, Stooq → Yahoo)
// ---------------------------------------------------------------------------
/**
 * Price sync over a resolved scope. Resumable BY CONSTRUCTION:
 *   - every company continues from MAX(date) already stored (services/prices),
 *     so a cancelled or rate-limited run loses nothing;
 *   - companies are processed stalest-first (never-synced before oldest),
 *     so re-running the same job always picks up the unfinished tail first;
 *   - already-current companies are skipped with a cheap DB-only check.
 * The SPY benchmark (cik=0) is synced first — beta and Stage 4+ relative
 * features depend on it.
 */
async function runPricesSync(
  jobId: number,
  tickers: string[],
  opts: { fullBackfill: boolean }
): Promise<void> {
  const { companiesByStaleness, syncCompanyPrices } = await import("./prices");
  const BENCH = { cik: 0, ticker: "SPY" };
  const pairs = await companiesByStaleness(tickers);
  await setJob(jobId, { total: pairs.length + 1 });
  await log(
    jobId,
    "info",
    `Price sync: ${pairs.length} companies + SPY benchmark, mode=${opts.fullBackfill ? "full backfill" : "incremental"}`,
  );

  const syncOne = async (cik: number, ticker: string) => {
    const r = await syncCompanyPrices(cik, ticker, { fullBackfill: opts.fullBackfill });
    if (r.bars > 0) {
      await log(jobId, "info", `${ticker}: +${r.bars} bars from ${r.source} (since ${r.from ?? "—"})`);
    }
    return r;
  };

  try {
    await syncOne(BENCH.cik, BENCH.ticker);
  } catch (err) {
    await log(jobId, "warn", `SPY benchmark sync failed (non-fatal): ${errText(err)}`);
  }

  let processed = 0;
  for (const p of pairs) {
    checkCancel(jobId);
    let hitNetwork = false;
    try {
      const r = await syncOne(p.cik, p.ticker);
      hitNetwork = r.source !== "none"; // "none" = already current, DB-only check
    } catch (err) {
      hitNetwork = true; // a failed sync still hit the network
      await log(jobId, "error", `Price sync failed for ${p.ticker}: ${errText(err)}`);
    }
    processed++;
    if (processed % 5 === 0 || processed === pairs.length) {
      await setJob(jobId, { processed: processed + 1, message: `${processed}/${pairs.length} companies` });
    }
    // fair-access pacing for free endpoints (stooq ~1 req/s sustained, yahoo
    // is 429-prone): 1.2 s only between companies that actually hit the
    // network — DB-only skips of already-current companies cost nothing
    if (hitNetwork) await new Promise((r) => setTimeout(r, 1200));
  }
}

async function runPrices(jobId: number, params: Record<string, unknown>, userId?: number) {
  // 3g bulk import (TEMPORARY CRUTCH, TODO full-history re-import later):
  // mode=import reads the owner-uploaded Stooq zip from object storage and
  // imports only universe tickers + SPY. Cloud egress to stooq/yahoo is
  // dead (connect timeouts from production), so this is the only live path.
  if (params.mode === "import") {
    const batch = String(params.batch ?? "");
    if (!/^[0-9a-f-]{36}$/.test(batch)) throw new Error("import mode requires a valid batch id");
    const { importPricesFromStorage } = await import("./price-import");
    await setJob(jobId, { total: 0, processed: 0 });
    const r = await importPricesFromStorage(
      batch,
      (level, message) => log(jobId, level, message),
      async (matched, bars, total) =>
        setJob(jobId, { processed: matched, total, message: `${matched}/${total} tickers, ${bars.toLocaleString()} bars` }),
      () => cancelFlags.get(jobId)?.cancelled === true,
    );
    await log(
      jobId,
      "info",
      `Import finished: ${r.filesMatched}/${r.filesWanted} tickers, ${r.barsWritten.toLocaleString()} bars` +
        (r.missing.length ? `; missing in archive: ${r.missing.join(", ")}` : ""),
    );
    return;
  }
  const tickers = await resolveTickers(params, jobId, userId);
  await runPricesSync(jobId, tickers, { fullBackfill: params.mode === "backfill" });
}
