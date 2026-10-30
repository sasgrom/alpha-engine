/** Preregistered monthly ATM IV versus RV20 name-level volatility targeting. */
import "dotenv/config";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { forwardReturnInfo } from "../api/services/ic";
import { blockBootstrapWeightedCi, trailingRealizedVolatility } from "../api/services/forward-volatility";
import {
  simulateVolTarget,
  summarizeVolTarget,
  type VolTargetPeriod,
  type VolTargetPeriodResult,
} from "../api/services/volatility-target";
import { loadEdgarUniverse } from "./lib/edgar";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";
import type { OptionFeatureSet } from "./lib/option-features";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const numericArg = (name: string, fallback: number) => {
  const value = Number(arg(name) ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}`);
  return value;
};
const only = arg("--only")?.toUpperCase() ?? null;
const inputRoot = path.resolve(arg("--input") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv-features" : "worker/cache/options-dolthub/features"));
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv-research" : "worker/cache/options-dolthub/research"));
const currentYear = new Date().getUTCFullYear();
const explicitYears = arg("--years")?.split(",").map(Number).filter(Number.isInteger);
const fromYear = numericArg("--from-year", 2019), toYear = numericArg("--to-year", currentYear);
const years = explicitYears?.length ? explicitYears : Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
const protocolPath = path.resolve(arg("--protocol") ?? "research/vol-target-protocol.json");
const protocolBytes = readFileSync(protocolPath);
const protocol = JSON.parse(protocolBytes.toString("utf8")) as {
  protocolId: string;
  policy: { targetVol: number; minScalar: number; maxScalar: number; sectorCap: number; participationRate: number; portfolioNotional: number; baseCostBps: number };
};
const protocolSha256 = createHash("sha256").update(protocolBytes).digest("hex");
const policy = {
  targetVol: protocol.policy.targetVol,
  minScalar: protocol.policy.minScalar,
  maxScalar: protocol.policy.maxScalar,
  sectorCap: protocol.policy.sectorCap,
  participationRate: protocol.policy.participationRate,
  portfolioNotional: protocol.policy.portfolioNotional,
};
const baseCostBps = protocol.policy.baseCostBps;
if (!(policy.targetVol > 0) || !(policy.portfolioNotional > 0) || baseCostBps < 0) throw new Error("Target vol and notional must be positive; cost cannot be negative");
const prog = startProgress("dolthub-vol-target", `input ${inputRoot} · years ${years.join(",")}`);
const manifest = JSON.parse(readFileSync(path.join(inputRoot, "manifest.json"), "utf8")) as { batches: { ticker: string; year: number; status: string }[] };
const universe = loadEdgarUniverse("dolthub-universe-40.json").filter((company) => !only || company.ticker === only);
if (only && !universe.length) throw new Error(`Unknown or non-core ticker ${only}`);
const cikByTicker = new Map(universe.map((company) => [company.ticker, company.cik]));
const batches = manifest.batches.filter((batch) => batch.status === "done" && cikByTicker.has(batch.ticker) && years.includes(batch.year));
const db = getDb();
const [companyRows]: any = await db.execute(sql`SELECT cik, sector FROM companies`);
const sectorByCik = new Map<number, string>(companyRows.map((row: any) => [Number(row.cik), String(row.sector ?? "Unknown")]));

interface PriceBar { date: string; close: number; rawClose: number; volume: number | null }
interface Sample {
  cik: number;
  ticker: string;
  sector: string;
  date: string;
  exitDate: string;
  bucket: string;
  dte: number;
  atmIv: number;
  rv20: number;
  forwardReturn: number;
  advDollar: number;
}
type Model = "equalWeight" | "rv20" | "atmIv";

const barCache = new Map<number, PriceBar[]>();
async function bars(cik: number): Promise<PriceBar[]> {
  const cached = barCache.get(cik);
  if (cached) return cached;
  const [rows]: any = await db.execute(sql`SELECT date, close, adjClose, volume FROM prices WHERE cik=${cik} ORDER BY date`);
  const result = rows.map((row: any) => ({
    date: String(row.date).slice(0, 10),
    close: Number(row.adjClose ?? row.close),
    rawClose: Number(row.close),
    volume: row.volume === null || row.volume === undefined ? null : Number(row.volume),
  })).filter((row: PriceBar) => Number.isFinite(row.close) && row.close > 0 && Number.isFinite(row.rawClose) && row.rawClose > 0);
  barCache.set(cik, result);
  return result;
}

/** ADV uses only raw closes and volumes available by the option snapshot date. */
function trailingDollarAdv(stockBars: PriceBar[], anchorDate: string, window = 20): number | null {
  const firstAfter = stockBars.findIndex((bar) => bar.date > anchorDate);
  const end = firstAfter < 0 ? stockBars.length : firstAfter;
  const values = stockBars.slice(Math.max(0, end - window), end)
    .map((bar) => bar.volume === null ? null : bar.rawClose * bar.volume)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  if (end < window || values.length !== window) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Keep only the latest chain per ticker/month. This bounds overlap and prevents
// high-frequency chain availability from silently becoming more backtest weight.
const monthly = new Map<string, { ticker: string; cik: number; feature: OptionFeatureSet }>();
let snapshots = 0;
for (const batch of batches) {
  const file = path.join(inputRoot, batch.ticker, `${batch.year}.jsonl`);
  const input = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    snapshots++;
    const feature = JSON.parse(line) as OptionFeatureSet;
    const key = `${batch.ticker}|${feature.tradeDate.slice(0, 7)}`;
    const previous = monthly.get(key);
    if (!previous || feature.tradeDate > previous.feature.tradeDate) {
      monthly.set(key, { ticker: batch.ticker, cik: cikByTicker.get(batch.ticker)!, feature });
    }
  }
  prog.log(`${batch.ticker} ${batch.year}: scanned`);
}

const samples: Sample[] = [];
const exclusions: Record<string, number> = { missingBucket: 0, invalidAtmIv: 0, missingDte: 0, missingRv20: 0, missingForwardLabel: 0, missingAdv20: 0 };
for (const { ticker, cik, feature } of [...monthly.values()].sort((a, b) => a.feature.tradeDate.localeCompare(b.feature.tradeDate))) {
  const stockBars = await bars(cik);
  const bucket = ["31-90D", "8-30D"].map((name) => feature.buckets.find((item) => item.bucket === name)).find(Boolean);
  const rv20 = trailingRealizedVolatility(stockBars, feature.tradeDate, 20);
  // A next-close entry is mandatory: the EOD option chain is not assumed to be
  // executable at the same close. The 21-session label uses the shared median
  // exit convention and carries its own availability date.
  const forward = forwardReturnInfo(stockBars, feature.tradeDate, 21);
  const advDollar = trailingDollarAdv(stockBars, feature.tradeDate, 20);
  const exclusion = !bucket ? "missingBucket"
    : bucket.atmIv === null || bucket.atmIv <= 0 ? "invalidAtmIv"
      : bucket.dteMedian === null || bucket.dteMedian <= 0 ? "missingDte"
        : rv20 === null || rv20 <= 0 ? "missingRv20"
          : !forward ? "missingForwardLabel"
            : advDollar === null ? "missingAdv20" : null;
  if (exclusion) {
    exclusions[exclusion]++;
    continue;
  }
  samples.push({
    cik, ticker, sector: sectorByCik.get(cik) ?? "Unknown",
    date: feature.tradeDate.slice(0, 7), exitDate: forward.exitDate,
    bucket: bucket.bucket, dte: bucket.dteMedian, atmIv: bucket.atmIv, rv20,
    forwardReturn: forward.ret, advDollar,
  });
}

function modelPeriods(source: Sample[], model: Model): VolTargetPeriod[] {
  const grouped = new Map<string, Sample[]>();
  for (const sample of source) {
    if (!grouped.has(sample.date)) grouped.set(sample.date, []);
    grouped.get(sample.date)!.push(sample);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
    .filter(([, rows]) => rows.length >= 5)
    .map(([date, rows]) => ({
      date,
      rows: rows.map((row) => ({
        cik: row.cik,
        ticker: row.ticker,
        sector: row.sector,
        forecastVol: model === "atmIv" ? row.atmIv : model === "rv20" ? row.rv20 : policy.targetVol,
        forwardReturn: row.forwardReturn,
        advDollar: row.advDollar,
      })),
    }));
}

function pairedDelta(atm: VolTargetPeriodResult[], rv: VolTargetPeriodResult[]) {
  const rvByDate = new Map(rv.map((row) => [row.date, row]));
  const deltas = atm.flatMap((row) => {
    const baseline = rvByDate.get(row.date);
    return baseline ? [{ date: row.date, value: row.netReturn - baseline.netReturn }] : [];
  });
  return {
    months: deltas.length,
    meanMonthlyNetReturn: deltas.length ? deltas.reduce((sum, row) => sum + row.value, 0) / deltas.length : null,
    ci95: blockBootstrapWeightedCi(deltas.map((row) => ({ value: row.value, weight: 1 })), 4),
    positiveShare: deltas.length ? deltas.filter((row) => row.value > 0).length / deltas.length : null,
  };
}

function evaluate(source: Sample[], includeSeries = false) {
  const simulated = Object.fromEntries((["equalWeight", "rv20", "atmIv"] as Model[]).map((model) => [model, simulateVolTarget(modelPeriods(source, model), policy, baseCostBps)])) as Record<Model, VolTargetPeriodResult[]>;
  return {
    models: Object.fromEntries((["equalWeight", "rv20", "atmIv"] as Model[]).map((model) => [model, {
      ...summarizeVolTarget(simulated[model]),
      ...(includeSeries ? { series: simulated[model] } : {}),
    }])),
    atmIvMinusRv20: pairedDelta(simulated.atmIv, simulated.rv20),
  };
}

if (!samples.length) throw new Error("No usable monthly volatility-target samples; rerun schema-v2 features and verify price/ADV coverage");
const windows = {
  discovery: samples.filter((row) => row.date >= "2019-01" && row.date <= "2023-12"),
  validation: samples.filter((row) => row.date >= "2024-01" && row.date <= "2025-12"),
  sealedHoldout: samples.filter((row) => row.date >= "2026-01"),
};
const costSensitivity = Object.fromEntries([...new Set([5, 20, 50, baseCostBps])].sort((a, b) => a - b).map((costBps) => [String(costBps), Object.fromEntries((["equalWeight", "rv20", "atmIv"] as Model[]).map((model) => [model, summarizeVolTarget(simulateVolTarget(modelPeriods(samples, model), policy, costBps))]))]));
const output = {
  generatedAt: new Date().toISOString(),
  protocol: protocol.protocolId,
  protocolPath,
  protocolSha256,
  runType: only ? "single-ticker-diagnostic" : "preregistered",
  scope: "Monthly latest-chain cross-section; next-close entry; name-level scalar with cash, sector/liquidity caps and explicit weight-change costs. This is not a portfolio-volatility guarantee or directional-alpha claim.",
  policy: { ...policy, baseCostBps, holdingSessions: 21, advSessions: 20, minimumNamesPerMonth: 5 },
  availability: "Option snapshot at tradeDate EOD; entry strictly after tradeDate; RV20 and ADV use closes on or before tradeDate; forward label has exitDate.",
  priceBasis: "Adjusted close for returns; raw close × volume for ADV; USD; long-only with residual cash.",
  biasChecks: {
    lookAhead: "pass_by_construction_next_close_entry",
    survivorship: "limited_current_universe_departed_and_delisted_names_required",
    liquidity: "pass_missing_adv_fails_closed_and_caps_reduce_weight",
    delistedNames: "not_covered_production_claim_blocked",
    executionFeasibility: "close_only_research_estimate_no_auction_queue_or_intraday_slippage",
    parameterTuning: "not_permitted_under_frozen_protocol",
  },
  snapshots,
  monthlyCandidates: monthly.size,
  usableSamples: samples.length,
  exclusions,
  tickers: new Set(samples.map((row) => row.ticker)).size,
  sampleExitDateMax: samples.map((row) => row.exitDate).sort().at(-1),
  overall: evaluate(samples, true),
  windows: Object.fromEntries(Object.entries(windows).map(([name, rows]) => [name, { samples: rows.length, ...evaluate(rows) }])),
  independentUniverses: {
    oddCik: evaluate(samples.filter((row) => row.cik % 2 === 1)),
    evenCik: evaluate(samples.filter((row) => row.cik % 2 === 0)),
  },
  byYear: Object.fromEntries([...new Set(samples.map((row) => row.date.slice(0, 4)))].sort().map((year) => [year, evaluate(samples.filter((row) => row.date.startsWith(year)))])),
  costSensitivity,
  expectedReturnNormalization: {
    status: "not_evaluated",
    formula: "z_i = R_i / (EM_i / S_i)",
    reason: "The option panel has no preregistered expected-return series. Scenario-only normalization is implemented in the reviewed AAPL risk replay; realized returns are not relabeled as expectations.",
  },
  oosUsedForTuning: false,
};
writeJsonAtomic(path.join(outRoot, "dolthub-vol-target.json"), output, true);
prog.done(`snapshots ${snapshots} · monthly ${monthly.size} · usable ${samples.length} · tickers ${output.tickers}`);
process.exit(0);
