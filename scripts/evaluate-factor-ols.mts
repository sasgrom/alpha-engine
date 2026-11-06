import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { companies } from "@db/schema";
import { engineData } from "../api/services/probability-engine";
import { FACTOR_META } from "../api/services/factor-meta";
import { evaluateFactorOls, evaluateLeaveGroupOut, type OlsAnchorPoint } from "../api/services/factor-ols";

const universe = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
const factorKeys = FACTOR_META.map((entry) => entry.key);
const metaByKey = new Map(FACTOR_META.map((entry) => [entry.key, entry]));
const db = getDb();
const registry = await db.select({ cik: companies.cik, sector: companies.sector }).from(companies).where(inArray(companies.cik, universe.map((company) => company.cik)));
const sectorByCik = new Map(registry.map((row) => [row.cik, row.sector]));
const byFactor = new Map<string, OlsAnchorPoint[]>(factorKeys.map((factor) => [factor, []]));
const COOL_OFF = 8;

for (const [companyIndex, company] of universe.entries()) {
  const data = await engineData(company.cik);
  for (const factor of factorKeys) {
    if (!data.byFactor.has(factor)) continue;
    const points = byFactor.get(factor)!;
    for (let i = COOL_OFF; i < data.anchors.length; i++) {
      const x = data.zValues.get(factor)?.[i];
      const outcome = data.outcomes[i];
      if (x === null || x === undefined || !Number.isFinite(x) || !outcome) continue;
      points.push({
        cik: company.cik,
        anchor: data.anchors[i],
        ret: outcome.ret,
        exitDate: outcome.exitDate,
        features: [],
        rawP: 0.5,
        x,
        sector: sectorByCik.get(company.cik) ?? null,
      });
    }
  }
  console.log(`[factor-ols ${companyIndex + 1}/${universe.length}] ${company.ticker}: anchors ${data.anchors.length}`);
}

