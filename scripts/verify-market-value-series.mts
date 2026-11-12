import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { isNonAdditiveQuarterlyConcept } from "../api/services/series";
import {
  applySplitEvents,
  createSplitShareProvider,
} from "../api/services/split-shares";
import { writeJsonAtomic } from "../worker/lib/json-file";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const universeFile = option("--universe") ?? "worker/research-universe-50.json";
const outputFile =
  option("--output") ?? "research/engine/market-value-series-check.json";
const universeBytes = readFileSync(universeFile);
const universe = JSON.parse(universeBytes.toString("utf8")) as {
  cik: number;
  ticker: string;
}[];
const byCik = new Map(universe.map(company => [company.cik, company.ticker]));
const required = new Set(["AAPL", "NVDA", "SMCI", "WMT"]);
const shareConcepts = new Set([
  "CommonStockSharesOutstanding",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfSharesOutstandingBasic",
]);
const db = getDb();

try {
  const ciks = sql.join(
    universe.map(company => sql`${company.cik}`),
    sql`,`
  );
  const [pointRows]: any = await db.execute(sql`
    SELECT cik, concept, periodEnd, vintage, val, derivation, sourceAccn, sourceFiled
    FROM series_points
    WHERE cik IN (${ciks})
      AND ((concept LIKE 'WeightedAverageNumber%' AND concept LIKE '%SharesOutstanding%') OR concept LIKE '%PerShare%')
    ORDER BY cik, concept, periodEnd, vintage`);
  const [coverRows]: any = await db.execute(sql`
    SELECT cik, endDate, val, filed, accn
    FROM facts
    WHERE cik IN (${ciks}) AND concept='EntityCommonStockSharesOutstanding' AND unit='shares' AND val > 0
    ORDER BY cik, endDate, filed, accn`);
  const points = pointRows
    .map((row: any) => ({
      cik: Number(row.cik),
      ticker: byCik.get(Number(row.cik)),
      concept: String(row.concept),
      periodEnd: String(row.periodEnd).slice(0, 10),
      vintage: String(row.vintage),
      val: row.val === null ? null : Number(row.val),
      derivation: String(row.derivation),
      sourceAccn: row.sourceAccn ? String(row.sourceAccn) : null,
      sourceFiled: row.sourceFiled
        ? String(row.sourceFiled).slice(0, 10)
        : null,
    }))
    .filter(
      (row: any) =>
        isNonAdditiveQuarterlyConcept(row.concept) ||
        shareConcepts.has(row.concept)
    );
  const covers = new Map<
    string,
    { shares: number; endDate: string; filed: string; accession: string }
  >();
  for (const row of coverRows) {
    const cik = Number(row.cik),
      endDate = String(row.endDate).slice(0, 10),
      filed = String(row.filed).slice(0, 10);
    covers.set(`${cik}|${endDate.slice(0, 4)}`, {
      shares: Number(row.val),
      endDate,
      filed,
      accession: String(row.accn),
    });
  }
  const derived = points.filter(
    (row: any) =>
      isNonAdditiveQuarterlyConcept(row.concept) &&
      row.derivation !== "reported"
  );
  const negativeShares = points.filter(
    (row: any) =>
      shareConcepts.has(row.concept) && row.val !== null && row.val < 0
  );
  const splitEvents = new Map<number, any[]>();
  for (const company of universe) {
    const provider = await createSplitShareProvider(company.cik);
    splitEvents.set(company.cik, provider.profile.events);
  }
  const comparisons: any[] = [];
  for (const row of points) {
    if (
      row.vintage !== "latest" ||
      !shareConcepts.has(row.concept) ||
      row.val === null ||
      !row.sourceFiled
    )
      continue;
    const cover = covers.get(`${row.cik}|${row.periodEnd.slice(0, 4)}`);
    if (!cover) continue;
    const events = splitEvents.get(row.cik) ?? [];
    const valueAdjustment = applySplitEvents(row.val, row.sourceFiled, events);
    const coverAdjustment = applySplitEvents(cover.shares, cover.filed, events);
    const ratio = valueAdjustment.shares / coverAdjustment.shares;
    comparisons.push({
      ...row,
      cover,
      rawRatio: row.val / cover.shares,
      adjustedShares: valueAdjustment.shares,
      adjustedCoverShares: coverAdjustment.shares,
      splitRatio: valueAdjustment.ratio / coverAdjustment.ratio,
      ratio,
      pass: ratio >= 0.1 && ratio <= 10,
    });
  }
  const implausible = comparisons
    .filter(row => !row.pass)
    .map(row => {
      const diagnosticScaleFactor =
        [0.000001, 0.001, 1000, 1000000].find(
          factor => row.ratio * factor >= 0.1 && row.ratio * factor <= 10
        ) ?? null;
      return {
        ...row,
        diagnosticScaleFactor,
        legacyScaleSuspect: diagnosticScaleFactor !== null,
      };
    });
  const requiredChecks = universe
    .filter(company => required.has(company.ticker))
    .map(company => {
      const rows = comparisons.filter(row => row.cik === company.cik);
      const latestPeriod =
        rows
          .map(row => row.periodEnd)
          .sort()
          .at(-1) ?? null;
      const checks = rows.filter(row => row.periodEnd === latestPeriod);
      return {
        cik: company.cik,
        ticker: company.ticker,
        latestPeriod,
        checks,
        pass: checks.length > 0 && checks.every(row => row.pass),
      };
    });
  const companiesWithPoints = new Set(points.map((row: any) => row.cik));
  const pass =
    companiesWithPoints.size === universe.length &&
    derived.length === 0 &&
    negativeShares.length === 0 &&
    implausible.length === 0 &&
    requiredChecks.every(row => row.pass);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: pass ? "pass" : "failed",
    universe: {
      file: universeFile,
      companies: universe.length,
      sha256: createHash("sha256").update(universeBytes).digest("hex"),
    },
    counts: {
      companiesWithPoints: companiesWithPoints.size,
      nonAdditivePoints: points.length,
      derivedNonAdditive: derived.length,
      negativeShares: negativeShares.length,
      negativeReportedEps: points.filter(
        (row: any) =>
          row.concept.includes("PerShare") && row.val !== null && row.val < 0
      ).length,
      coverComparisons: comparisons.length,
      splitBasisCorrections: comparisons.filter(
        row =>
          row.rawRatio !== row.ratio &&
          !(row.rawRatio >= 0.1 && row.rawRatio <= 10) &&
          row.pass
      ).length,
      implausibleLatestShares: implausible.length,
      legacyScaleSuspects: implausible.filter(row => row.legacyScaleSuspect)
        .length,
      unclassifiedOutliers: implausible.filter(row => !row.legacyScaleSuspect)
        .length,
    },
    derived,
    negativeShares,
    implausible,
    requiredChecks,
    productionWrite: false,
    databaseWrite: false,
  };
  writeJsonAtomic(outputFile, result, true);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        counts: result.counts,
        requiredChecks: requiredChecks.map(row => ({
          ticker: row.ticker,
          latestPeriod: row.latestPeriod,
          pass: row.pass,
        })),
        outputFile,
      },
      null,
      2
    )
  );
  if (!pass) process.exitCode = 1;
} finally {
  await db.$client.end();
}
