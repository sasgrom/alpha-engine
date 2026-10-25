import { writeFileSync } from "node:fs";
import { nestedEvaluate, type DatasetCache, type NestedReport } from "../api/services/nested-eval";

const universe = [["AAPL", 320193], ["NVDA", 1045810], ["MSFT", 789019]] as const;
const panelCiks = universe.map(([, cik]) => cik);
const datasetCache: DatasetCache = new Map();
const reports: (NestedReport & { ticker: string })[] = [];
const pct = (v: number | null) => v === null ? null : +(v * 100).toFixed(1);
const num = (v: number | null) => v === null ? null : +v.toFixed(4);

for (const [ticker, cik] of universe) {
  for (const model of ["bayes", "logistic"] as const) {
    const started = Date.now();
    const report = await nestedEvaluate(cik, model, { panelCiks, datasetCache });
    if (!report) { console.log(ticker, model, "insufficient data"); continue; }
    reports.push({ ...report, ticker });
    console.log(ticker, model, JSON.stringify({
      ms: Date.now() - started,
      segments: report.segments,
      eval: {
        n: report.overall.n,
        acc: pct(report.overall.acc),
        balancedAcc: pct(report.overall.balancedAcc),
        upAcc: pct(report.overall.upAcc),
        downAcc: pct(report.overall.downAcc),
        alwaysUp: pct(report.overall.baselineExcess),
        majority: pct(report.overall.majorityBaseline),
        ci: { low: pct(report.ci.low), high: pct(report.ci.high) },
        bullAcc: pct(report.regime.bull.acc),
        bearAcc: pct(report.regime.bear.acc),
        costN: report.cost.n,
        netReturn: num(report.cost.totalReturn),
        baselineNetReturn: num(report.baselineCost.totalReturn),
        turnover: num(report.cost.turnover),
        cost: num(report.cost.cost),
        sharpePerAnchor: num(report.cost.sharpe),
        maxDD: num(report.cost.maxDD),
      },
      holdout: {
        n: report.holdout.n,
        acc: pct(report.holdout.acc),
        upAcc: pct(report.holdout.upAcc),
        downAcc: pct(report.holdout.downAcc),
        majority: pct(report.holdout.majorityBaseline),
        netReturn: num(report.holdoutCost.totalReturn),
        baselineNetReturn: num(report.holdoutBaselineCost.totalReturn),
      },
      pooling: report.pooling,
    }));
  }
}
writeFileSync("/mnt/agents/.tmp/nested-6c-results.json", JSON.stringify(reports, null, 2));
process.exit(0);
