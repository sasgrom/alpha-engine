/**
 * 6d smoke only: uncalibrated conditional-magnitude baseline on the 6c anchors.
 * Fit labels must predate the fit cutoff; evaluation is reported; holdout is
 * not read. Four companies are intentionally insufficient for cross-section.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { buildAnchorDataset, knownBefore, splitNested, type AnchorDataset, type AnchorPoint } from "../api/services/nested-eval";
import {
  bucketedReturnSpread,
  crossSectionalRankIC,
  fitMagnitudeBaseline,
  magnitudeErrors,
  predictMagnitude,
  returnCalibrationBins,
  type CrossSectionPoint,
  type MagnitudeSample,
} from "../api/services/magnitude";

const universe = [["AAPL", 320193], ["MSFT", 789019], ["NVDA", 1045810], ["PLD", 1045609]] as const;
const datasets = await Promise.all(universe.map(([, cik]) => buildAnchorDataset(cik)));
const byCik = new Map(datasets.map((d) => [d.cik, d]));
const evaluationSection: CrossSectionPoint[] = [];

function samples(points: AnchorPoint[]): MagnitudeSample[] {
  return points.map((p) => ({ cik: p.cik, anchor: p.anchor, ret: p.ret, pUp: p.rawP }));
}

for (const [ticker, cik] of universe) {
  const target = byCik.get(cik) as AnchorDataset;
  const split = splitNested(target.points);
  if (!split) { console.log(ticker, "insufficient history for nested smoke"); continue; }
  const fitCutoff = split.fit[split.fit.length - 1].anchor;
  const targetFit = knownBefore(split.fit, fitCutoff);
  const otherFit = datasets.filter((d) => d.cik !== cik).flatMap((d) =>
    d.points.filter((p) => p.anchor <= fitCutoff && p.exitDate < fitCutoff)
  );
  const model = fitMagnitudeBaseline(samples([...targetFit, ...otherFit]));
  if (!model) { console.log(ticker, "no baseline"); continue; }
  const predictions = split.evaluation.map((p) => ({
    actual: p.ret,
    predicted: predictMagnitude({ cik, pUp: p.rawP }, model) ?? Number.NaN,
  }));
  const errors = magnitudeErrors(predictions);
  const calibration = returnCalibrationBins(predictions.filter((p) => Number.isFinite(p.predicted)), 4);
  console.log(ticker, JSON.stringify({
    targetFit: targetFit.length,
    panelFit: targetFit.length + otherFit.length,
    evaluation: split.evaluation.length,
    errors,
    calibrationBins: calibration.length,
    holdout: "untouched",
    baseline: "uncalibrated conditional moments; not a model candidate",
  }));
  split.evaluation.forEach((p, i) => {
    const score = predictions[i].predicted;
    if (Number.isFinite(score)) evaluationSection.push({ cik, anchor: p.anchor, score, ret: p.ret });
  });
}

const rank = crossSectionalRankIC(evaluationSection, 5);
const spread = bucketedReturnSpread(evaluationSection, 4, 8);
console.log("CROSS_SECTION", JSON.stringify({
  companies: universe.length,
  rankStatus: rank.status,
  rankAnchors: rank.anchors,
  spreadStatus: spread.status,
  spreadAnchors: spread.anchors,
  verdict: rank.status === "insufficient" && spread.status === "insufficient"
    ? "insufficient cross-section as designed; no magnitude or alpha conclusion"
    : "unexpected numeric cross-section; review before any conclusion",
}));

const db = getDb();
const [factors]: any = await db.execute(sql`
  SELECT cik, COUNT(DISTINCT factor) factors, COUNT(DISTINCT filedAt) anchors
  FROM factor_points WHERE value IS NOT NULL GROUP BY cik ORDER BY cik`);
const [prices]: any = await db.execute(sql`SELECT cik, COUNT(*) bars FROM prices WHERE cik>0 GROUP BY cik`);
const priceMap = new Map<number, number>(prices.map((p: any): [number, number] => [Number(p.cik), Number(p.bars)]));
const eligible = factors.filter((f: any) => Number(f.factors) >= 5 && Number(f.anchors) >= 24 && (priceMap.get(Number(f.cik)) ?? 0) >= 1000);
console.log("COVERAGE", JSON.stringify({
  factorCompanies: factors.length,
  eligibleCompanies: eligible.length,
  eligibleCiks: eligible.map((f: any) => Number(f.cik)),
  minimumTechnicalPanel: 30,
  minimumDecilePanel: 300,
}));
process.exit(0);