const generatedAt = new Date().toISOString();
const datasetRows = factorKeys.flatMap((factor) => byFactor.get(factor)!.map((point) => ({ factor, ...point })));
const datasetSha256 = createHash("sha256").update(JSON.stringify(datasetRows)).digest("hex");
const universeSha256 = createHash("sha256").update(readFileSync("worker/research-universe-50.json", "utf8")).digest("hex");
const factors = [];
for (const factor of factorKeys) {
  const points = byFactor.get(factor)!.sort((a, b) => a.anchor.localeCompare(b.anchor) || a.cik - b.cik);
  const evaluation = evaluateFactorOls(points);
  const result: Record<string, unknown> = {
    factor,
    name: metaByKey.get(factor)?.name ?? factor,
    points: points.length,
    companies: new Set(points.map((point) => point.cik)).size,
    evaluation,
  };
  if (evaluation.status === "ok") {
    result.companyHoldouts = evaluateLeaveGroupOut(points, "cik");
    result.sectorHoldouts = evaluateLeaveGroupOut(points, "sector");
  }
  factors.push(result);
  if (evaluation.status === "ok") {
    const overall = evaluation.overall;
    const holdout = evaluation.holdout;
    console.log(`[factor-ols] ${factor}: β=${evaluation.model.beta.toFixed(4)} · ei+=${overall.ePlus?.toFixed(3) ?? "n/a"} · ei-=${overall.eMinus?.toFixed(3) ?? "n/a"} · holdout balanced=${holdout.balancedAcc?.toFixed(3) ?? "n/a"}`);
  } else {
    console.log(`[factor-ols] ${factor}: ${evaluation.status}`);
  }
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const robustnessSummary = factors.map((result) => {
  const evaluation = result.evaluation as ReturnType<typeof evaluateFactorOls>;
  if (evaluation.status !== "ok") return { factor: result.factor, status: evaluation.status };
  const overall = evaluation.overall;
  const holdout = evaluation.holdout;
  const companyValues = (result.companyHoldouts as ReturnType<typeof evaluateLeaveGroupOut>).filter((row) => row.status === "ok").map((row) => row.metrics!.balancedAcc).filter((value): value is number => value !== null);
  const sectorValues = (result.sectorHoldouts as ReturnType<typeof evaluateLeaveGroupOut>).filter((row) => row.status === "ok").map((row) => row.metrics!.balancedAcc).filter((value): value is number => value !== null);
  return {
    factor: result.factor,
    status: evaluation.status,
    overallBalanced: overall.balancedAcc,
    overallAccuracyCi: evaluation.overallAccuracyCi,
    holdoutBalanced: holdout.balancedAcc,
    holdoutAccuracyCi: evaluation.holdoutAccuracyCi,
    companyMedianBalanced: median(companyValues),
    sectorMedianBalanced: median(sectorValues),
    overallUpRate: overall.baselineExcess,
    holdoutUpRate: holdout.baselineExcess,
  };
});

const report = {
  schemaVersion: 1,
  generatedAt,
  dataMode: "research_evidence_only",
  target: "63-session excess return vs SPY",
  model: "pooled OLS per fundamental factor with robust trailing-16 z-scores",
  protocol: {
    universe: "worker/research-universe-50.json",
    universeSha256,
    datasetSha256,
    factors: factorKeys,
    split: "Chronological 50% fit / 25% calibration / 25% evaluation + final four-anchor sealed holdout",
    holdoutPolicy: "No fitting, calibration, thresholding or model selection on the sealed holdout",
    additionalHoldouts: "Leave-one-company-out and leave-one-sector-out",
    availability: "factor availability and label exit dates are enforced by engineData; no future values are used",
    targetSemantics: "positive prediction means excess return above SPY, not raw stock return",
    uncertainty: "Raw ei+/ei- plus Wilson 95% intervals; lpp/lmm use existing Beta(1,1) smoothing for Bayes compatibility",
    exclusions: ["edgarTone", "smartMoneyFlow"],
    promotion: "Evidence only. No factor, probability model or production promotion is implied",
  },
  robustnessSummary,
  factors,
};
writeFileSync("public/reports/factor-ols-evaluation.json", `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  "# Fundamental factor OLS evaluation",
  "",
  `Generated: ${generatedAt}`,
  "",
  "Target: **63-session excess return vs SPY**. OLS is fitted separately for each factor on chronological fit data only. No new factors and no holdout tuning.",
  "",
  "Error definitions: `ei+ = P(wrong up | actual down)`, `ei- = P(wrong down | actual up)`. Intervals are Wilson 95%. `lpp/lmm` are the existing smoothed Bayes reliability values, not raw confidence claims.",
  "",
  "| Factor | β | Direction | n | ei+ | ei- | Balanced | Holdout balanced | Majority baseline |",
  "|---|---:|---|---:|---:|---:|---:|---:|---:|",
];
for (const result of factors) {
  const evaluation = result.evaluation as ReturnType<typeof evaluateFactorOls>;
  if (evaluation.status !== "ok") {
    lines.push(`| ${result.factor} | — | ${evaluation.status} | ${result.points} | — | — | — | — | — |`);
    continue;
  }
  const overall = evaluation.overall;
  const holdout = evaluation.holdout;
  const fmt = (value: number | null, digits = 3) => value === null ? "—" : value.toFixed(digits);
  lines.push(`| ${result.factor} | ${evaluation.model.beta.toFixed(4)} | ${evaluation.direction} | ${result.points} | ${fmt(overall.ePlus)} [${overall.ePlusCi?.map((v) => v.toFixed(2)).join("–")}] | ${fmt(overall.eMinus)} [${overall.eMinusCi?.map((v) => v.toFixed(2)).join("–")}] | ${fmt(overall.balancedAcc)} | ${fmt(holdout.balancedAcc)} | ${fmt(overall.majorityBaseline)} |`);
}
lines.push("", "## Robustness conclusion", "", "- Many OLS specifications collapse to an almost one-class UP prediction. This is a classification failure, not factor evidence.", "- The sealed holdout has only four anchor dates, so it cannot justify a confident Bayes table by itself.", "- Use rolling IC/rank-IC and conditional forecast errors next; do not feed these OLS betas into Bayes as if they were validated evidence.", "", "Evidence only. Green status is not a production or alpha claim. Company and sector holdouts are included in the JSON, not fully reproduced here.");
writeFileSync("public/reports/factor-ols-evaluation.md", `${lines.join("\n")}\n`);
console.log(JSON.stringify({ generatedAt, factors: factors.length, datasetSha256, report: "public/reports/factor-ols-evaluation.json" }, null, 2));
await db.$client.end();
