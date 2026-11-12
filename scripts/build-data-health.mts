import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { acceptedPriceHistory } from "../worker/lib/accepted-price-history";
import {
  calendarFindings,
  expectationCompanyShares,
  expectationEvidenceFindings,
  gapEntries,
  negativeValueEntry,
  nonAdditiveEntry,
  restatementEntry,
  unitScaleEntry,
  type QuarantineEntry,
} from "../worker/lib/data-health";
import {
  analyzeOptionHealth,
  readOptionCheckpoint,
  writeOptionCheckpoint,
} from "../worker/lib/data-health-options";
import {
  readCohortEntries,
  type CohortResultEntry,
} from "../worker/lib/cohort-checkpoint";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { renameWithRetry, writeJsonAtomic } from "../worker/lib/json-file";

const started = Date.now();
const generatedAt = new Date().toISOString();
const db = getDb();
const day = (value: unknown) =>
  value === null || value === undefined ? null : String(value).slice(0, 10);
const number = (value: unknown) => Number(value);
const present = <T,>(value: T | null): value is T => value !== null;
const severityCounts = (entries: QuarantineEntry[]) => ({
  info: entries.filter(row => row.severity === "info").length,
  review: entries.filter(row => row.severity === "review").length,
  quarantine: entries.filter(row => row.severity === "quarantine").length,
});
const byKey = (a: QuarantineEntry, b: QuarantineEntry) =>
  a.check.localeCompare(b.check) ||
  a.source.localeCompare(b.source) ||
  a.key.localeCompare(b.key) ||
  a.since.localeCompare(b.since);

function check(
  id: string,
  title: string,
  examined: unknown,
  entries: QuarantineEntry[],
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    title,
    examined,
    findings: entries.length,
    ...severityCounts(entries),
    examples: [...entries]
      .sort(
        (a, b) => b.since.localeCompare(a.since) || a.key.localeCompare(b.key)
      )
      .slice(0, 50),
    omitted: Math.max(0, entries.length - 50),
    ...extra,
  };
}

