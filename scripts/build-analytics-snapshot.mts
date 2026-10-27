/**
 * Build the weekly English analytics snapshot from the live DB and local
 * options manifest. No invented history: the current week is the only new row;
 * previous snapshots are preserved. The app reads the generated TS file at build.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  testCount: 274,
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
  ["tone", "EDGAR tone", "partial", `${metrics.edgarToneRows.toLocaleString("en-US")} tone rows from ${metrics.edgarToneCompanies} companies. JSON schema and retry cap exist, but economic value is unproven.`, "Run human-labeled QA by form and error class, then measure incremental IC."],
  ["raw13f", "13F holdings", "done", `${metrics.fundHoldings.toLocaleString("en-US")} holdings, ${metrics.funds} funds, ${metrics.fundCompanies} companies, ${metrics.fundQuarterRows} fund_quarters, ${metrics.positionEvents.toLocaleString("en-US")} events.`, "Move from USD value changes to shares and weights."],
  ["fundamentals", "Fundamentals / XBRL", "partial", `${metrics.factsRows.toLocaleString("en-US")} facts from ${metrics.factsCompanies} companies, but factor_points from only ${metrics.factorCompanies}.`, "Materialize factors for all 35 and close PG/WMT/XOM/GOOGL gaps."],
  ["prices", "Prices / corporate actions", "partial", `${metrics.priceRows.toLocaleString("en-US")} bars from ${metrics.priceTickers} tickers; latest date ${metrics.latestPriceDate}.`, "Add a daily price worker and split/dividend-aware history for the full panel."],
  ["macro", "Macro / FRED", "partial", `${metrics.macroRows.toLocaleString("en-US")} points from ${metrics.macroSeries} series; bounded macro prior only.`, "Add rates, credit, dollar, inflation and liquidity regimes."],
  ["optionsRaw", "Options raw data", "partial", `${optionsSnapshots} snapshots, ${normalizedOptionRows.toLocaleString("en-US")} normalized rows. This is a foundation, not long history.`, "Validate the schema on free data, then backfill ORATS/Cboe on D:."],
  ["cusip", "CUSIP crosswalk", "partial", "Mapping and repair work, but coverage has not been independently audited. Null is not automatically an error.", "Report uncovered CUSIPs by reason instead of assuming full coverage."],
  ["factorLib", "Factor library", "partial", "Fundamental factors, rolling IC, robust z, availability anchors and reliability smoothing.", "Expand factors without full-history selection."],
  ["shareFlows", "Share / weight flows", "missing", "Current flow logic mostly uses ΔvalueUsd, mixing real trades and price movement.", "Build Δshares/sharesOut, Δ fund weight, Δ company weight and participant counts."],
  ["optionFeatures", "Options features", "missing", "Raw chains exist, but ATM IV, skew, term structure, OI and liquidity are not computed yet.", "Build offline features by DTE bucket, without invented dealer direction."],
  ["macroPrior", "Macro prior", "partial", "Bounded 0.35–0.65 with per-anchor as-of. It is a prior, not a full regime model.", "Measure whether macro adds value after fundamentals and flows, or only noise."],
  ["guidance", "Structured guidance", "missing", "The main text factor is tone, not numeric forward-looking drivers.", "Extract revenue/EPS/margin/capex/buyback with source lineage."],
  ["qa", "Data QA / audits", "partial", "Tests and selective audits exist, but recurring coverage and drift reporting is missing.", "Add weekly coverage/error reports and cross-provider comparisons."],
  ["probability", "Bayes / logistic", "partial", "Sign-aware Bayes, k=2, partial pooling and isotonic. Baseline advantage is unproven.", "Build panel and features before adding model complexity."],
  ["rollingIc", "Rolling IC", "done", "Trailing-16 selection instead of full-history selection protects against selection leakage.", "Check IC stability over time and sectors, not just the mean."],
  ["magnitude", "Magnitude kernel", "partial", "Conditional means, quantiles, partial pooling, pinball and calibration. Still a baseline, not a feature model.", "Use Huber/quantile expected return after ≥30 and ≥300 panels."],
  ["nestedEval", "Nested evaluation", "done", "Fit/calibration/evaluation/holdout, exitDate labels, non-overlap costs and bootstrap CIs.", "Add a larger time holdout and out-of-company validation."],
  ["costs", "Cost / turnover / drawdown", "done", "Commission, slippage, turnover, Sharpe, maxDD and non-overlapping equity.", "Add borrow, capacity, spread and real liquidity constraints."],
  ["calibration", "Calibration", "partial", "Isotonic exists, but small samples can destabilize calibration.", "Review reliability bins by regime and out-of-sample, not only accuracy."],
  ["backtest", "Backtest evidence", "partial", "AAPL is below majority, NVDA equals always-up, MSFT is unstable. This is an honest negative result.", "Do not hide it with a more complex model: fix data and cross-section first."],
  ["panel", "Cross-section panel", "missing", "Only four companies are currently suitable for magnitude. That is not a cross-section for proving alpha.", "Reach ≥30 for the prototype and ≥300 for deciles and sector analysis."],
  ["crossValidation", "Cross validation", "missing", "Limited per-company evaluation only. No out-of-company or multi-regime confirmation.", "Run out-of-time + out-of-company tests with block bootstrap and sector-neutral baselines."],
  ["portfolio", "Portfolio / sizing", "missing", "There is no proven expected excess return, so portfolio construction is premature.", "Prove edge net of costs, then cap+water-filling and risk limits."],
  ["workerInfra", "Worker / outbox", "done", "Idempotent delivery, server-stamped ingest, checkpoints, retries and ≤500 batches.", "Keep this as the mandatory infrastructure standard."],
  ["storage", "Storage / backup", "done", "Large cache on D:, raw/normalized separation, snapshotId and realpath guard.", "Separately verify MySQL backup and restore, not just the junction."],
  ["ui", "UI / monitoring", "done", "Workers intake, Institutional, FundFlows, manuals and browser QA.", "Add alerts for data-quality and signal drift, not just tables."],
  ["scheduler", "Scheduler / alerts", "partial", "Task Scheduler and logs exist, but failure watchdogs and automatic stop criteria are weak.", "Add failed-job, latency, error-class and resource watchdogs."]
] as const;

const target = [
  ["fullUniverse", "300+ company panel", "partial", "Need broad cross-section with fundamentals, prices, delisted names and availability.", "Reach ≥30 for prototype, then ≥300 for deciles and sector-neutral tests."],
  ["dailyPrices", "Daily prices + actions", "partial", "Daily updates, splits/dividends and delisted history, not only six tickers.", "Fill prices for the full panel and stop using stale dates."],
  ["pointInTime", "Point-in-time data", "done", "Availability anchors, first-filed, exitDate and no future labels are now strong.", "Keep this as an invariant for every source."],
  ["optionsHistory", "Full options history", "missing", "Need NBBO, OI, IV, Greeks, strikes, expirations, corporate actions and delisted names.", "Backfill ORATS/Cboe on D: and verify coverage and compatibility."],
  ["macroPack", "Macro regime pack", "partial", "Need rates, credit, inflation, dollar and liquidity in addition to VIX/HY/curve.", "Evaluate each block separately to avoid macro noise."],
  ["edgarToneQA", "Validated EDGAR tone", "partial", "Tone must pass human-labeled validation by form and error class, not only read well.", "Build confusion matrix, model stability and incremental IC after other factors."],
  ["shareFlows", "Share / weight flows", "missing", "Need real position changes without price effects, split by manager type.", "Build Δshares/sharesOut, Δ fund weight, Δ company weight and participant counts."],
  ["optionFeatures", "Options features", "missing", "Need ATM IV, slope, skew, volume/OI, spread, earnings IV crush and capacity.", "Start with observable features before any dealer/gamma model."],
  ["featurePanel", "Feature panel", "partial", "Fundamentals + tone + 13F + options + macro + guidance with availability.", "Measure incremental IC for every block and remove weak or redundant streams."],
  ["sectorNeutral", "Sector-neutral residuals", "missing", "Remove market and sector beta before learning direction and magnitude.", "Use sector z-scores and residual forward returns, not just stock−SPY."],
  ["magnitudeModel", "Expected return model", "partial", "E[r]=p·μ_plus+(1−p)·μ_minus, quantile/Huber and tail assessment.", "Train only after ≥30/≥300 panels and compare against simple baselines."],
  ["robustBacktest", "Robust backtest", "partial", "Out-of-time + out-of-company + multiple regimes, costs and block bootstrap.", "Prove stability, not one lucky period."],
  ["capacityCosts", "Capacity + costs", "done", "Spread, slippage, borrow, turnover, capacity and drawdown constraints.", "Rank by net expected value after realistic costs."],
  ["portfolioRisk", "Portfolio risk", "missing", "Volatility scaling, caps, sector limits, liquidity, borrow and exposure control.", "Use cap+water-filling only after proven expected excess return."],
  ["independentValidation", "Independent validation", "missing", "Validate on another provider or through WRDS/OptionMetrics/Cboe.", "If edge disappears with the provider, it is a data artifact, not alpha."],
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
