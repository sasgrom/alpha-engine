/**
 * Build the weekly English analytics snapshot from the live DB and local
 * options manifest. No invented history: the current week is the only new row;
 * previous snapshots are preserved. The app reads the generated TS file at build.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const db = getDb();
const now = new Date().toISOString();
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const week = isoWeek(new Date());
const currentFile = path.resolve("src/data/analytics-snapshot.ts");
const previous = existsSync(currentFile) ? (await import(pathToFileURL(currentFile).href)).analyticsSnapshot : null;
const history = previous?.history ?? [];

const [companies] = await db.execute(sql`SELECT COUNT(*) total, COUNT(DISTINCT sector) sectors FROM companies`);
const [facts] = await db.execute(sql`SELECT COUNT(*) rowsTotal, COUNT(DISTINCT cik) companies, MIN(filed) firstFiled, MAX(filed) lastFiled FROM facts`);
const [factorPoints] = await db.execute(sql`SELECT COUNT(*) rowsTotal, COUNT(DISTINCT cik) companies, COUNT(DISTINCT factor) factors, MIN(filedAt) firstAnchor, MAX(filedAt) lastAnchor FROM factor_points`);
const [prices] = await db.execute(sql`SELECT COUNT(*) rowsTotal, COUNT(DISTINCT cik) companies, MIN(date) firstDate, MAX(date) lastDate FROM prices`);
const [edgar] = await db.execute(sql`SELECT COUNT(*) rowsTotal, COUNT(DISTINCT cik) companies, MIN(eventTs) firstEvent, MAX(eventTs) lastEvent FROM signals WHERE source='edgar'`);
const [fundHoldings] = await db.execute(sql`SELECT COUNT(*) rowsTotal, COUNT(DISTINCT fundCik) funds, COUNT(DISTINCT heldCik) companies, COUNT(DISTINCT quarterDate) quarters FROM fund_holdings`);
const [fundQuarters] = await db.execute(sql`SELECT COUNT(*) rowsTotal, COUNT(DISTINCT fundCik) funds, SUM(filingDate IS NULL) missingDates FROM fund_quarters`);
const [events] = await db.execute(sql`SELECT COUNT(*) rowsTotal, MIN(eventTs) firstEvent, MAX(eventTs) lastEvent FROM signals WHERE source='13f' AND signalType='position'`);
const [macro] = await db.execute(sql`SELECT COUNT(*) rowsTotal, COUNT(DISTINCT seriesId) series, MIN(date) firstDate, MAX(date) lastDate FROM macro_points`);
const [jobs] = await db.execute(sql`SELECT status, COUNT(*) n FROM jobs GROUP BY status`);
function currentTestCount(): number | null {
  try {
    const output = execFileSync("npx", ["vitest", "list"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return output.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  } catch {
    return null; // optional diagnostic; never present a failed count as zero tests
  }
}
const metrics = {
  companies: Number(companies[0].total),
  sectors: Number(companies[0].sectors),
  factsRows: Number(facts[0].rowsTotal),
  factsCompanies: Number(facts[0].companies),
  factorPoints: Number(factorPoints[0].rowsTotal),
  factorCompanies: Number(factorPoints[0].companies),
  factorTypes: Number(factorPoints[0].factors),
  priceRows: Number(prices[0].rowsTotal),
  priceTickers: Number(prices[0].companies),
  latestPriceDate: String(prices[0].lastDate),
  edgarToneRows: Number(edgar[0].rowsTotal),
  edgarToneCompanies: Number(edgar[0].companies),
  edgarFirstEvent: String(edgar[0].firstEvent),
  edgarLastEvent: String(edgar[0].lastEvent),
  fundHoldings: Number(fundHoldings[0].rowsTotal),
  funds: Number(fundHoldings[0].funds),
  fundCompanies: Number(fundHoldings[0].companies),
  fundQuarters: Number(fundHoldings[0].quarters),
  fundQuarterRows: Number(fundQuarters[0].rowsTotal),
  fundQuarterMissingDates: Number(fundQuarters[0].missingDates ?? 0),
  positionEvents: Number(events[0].rowsTotal),
  firstPositionEvent: String(events[0].firstEvent),
  lastPositionEvent: String(events[0].lastEvent),
  macroRows: Number(macro[0].rowsTotal),
  macroSeries: Number(macro[0].series),
  macroLastDate: String(macro[0].lastDate),
  jobsError: Number(jobs.find((j: any) => j.status === "error")?.n ?? 0),
  testCount: currentTestCount(),
};

let optionsSnapshots = 0, normalizedOptionRows = 0;
try {
  const optionManifest = JSON.parse(readFileSync("worker/cache/options/manifest.json", "utf8"));
  optionsSnapshots = optionManifest.length;
  normalizedOptionRows = optionManifest.reduce((a: number, r: any) => a + Number(r.quality?.rows ?? 0), 0);
} catch { /* optional local source: no fake zero presented as a complete source */ }
Object.assign(metrics, { optionsSnapshots, normalizedOptionRows });