try {
  console.log("[data-health] accepted archive history");
  const accepted = await acceptedPriceHistory();
  const optionsFromCheckpoint = await readOptionCheckpoint(db);
  const optionsPromise = optionsFromCheckpoint
    ? Promise.resolve(optionsFromCheckpoint)
    : analyzeOptionHealth(db);
  console.log(
    `[data-health] options ${optionsFromCheckpoint ? "current checkpoint" : "compute"}`
  );

  console.log("[data-health] price ratios and bars");
  const [ratioRows]: any = await db.execute(sql`
    WITH levels AS (
      SELECT cik,ticker,date,close FROM prices WHERE source='schwab-hist'
      UNION ALL
      SELECT s.cik,s.ticker,s.date,s.close FROM prices s WHERE s.source='schwab'
        AND NOT EXISTS (SELECT 1 FROM prices h WHERE h.cik=s.cik AND h.ticker=s.ticker AND h.date=s.date AND h.source='schwab-hist')
    ), pairs AS (
      SELECT p.cik,p.ticker,p.date,p.close stooqClose,s.close schwabClose,p.close/s.close ratio,
        LAG(p.close/s.close) OVER (PARTITION BY p.cik,p.ticker ORDER BY p.date) previousRatio
      FROM prices p JOIN levels s ON s.cik=p.cik AND s.ticker=p.ticker AND s.date=p.date
      WHERE p.source='stooq' AND p.close>0 AND s.close>0
    )
    SELECT cik,ticker,date,stooqClose,schwabClose,ratio,previousRatio FROM pairs
    WHERE ratio>1.001 OR (previousRatio IS NOT NULL AND (ratio/previousRatio-1 < -0.002 OR ABS(ratio/previousRatio-1)>0.15))
    ORDER BY ticker,date`);
  const ratioFindings = ratioRows.map((row: any): QuarantineEntry => {
    const reasons = [];
    if (Number(row.ratio) > 1.001) reasons.push("ratio_above_one");
    if (row.previousRatio !== null) {
      const step = Number(row.ratio) / Number(row.previousRatio) - 1;
      if (step < -0.002) reasons.push("ratio_moves_away_from_present");
      if (Math.abs(step) > 0.15) reasons.push("step_above_15_percent");
    }
    return {
      source: "prices",
      key: `${row.ticker}|${day(row.date)}`,
      check: "two_sources_one_story",
      severity: "quarantine",
      since: day(row.date)!,
      evidence: {
        ratio: number(row.ratio),
        previousRatio:
          row.previousRatio === null ? null : number(row.previousRatio),
        stooqClose: number(row.stooqClose),
        schwabClose: number(row.schwabClose),
        reasons,
      },
    };
  });
  console.log("[data-health] invalid bars");
  const [invalidBars]: any = await db.execute(
    sql`SELECT cik,ticker,source,date,open,high,low,close,volume FROM prices WHERE source IN ('stooq','schwab','schwab-hist') AND ((open<=0 OR high<=0 OR low<=0 OR close<=0) OR high<low) ORDER BY ticker,source,date`
  );
  const invalidFindings = invalidBars.map((row: any): QuarantineEntry => ({
    source: "prices",
    key: `${row.ticker}|${row.source}|${day(row.date)}`,
    check: "bars",
    severity: "quarantine",
    since: day(row.date)!,
    evidence: {
      open: number(row.open),
      high: number(row.high),
      low: number(row.low),
      close: number(row.close),
      reason: row.high < row.low ? "high_below_low" : "non_positive_ohlc",
    },
  }));
  console.log("[data-health] large moves");
  const [largeMoves]: any = await db.execute(
    sql`WITH moves AS (SELECT cik,ticker,source,date,close,LAG(close) OVER (PARTITION BY cik,ticker,source ORDER BY date) previousClose FROM prices WHERE source IN ('stooq','schwab','schwab-hist')) SELECT cik,ticker,source,date,close,previousClose,close/previousClose-1 move FROM moves WHERE previousClose>0 AND ABS(close/previousClose-1)>0.5 ORDER BY ticker,date`
  );
  console.log("[data-health] zero-volume runs");
  const [zeroRuns]: any = await db.execute(sql`
    WITH zeros AS (
      SELECT cik,ticker,source,date,open,high,low,close,volume FROM prices
      WHERE source IN ('stooq','schwab','schwab-hist') AND volume=0
    ), lagged AS (
      SELECT z.*, p.date previousDate, p.open previousOpen, p.high previousHigh, p.low previousLow, p.close previousClose, p.volume previousVolume
      FROM zeros z LEFT JOIN prices p ON p.cik=z.cik AND p.ticker=z.ticker AND p.source=z.source AND p.date=(
        SELECT MAX(p2.date) FROM prices p2 WHERE p2.cik=z.cik AND p2.ticker=z.ticker AND p2.source=z.source AND p2.date<z.date
      )
    ), numbered AS (
      SELECT *, ROW_NUMBER() OVER w2 allIndex,
        ROW_NUMBER() OVER (PARTITION BY cik,ticker,source,
          (CASE WHEN volume=0 AND previousVolume=0 AND open=previousOpen AND high=previousHigh AND low=previousLow AND close=previousClose THEN 1 ELSE 0 END)
          ORDER BY date) flagIndex
      FROM lagged WINDOW w2 AS (PARTITION BY cik,ticker,source ORDER BY date)
    ), runs AS (
      SELECT *, allIndex-flagIndex runId FROM numbered
      WHERE volume=0 AND previousVolume=0 AND open=previousOpen AND high=previousHigh AND low=previousLow AND close=previousClose
    )
    SELECT cik,ticker,source,runId,MIN(previousDate) firstDate,MAX(date) lastDate,COUNT(*)+1 sessions
    FROM runs GROUP BY cik,ticker,source,runId HAVING COUNT(*)>=2 ORDER BY ticker,firstDate`);
  const zeroFindings = zeroRuns.map((row: any): QuarantineEntry => ({
    source: "prices",
    key: `${row.ticker}|${row.source}|${day(row.firstDate)}|${day(row.lastDate)}`,
    check: "bars",
    severity: "review",
    since: day(row.lastDate)!,
    evidence: {
      reason: "unchanged_ohlc_zero_volume",
      firstDate: day(row.firstDate),
      lastDate: day(row.lastDate),
      sessions: number(row.sessions),
    },
  }));

  console.log("[data-health] SPY-calendar gaps");
  const [gapRows]: any = await db.execute(sql`
    WITH bounds AS (
      SELECT cik,MAX(ticker) ticker,MIN(date) firstDate,MAX(date) lastDate FROM prices
      WHERE source IN ('stooq','schwab') AND date>='2006-11-10' GROUP BY cik
    ), expected AS (
      SELECT DISTINCT b.cik,b.ticker,d.date FROM bounds b JOIN prices d
        ON d.cik=0 AND d.source IN ('stooq','schwab') AND d.date>=b.firstDate AND d.date<=b.lastDate
    ), missing AS (
      SELECT e.cik,e.ticker,e.date FROM expected e LEFT JOIN prices p
        ON p.cik=e.cik AND p.source IN ('stooq','schwab') AND p.date=e.date
      WHERE p.date IS NULL
    ) SELECT cik,ticker,date FROM missing ORDER BY cik,ticker,date`);
  const gaps = new Map<string, string[]>();
  for (const row of gapRows) {
    const key = `${row.cik}|${row.ticker}`;
    gaps.set(key, [...(gaps.get(key) ?? []), day(row.date)!]);
  }
  const gapFindings = [...gaps.entries()].flatMap(([key, dates]) =>
    gapEntries(key.split("|")[1], "stooq+schwab", dates).map(row => ({
      ...row,
      key,
    }))
  );
  const chtrMissing = gaps.get("1091667|CHTR")?.length ?? 0;
  if (gaps.size < 23)
    throw new Error(`Expected at least 23 gap series, found ${gaps.size}`);

  console.log("[data-health] canonical filed figures");
  const [derivedRows]: any = await db.execute(
    sql`SELECT cik,concept,periodEnd,vintage,val,derivation,sourceAccn,sourceFiled FROM series_points WHERE ((concept LIKE 'WeightedAverageNumber%' AND concept LIKE '%SharesOutstanding%') OR concept LIKE '%PerShare%') AND derivation<>'reported' ORDER BY cik,concept,periodEnd,vintage`
  );
  const derivedFindings = derivedRows.map(nonAdditiveEntry).filter(present);
  const [negativeRows]: any = await db.execute(
    sql`SELECT cik,concept,periodEnd,vintage,val,sourceAccn,sourceFiled FROM series_points WHERE concept IN ('Assets','CommonStockSharesOutstanding','EntityCommonStockSharesOutstanding','WeightedAverageNumberOfDilutedSharesOutstanding','WeightedAverageNumberOfSharesOutstandingBasic','RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet') AND val<0 ORDER BY cik,concept,periodEnd`
  );
  const negativeFindings = negativeRows.map(negativeValueEntry).filter(present);
  const [unitRows]: any = await db.execute(sql`
    WITH valuesByPeriod AS (
      SELECT cik,concept,periodEnd,val,sourceAccn,sourceFiled,
        LAG(val) OVER (PARTITION BY cik,concept ORDER BY periodEnd) previousValue,
        LAG(periodEnd) OVER (PARTITION BY cik,concept ORDER BY periodEnd) previousPeriodEnd,
        LAG(sourceAccn) OVER (PARTITION BY cik,concept ORDER BY periodEnd) previousAccession,
        LAG(sourceFiled) OVER (PARTITION BY cik,concept ORDER BY periodEnd) previousFiled
      FROM series_points WHERE vintage='latest' AND val>0
    ) SELECT * FROM valuesByPeriod WHERE previousValue>0 AND (
      ABS(val/previousValue/1000-1)<=0.01 OR ABS(val/previousValue/1000000-1)<=0.01 OR
      ABS(val/previousValue/0.001-1)<=0.01 OR ABS(val/previousValue/0.000001-1)<=0.01)
    ORDER BY cik,concept,periodEnd`);
  const unitFindings = unitRows
    .map((row: any) =>
      unitScaleEntry(
        {
          concept: row.concept,
          val: number(row.val),
          filed: day(row.sourceFiled)!,
          accession: String(row.sourceAccn),
          periodEnd: day(row.periodEnd)!,
        },
        {
          concept: row.concept,
          val: number(row.previousValue),
          filed: day(row.previousFiled)!,
          accession: String(row.previousAccession),
          periodEnd: day(row.previousPeriodEnd)!,
        }
      )
    )
    .filter(present);
  const k09Seed = JSON.parse(
    readFileSync("research/engine/market-value-k09-quarantine.json", "utf8")
  );
  const seededUnits = k09Seed.unitScale.map((row: any): QuarantineEntry => ({
    source: "facts",
    key: `${row.sourceAccn}|${row.concept}|${row.periodEnd}`,
    check: "units_and_signs",
    severity: "quarantine",
    since: row.sourceFiled,
    evidence: {
      cik: row.cik,
      ticker: row.ticker,
      originalValue: row.val,
      factor: row.factor,
      referenceError: row.referenceError,
      reference: row.reference,
      action: "reject_without_rescaling",
    },
  }));
  const seededSuccessor = k09Seed.successor.rows.map(
    (row: any): QuarantineEntry => ({
      source: "facts",
      key: `${row.sourceAccn}|${row.concept}|${row.periodEnd}`,
      check: "units_and_signs",
      severity: "info",
      since: row.sourceFiled,
      evidence: {
        cik: row.cik,
        ticker: row.ticker,
        value: row.val,
        cover: row.cover,
        reason: "holding_company_before_combination",
        predecessorSharesPreserved: true,
      },
    })
  );
  const [restatementRows]: any = await db.execute(sql`
    SELECT f.cik,f.concept,f.periodEnd,f.val firstValue,l.val latestValue,f.sourceFiled firstFiled,l.sourceFiled latestFiled,l.sourceAccn latestAccession
    FROM series_points f JOIN series_points l ON l.cik=f.cik AND l.concept=f.concept AND l.kind=f.kind AND l.periodEnd=f.periodEnd AND l.vintage='latest'
    WHERE f.vintage='first' AND f.concept IN ('NetIncomeLoss','OperatingIncomeLoss','GrossProfit','RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet','CostsAndExpenses','OperatingExpenses','IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest')
      AND f.val<>0 AND ABS((l.val-f.val)/ABS(f.val))>0.1 ORDER BY cik,concept,periodEnd`);
  const restatementFindings = restatementRows
    .map((row: any) =>
      restatementEntry({
        cik: number(row.cik),
        concept: row.concept,
        periodEnd: day(row.periodEnd)!,
        first: number(row.firstValue),
        latest: number(row.latestValue),
        firstFiled: day(row.firstFiled),
        latestFiled: day(row.latestFiled),
        latestAccession: row.latestAccession,
      })
    )
    .filter(present);

  console.log("[data-health] calendar and extraction evidence");
  const calendar = JSON.parse(
    readFileSync("research/engine/event-calendar-rest.summary.json", "utf8")
  );
  const calendarFindings = calendarFindingsFromSummary(calendar.overall.checks);
  const universe = loadEdgarUniverse("research-universe-50.json");
  const expectationRows = universe.flatMap(company =>
    readCohortEntries<CohortResultEntry>(
      path.resolve("worker/cache/edgar", String(company.cik))
    )
  );
  const expectationFindings = expectationEvidenceFindings(expectationRows);
  const expectationShares = expectationCompanyShares(expectationRows);

  console.log("[data-health] options");
  const options = await optionsPromise;
  await writeOptionCheckpoint(db, options);
  const splitDates = new Set(
    options.splits.map(
      row => `${row.key.split("|")[0]}|${row.key.split("|")[1]}`
    )
  );
  const k08Splits = JSON.parse(
    readFileSync("research/engine/market-value-split-check.json", "utf8")
  );
  for (const row of k08Splits.rows)
    splitDates.add(`${row.ticker}|${row.after}`);
  const largeMoveFindings = largeMoves
    .filter((row: any) => !splitDates.has(`${row.ticker}|${day(row.date)}`))
    .map((row: any): QuarantineEntry => ({
      source: "prices",
      key: `${row.ticker}|${row.source}|${day(row.date)}`,
      check: "bars",
      severity: "review",
      since: day(row.date)!,
      evidence: {
        reason: "one_day_move_above_50_percent",
        previousClose: number(row.previousClose),
        close: number(row.close),
        move: number(row.move),
      },
    }));
  const requiredSplits = options.splits.filter(
    row =>
      (row.key === "AAPL|2020-08-31" && row.evidence.ratio === 4) ||
      (row.key === "NVDA|2024-06-10" && row.evidence.ratio === 10)
  );
  if (requiredSplits.length !== 2)
    throw new Error(
      "The AAPL 4:1 and NVDA 10:1 option split evidence was not reproduced"
    );
  if (
    !calendarFindings.some(row => row.key === "1283699|2006-09-30") ||
    !calendarFindings.some(row => row.key === "97476|0001140361-10-029984")
  )
    throw new Error("TMUS or TXN calendar evidence is missing");

  const checks = [
    check(
      "two_sources_one_story",
      "Two sources, one story",
      `${ratioRows.length} differing ratio steps`,
      [
        ...ratioFindings,
        ...accepted.entries.filter(
          row => row.check === "two_sources_one_story"
        ),
      ],
      { acceptedHistory: accepted.summary }
    ),
    check(
      "splits_from_quotes",
      "Splits from option quotes",
      `${options.stats.quotePairs} quote/close pairs`,
      options.entries.filter(row => row.check === "splits_from_quotes"),
      {
        splitTable: options.splits.slice(0, 200),
        omittedSplitEvents: Math.max(0, options.splits.length - 200),
      }
    ),
    check(
      "bars",
      "Price-bar validity",
      `${invalidFindings.length} current invalid bars, ${largeMoveFindings.length} large moves, ${zeroFindings.length} zero-volume runs`,
      [
        ...invalidFindings,
        ...accepted.entries.filter(row => row.check === "bars"),
        ...largeMoveFindings,
        ...zeroFindings,
      ],
      { acceptedHighLow: accepted.summary.highLow }
    ),
    check(
      "gaps",
      "SPY-calendar gaps",
      `${gaps.size} series with missing sessions`,
      gapFindings,
      {
        chtr: {
          expected: 25,
          actual: chtrMissing,
          first: gaps.get("1091667|CHTR")?.slice(0, 5) ?? [],
          definition:
            "Distinct SPY dates in stooq+schwab since 2006-11-10, missing inside each series' own first..last span; schwab-hist excluded (worker/schwab-daily-bars.mts)",
        },
      }
    ),
    check(
      "non_additive",
      "Non-additive filed concepts",
      `${derivedFindings.length} derived non-additive points; AAPL derived quarters after K08: ${derivedFindings.filter((row: any) => row.key.startsWith("320193|")).length}`,
      derivedFindings
    ),
    check(
      "units_and_signs",
      "Units and signs",
      `${unitFindings.length} neighbour-scale candidates, ${negativeFindings.length} negative values`,
      [...unitFindings, ...seededUnits, ...seededSuccessor, ...negativeFindings]
    ),
    check(
      "restatements",
      "Income-statement restatements",
      `${restatementFindings.length} changes above 10%`,
      restatementFindings
    ),
    check(
      "calendar",
      "Filing calendar",
      `${calendar.counts.filings} filings in the K06 inventory`,
      calendarFindings
    ),
    check(
      "expectation_evidence",
      "Unverifiable model statements",
      `${expectationRows.length} extraction results`,
      expectationFindings,
      { companies: expectationShares }
    ),
    check(
      "snapshot_health",
      "Option snapshot health",
      `${options.stats.snapshots} snapshots / ${options.stats.buckets} buckets`,
      options.entries.filter(row => row.check === "snapshot_health"),
      {
        strikeSample: {
          basis: options.strikeSample.basis,
          dates: options.strikeSample.dates,
          checks: options.strikeSample.rows.length,
          pass: options.strikeSample.pass,
          failed: options.strikeSample.failed,
          examples: options.strikeSample.rows.slice(0, 100),
        },
      }
    ),
  ];
  const allEntries: QuarantineEntry[] = [
    ...ratioFindings,
    ...accepted.entries,
    ...options.entries,
    ...invalidFindings,
    ...largeMoveFindings,
    ...zeroFindings,
    ...gapFindings,
    ...derivedFindings,
    ...unitFindings,
    ...seededUnits,
    ...seededSuccessor,
    ...negativeFindings,
    ...restatementFindings,
    ...calendarFindings,
    ...expectationFindings,
  ].sort(byKey);
  const elapsedMs = Date.now() - started;
  const totals = severityCounts(allEntries);
  const report = {
    schemaVersion: 1,
    generatedAt,
    status: elapsedMs < 900_000 ? "complete" : "slow",
    health: totals.quarantine || totals.review ? "degraded" : "ok",
    elapsedMs,
    lineage: {
      optionAnalysis: optionsFromCheckpoint
        ? "reused_current_checkpoint"
        : "computed_and_checkpointed",
    },
    summary: {
      checks: checks.length,
      findings: allEntries.length,
      ...totals,
      gapSeries: gaps.size,
      expectationReleases: expectationRows.length,
      optionSnapshots: options.stats.snapshots,
    },
    checks,
    productionWrite: false,
    databaseWrite: false,
  };
  const quarantine = {
    schemaVersion: 1,
    generatedAt,
    entries: allEntries,
    summary: { findings: allEntries.length, ...totals },
    productionWrite: false,
    databaseWrite: false,
  };
  const markdown = renderMarkdown(report, options.splits);
  mkdirSync("public/reports", { recursive: true });
  writeJsonAtomic("research/engine/quarantine.json", quarantine, true);
  writeJsonAtomic("public/reports/data-health.json", report, true);
  const temporary = `public/reports/data-health.md.${process.pid}.tmp`;
  writeFileSync(temporary, markdown);
  renameWithRetry(temporary, "public/reports/data-health.md");
  if (existsSync("dist/public/reports")) {
    writeJsonAtomic("dist/public/reports/data-health.json", report, true);
    const distTemporary = `dist/public/reports/data-health.md.${process.pid}.tmp`;
    writeFileSync(distTemporary, markdown);
    renameWithRetry(distTemporary, "dist/public/reports/data-health.md");
  }
  console.log(
    JSON.stringify(
      {
        status: report.status,
        health: report.health,
        elapsedMs,
        summary: report.summary,
      },
      null,
      2
    )
  );
  if (report.status !== "complete") process.exitCode = 1;
} finally {
  await db.$client.end();
}

function calendarFindingsFromSummary(checks: any): QuarantineEntry[] {
  return calendarFindings({
    outOfOrderNextPublications: checks.quarters.outOfOrderNextPublications,
    duplicateOriginalPeriods: checks.quarters.duplicateOriginalPeriods,
  });
}

function renderMarkdown(report: any, splits: QuarantineEntry[]): string {
  const lines = [
    "# Data health and quarantine",
    "",
    `Generated: ${report.generatedAt} · elapsed ${(report.elapsedMs / 1000).toFixed(1)} s`,
    "",
    `**${report.summary.findings} findings: ${report.summary.quarantine} quarantine, ${report.summary.review} review, ${report.summary.info} reviewed/info.**`,
    "Checks are read-only. A quarantine entry records when the issue became knowable; it does not rewrite history or the database.",
    "",
    "Machine-readable inventory: `research/engine/quarantine.json`.",
    "",
  ];
  for (const row of report.checks) {
    lines.push(
      `## ${row.title}`,
      "",
      `${row.examined}. Findings: ${row.findings} (quarantine ${row.quarantine}, review ${row.review}, info ${row.info}).`,
      ""
    );
    for (const example of row.examples.slice(0, 30))
      lines.push(
        `- **${example.severity}** \`${example.key}\` · since ${example.since} · ${JSON.stringify(example.evidence).slice(0, 500)}`
      );
    if (row.omitted)
      lines.push(`- … ${row.omitted} more in the machine-readable inventory.`);
    lines.push("");
  }
  lines.push(
    "## Option split table",
    "",
    "| Key | Ratio | Evidence |",
    "|---|---:|---|"
  );
  for (const row of splits.slice(0, 200))
    lines.push(
      `| ${row.key} | ${row.evidence.ratio} | ${JSON.stringify(row.evidence)} |`
    );
  lines.push(
    "",
    "## Rejected extraction evidence by company",
    "",
    "| Company | Releases | Rejected releases | Rejected statements | Accepted statements | Rejected share |",
    "|---|---:|---:|---:|---:|---:|"
  );
  const companies = report.checks.find(
    (row: any) => row.id === "expectation_evidence"
  ).companies;
  for (const row of companies)
    lines.push(
      `| ${row.ticker} | ${row.releases} | ${row.rejectedReleases} | ${row.rejectedStatements} | ${row.acceptedStatements} | ${(row.rejectedShare * 100).toFixed(2)}% |`
    );
  const strike = report.checks.find(
    (row: any) => row.id === "snapshot_health"
  ).strikeSample;
  lines.push(
    "",
    "## ATM strike sample",
    "",
    strike.basis,
    "",
    `${strike.checks} sampled snapshots: ${strike.pass} pass, ${strike.failed} findings.`,
    ""
  );
  return lines.join("\n");
}