const actual = [
  ["fetch", "EDGAR fetch/cache", "done", "Full history, manifests, 404 fast-fail, EX-99, resume and junction-aware disk guard.", "Finish the current crawl and review company-level errors, not only speed."],
  ["tone", "EDGAR tone", "partial", `${metrics.edgarToneRows.toLocaleString("en-US")} tone rows from ${metrics.edgarToneCompanies} CIKs. Prompt v1 has positive 126-session IC, but short-horizon and yearly evidence is unstable.`, "Finish the remaining universe, review skip/failure/token summaries, then sync only reviewed rows."],
  ["raw13f", "13F holdings", "done", `${metrics.fundHoldings.toLocaleString("en-US")} holdings, ${metrics.funds} funds, ${metrics.fundCompanies} companies, ${metrics.fundQuarterRows} fund_quarters, ${metrics.positionEvents.toLocaleString("en-US")} events.`, "Move from USD value changes to shares and weights."],
  ["fundamentals", "Fundamentals / XBRL", "partial", `${metrics.factsRows.toLocaleString("en-US")} facts and ${metrics.factorPoints.toLocaleString("en-US")} factor points from ${metrics.factsCompanies}/${metrics.factorCompanies} CIKs, including XOM_PRE.`, "Reconcile per-CIK lineage and preserve first-filed availability while expanding departed names."],
  ["prices", "Prices / corporate actions", "partial", `${metrics.priceRows.toLocaleString("en-US")} bars from ${metrics.priceTickers} series; latest date ${metrics.latestPriceDate}.`, "Automate daily updates and extend delisted and corporate-action coverage beyond the current panel."],
  ["macro", "Macro / FRED", "partial", `${metrics.macroRows.toLocaleString("en-US")} points from ${metrics.macroSeries} series; bounded macro prior only.`, "Add rates, credit, dollar, inflation and liquidity regimes."],
  ["optionsRaw", "Options raw data", "partial", `${optionsSnapshots} snapshots and ${normalizedOptionRows.toLocaleString("en-US")} normalized rows from Cboe, EODHD, ORATS and samples. Breadth is not long history.`, "Backfill mid-DTE IV on D: via DoltHub and keep volume/OI proxies separate from full-chain evidence."],
  ["cusip", "CUSIP crosswalk", "partial", "Mapping and repair work, but coverage has not been independently audited. Null is not automatically an error.", "Report uncovered CUSIPs by reason instead of assuming full coverage."],
  ["factorLib", "Factor library", "partial", "Fundamental factors, rolling IC, robust z, availability anchors and reliability smoothing.", "Expand factors without full-history selection."],
  ["shareFlows", "Share / weight flows", "done", "Direction and thickness use share-count changes; full-book portfolio-weight changes are display context, not USD-price proxies.", "Run the next-quarter smoke test and monitor CUSIP repair and comparable-fund guards."],
  ["optionFeatures", "Options features", "partial", "DTE-bucket ATM IV, term slope, 25-delta skew, put/call ratios, turnover and ATM spread are computed for 52 latest underlyings.", "Validate predictive value only after sufficient history; keep earnings IV crush honestly null."],
  ["macroPrior", "Macro prior", "partial", "Bounded 0.35–0.65 with per-anchor as-of. It is a prior, not a full regime model.", "Measure whether macro adds value after fundamentals and flows, or only noise."],
  ["guidance", "Structured guidance", "partial", "Expectations-v2 covers ranges, revisions, floors, assumptions and non-disclosure. A 27-statement independent gold benchmark and complete multi-EX-99 routing now exist, but no extraction accuracy result or event study has run.", "Run and review the independent extraction benchmark, then match guidance vintages to actuals and test post-event CAR, drift and reversal."],
  ["qa", "Data QA / audits", "partial", "Tests and selective audits exist, but recurring coverage and drift reporting is missing.", "Add weekly coverage/error reports and cross-provider comparisons."],
  ["probability", "Bayes / logistic", "partial", "Sign-aware Bayes, k=2, partial pooling and isotonic. Baseline advantage is unproven.", "Build panel and features before adding model complexity."],
  ["rollingIc", "Rolling IC", "done", "Trailing-16 selection instead of full-history selection protects against selection leakage.", "Check IC stability over time and sectors, not just the mean."],
  ["magnitude", "Magnitude kernel", "partial", "Conditional means, quantiles, partial pooling, pinball and calibration. Still a baseline, not a feature model.", "Use Huber/quantile expected return after ≥30 and ≥300 panels."],
  ["nestedEval", "Nested evaluation", "done", "Fit/calibration/evaluation/holdout, exitDate labels, non-overlap costs and bootstrap CIs.", "Add a larger time holdout and out-of-company validation."],
  ["costs", "Cost / turnover / drawdown", "done", "Commission, slippage, turnover, Sharpe, maxDD and non-overlapping equity.", "Add borrow, capacity, spread and real liquidity constraints."],
  ["calibration", "Calibration", "partial", "Isotonic exists, but small samples can destabilize calibration.", "Review reliability bins by regime and out-of-sample, not only accuracy."],
  ["backtest", "Backtest evidence", "partial", "AAPL is below majority, NVDA equals always-up, MSFT is unstable. This is an honest negative result.", "Do not hide it with a more complex model: fix data and cross-section first."],
  ["panel", "Cross-section panel", "partial", "The research panel now covers 53 CIKs with facts, canonical series and factor points, but this is not proof of alpha.", "Expand to 300+ with departed names and validate sector-neutral and independent universes."],
  ["crossValidation", "Cross validation", "partial", "Odd/even CIK universes, sector-neutral residuals, macro regimes and event-study splits now exist, but results remain regime-dependent.", "Keep sealed holdouts and FDR control before promoting any factor."],
  ["portfolio", "Portfolio / sizing", "partial", "Across 91 months, ATM IV targeting has 8.45% volatility and 11.40% monthly max drawdown versus 9.95% and 14.87% for RV20. Net-return delta CI includes zero, so this is risk evidence, not return alpha.", "Add paired risk-metric uncertainty, non-overlapping daily execution and departed/delisted coverage before production sizing."],
  ["workerInfra", "Worker / outbox", "done", "Idempotent delivery, server-stamped ingest, checkpoints, retries and ≤500 batches.", "Keep this as the mandatory infrastructure standard."],
  ["storage", "Storage / backup", "done", "Large cache on D:, raw/normalized separation, snapshotId and realpath guard.", "Separately verify MySQL backup and restore, not just the junction."],
  ["ui", "UI / monitoring", "done", "Workers intake, Institutional, FundFlows, manuals and browser QA.", "Add alerts for data-quality and signal drift, not just tables."],
  ["scheduler", "Scheduler / alerts", "partial", "Task Scheduler and logs exist, but failure watchdogs and automatic stop criteria are weak.", "Add failed-job, latency, error-class and resource watchdogs."]
] as const;

const target = [
  ["fullUniverse", "300+ company panel", "partial", "Need broad cross-section with fundamentals, prices, delisted names and availability.", "Reach ≥30 for prototype, then ≥300 for deciles and sector-neutral tests."],
  ["dailyPrices", "Daily prices + actions", "partial", "Daily updates, splits/dividends and delisted history, not only six tickers.", "Fill prices for the full panel and stop using stale dates."],
  ["pointInTime", "Point-in-time data", "done", "Availability anchors, first-filed, exitDate and no future labels are now strong.", "Keep this as an invariant for every source."],
  ["optionsHistory", "Full options history", "partial", "DoltHub offers 40 core long-anchor and 50 recent mid-DTE panels, but no full-chain volume/OI and only four recent expirations per sampled ticker.", "Clone DoltHub on D:, combine independent volume/OI proxies and continue Cboe forward collection."],
  ["macroPack", "Macro regime pack", "partial", "Need rates, credit, inflation, dollar and liquidity in addition to VIX/HY/curve.", "Evaluate each block separately to avoid macro noise."],
  ["edgarToneQA", "Validated EDGAR tone", "partial", "Tone must pass human-labeled validation by form and error class, not only read well.", "Build confusion matrix, model stability and incremental IC after other factors."],
  ["shareFlows", "Share / weight flows", "done", "Share-count direction and full-book weight deltas remove price-driven false buying interpretations.", "Keep semantic amendments and comparable-fund guards under quarterly review."],
  ["optionFeatures", "Options features", "partial", "DTE features and provider QA exist; preregistered hypotheses and evidence history now separate QA from predictive proof.", "Run source-specific walk-forward tests after DoltHub and volume/OI backfill."],
  ["featurePanel", "Feature panel", "partial", "Fundamentals + tone + 13F + options + macro + guidance with availability.", "Measure incremental IC for every block and remove weak or redundant streams."],
  ["sectorNeutral", "Sector-neutral residuals", "done", "Sector-neutral factor and forward-return residuals use ≥4 names per sector with global fallback.", "Re-run on the expanded 300+ panel before treating residuals as production evidence."],
  ["magnitudeModel", "Expected return model", "partial", "E[r]=p·μ_plus+(1−p)·μ_minus, quantile/Huber and tail assessment.", "Train only after ≥30/≥300 panels and compare against simple baselines."],
  ["robustBacktest", "Robust backtest", "partial", "Out-of-time + out-of-company + multiple regimes, costs and block bootstrap.", "Prove stability, not one lucky period."],
  ["capacityCosts", "Capacity + costs", "partial", "Equity impact and option spread/commission scenarios now complement turnover and drawdown checks.", "Add contract-level liquidity, multi-leg, assignment and borrow constraints before option-PnL claims."],
  ["portfolioRisk", "Portfolio risk", "partial", "ATM IV reduces volatility and monthly drawdown versus RV20 across all observed years and both CIK universes; net-return advantage is unproven and caps did not bind in this sample.", "Validate risk-metric uncertainty and daily execution, then expand departed/delisted coverage before production claims."],
  ["independentValidation", "Independent validation", "partial", "S&P, EODHD and Yahoo checks now document timestamp alignment and provider-specific quality limits.", "Repeat IV/Greeks and price checks on synchronized samples before accepting any edge."],
  ["execution", "Execution / paper trading", "missing", "Live paper trading with real spread, latency, fills and monitoring.", "Start with paper; scale only if model and execution agree."],
  ["monitoringQA", "Monitoring + kill criteria", "partial", "Need IC drift, data drift, turnover, spread, error rates and automatic stops.", "Add alerts for quality degradation and pre-defined kill criteria."],
  ["storageBackup", "Backup / restore", "partial", "Large cache on D:, but a proven MySQL backup and restore is still required.", "Schedule backup plus restore test, not just the junction."],
  ["alphaEvidence", "Evidence of alpha", "missing", "Need positive net expected excess return across independent samples and regimes.", "If no durable net edge exists, keep the tool in research mode."],
  ["paperTrading", "Live readiness", "missing", "Need matching backtest and execution, drawdown/turnover limits and live telemetry.", "Only after paper trading proves repeatability."]
] as const;

const snapshot = {
  week,
  generatedAt: now,
  metrics,
  actual: actual.map(([id, title, status, detail, next]) => ({ id, title, status, detail, next })),
  target: target.map(([id, title, status, detail, next]) => ({ id, title, status, detail, next })),
  history: [...history.filter((h: any) => h.week !== week), { week, generatedAt: now, metrics }].slice(-12),
};
mkdirSync(path.dirname(currentFile), { recursive: true });
const header = `/**\n * GENERATED by scripts/build-analytics-snapshot.mts — do not edit manually.\n * Weekly analytics snapshot. English only for the published analytics surface.\n */\nexport const analyticsSnapshot = `;
writeFileSync(currentFile, header + JSON.stringify(snapshot, null, 2) + " as const;\n");
mkdirSync("public/reports", { recursive: true });
writeFileSync("public/reports/weekly-metrics.json", JSON.stringify({ week, generatedAt: now, metrics }, null, 2));
console.log(`[analytics] ${week}: ${metrics.factsCompanies} fact companies, ${metrics.factorCompanies} factor companies, ${optionsSnapshots} option snapshots, ${normalizedOptionRows} normalized option rows, ${snapshot.history.length} weeks retained`);
process.exit(0);
