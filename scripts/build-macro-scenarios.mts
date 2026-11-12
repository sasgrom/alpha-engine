/** Build availability-anchored macro scenarios from FRED baselines and SEC exposure evidence. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { macroPoints } from "@db/schema";
import { buildMacroScenarioReport, type MacroScenarioDefinition, type MacroScenarioReport, type ScenarioChannel } from "../api/services/macro-scenarios";
import { INTEREST_MARGIN_SIC_BY_TICKER } from "../api/services/scenario-rate-atlas";
import type { PilotEvidenceReport } from "../api/services/pilot-exposure-evidence";
import type { CompanyExposureReport } from "../api/services/company-exposure";
import { endOfUtcDay, fredSeriesUrl, sha256Text, type NormalizedMacroPoint } from "../worker/lib/fred";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const macroSource = arg("--macro-source") ?? "file";
if (macroSource !== "file" && macroSource !== "db") throw new Error("--macro-source must be file or db");
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const asOf = arg("--as-of") ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(asOf))) throw new Error("--as-of must be an ISO timestamp");
const numberArg = (name: string, fallback: number): number => {
  const value = Number(arg(name) ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
};
const definitions: MacroScenarioDefinition[] = [
  { channel: "rates", shock: numberArg("--rate-shock", 0.01) },
  { channel: "oil", shock: numberArg("--oil-shock", 0.20) },
  { channel: "usd", shock: numberArg("--usd-shock", 0.05) },
  { channel: "credit", shock: numberArg("--credit-shock", 0.01) },
];
const pilotPath = path.resolve(arg("--pilot") ?? "public/reports/pilot-exposure-evidence.json");
const exposurePath = path.resolve(arg("--exposure") ?? "public/reports/company-exposures.json");
const exposureHistoryPath = path.resolve(arg("--exposure-history") ?? "public/reports/exposure-latest.json");
const atlasPath = path.resolve(arg("--atlas") ?? "public/reports/macro-transmission-atlas.json");
for (const file of [pilotPath, exposurePath, exposureHistoryPath, atlasPath]) if (!existsSync(file)) throw new Error(`Missing ${file}. Build exposure history and the macro transmission atlas first.`);
const pilotReport = JSON.parse(readFileSync(pilotPath, "utf8")) as PilotEvidenceReport;
const exposureReport = JSON.parse(readFileSync(exposurePath, "utf8")) as CompanyExposureReport;
const exposureLatest = JSON.parse(readFileSync(exposureHistoryPath, "utf8")) as { companies: import("../worker/lib/exposure-aggregation").ExposureFiling[]; latestMeasures: import("../worker/lib/exposure-aggregation").ExposureFiling[] };
const atlas = JSON.parse(readFileSync(atlasPath, "utf8")) as { asOf: string; records: import("../api/services/scenario-rate-atlas").AtlasRecord[] };
const exposureHistory = [...exposureLatest.companies, ...exposureLatest.latestMeasures];
const channelSeries: Record<ScenarioChannel, string> = { rates: "DGS10", oil: "DCOILWTICO", usd: "DTWEXBGS", credit: "BAMLH0A0HYM2" };
const seriesIds = [...new Set(Object.values(channelSeries))];
const metadata: Record<string, { unit: string; frequency: string }> = {
  DGS10: { unit: "Percent", frequency: "Daily" },
  DCOILWTICO: { unit: "Dollars per Barrel", frequency: "Daily" },
  DTWEXBGS: { unit: "Index Jan 2006=100", frequency: "Daily" },
  BAMLH0A0HYM2: { unit: "Percent", frequency: "Daily, Close" },
};
const macroSeries: Record<string, NormalizedMacroPoint[]> = {};

if (macroSource === "file") {
  for (const seriesId of seriesIds) {
    const file = path.join(macroRoot, "normalized", "fred", `${seriesId}.json`);
    if (!existsSync(file)) throw new Error(`Missing FRED series ${seriesId} at ${file}`);
    const rows = JSON.parse(readFileSync(file, "utf8")) as NormalizedMacroPoint[];
    macroSeries[seriesId] = rows.map((row) => ({ ...row, provenance: row.provenance ?? "official_normalized_archive" }));
  }
} else {
  const db = getDb();
  const rows = await db.select().from(macroPoints).where(inArray(macroPoints.seriesId, seriesIds));
  for (const seriesId of seriesIds) {
    const sourceRows = rows.filter((row) => row.seriesId === seriesId && row.realtimeStart);
    if (!sourceRows.length) continue;
    const sourceHash = sha256Text(JSON.stringify(sourceRows));
    macroSeries[seriesId] = sourceRows.map((row) => {
      const ingestedAt = row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : new Date(row.fetchedAt).toISOString();
      return {
        seriesId,
        observationPeriod: row.date,
        value: row.value,
        unit: metadata[seriesId].unit,
        frequency: metadata[seriesId].frequency,
        releasedAt: null,
        availableAt: `${row.realtimeStart}T00:00:00.000Z`,
        availablePrecision: "day" as const,
        availabilityBasis: "fred_realtime_start" as const,
        researchEligibleAt: endOfUtcDay(row.realtimeStart!),
        vintageId: `${seriesId}|${row.date}|${row.realtimeStart}`,
        supersededAt: !row.realtimeEnd || row.realtimeEnd === "9999-12-31" || row.realtimeEnd >= ingestedAt.slice(0, 10) ? null : endOfUtcDay(row.realtimeEnd),
        ingestedAt,
        sourceUrl: fredSeriesUrl(seriesId),
        sourceHash,
        provenance: "production_macro_points_extract" as const,
      };
    });
  }
  const fallbackPath = arg("--baseline-fallback");
  const missing = seriesIds.filter((seriesId) => !macroSeries[seriesId]?.length);
  if (missing.length) {
    if (!fallbackPath) throw new Error(`No production macro_points for ${missing.join(",")}; supply --baseline-fallback or use --macro-source file`);
    const fallback = JSON.parse(readFileSync(path.resolve(fallbackPath), "utf8")) as MacroScenarioReport;
    if (fallback.dataMode === "fixture") throw new Error("Fixture scenario baselines cannot be promoted to live evidence");
    for (const seriesId of missing) {
      const channel = Object.entries(channelSeries).find(([, id]) => id === seriesId)?.[0] as ScenarioChannel | undefined;
      const baseline = fallback.scenarios.find((scenario) => scenario.channel === channel)?.baseline;
      if (!baseline) throw new Error(`Reviewed fallback has no ${seriesId} baseline`);
      if (!/^[a-f0-9]{64}$/i.test(baseline.sourceHash)) throw new Error(`Reviewed fallback ${seriesId} has invalid source hash`);
      macroSeries[seriesId] = [{
        seriesId: baseline.seriesId,
        observationPeriod: baseline.observationPeriod,
        value: baseline.value,
        unit: baseline.unit,
        frequency: baseline.frequency,
        releasedAt: null,
        availableAt: baseline.availableAt,
        availablePrecision: "day",
        availabilityBasis: baseline.availabilityBasis,
        researchEligibleAt: baseline.researchEligibleAt,
        vintageId: baseline.vintageId,
        supersededAt: baseline.supersededAt,
        ingestedAt: baseline.ingestedAt,
        sourceUrl: baseline.sourceUrl,
        sourceHash: baseline.sourceHash,
        provenance: "reviewed_scenario_snapshot",
      }];
    }
  }
}

const prog = startProgress("macro-scenarios", `${definitions.length} scenarios · ${pilotReport.companies.length} companies · availability anchored`);
const previousPath = path.resolve("public/reports/macro-scenarios.json");
const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, "utf8")) as MacroScenarioReport : null;
const report = buildMacroScenarioReport({ dataMode: process.argv.includes("--fixture") ? "fixture" : "live", asOf, definitions, macroSeries, pilot: pilotReport.companies, exposures: exposureReport.companies, exposureHistory, atlasRecords: atlas.records, atlasAsOf: atlas.asOf });
const jsonPath = path.resolve(arg("--out") ?? "public/reports/macro-scenarios.json");
const markdownPath = jsonPath.replace(/\.json$/i, ".md");
writeJsonAtomic(jsonPath, report, true);
const publish = !arg("--out");
const distDir = path.resolve("dist/public/reports");
if (publish && existsSync(distDir)) writeJsonAtomic(path.join(distDir, "macro-scenarios.json"), report, true);
const lines = ["# Macro scenarios", "", `As of: ${report.asOf}`, "Upper bounds and gross exposure are not profit forecasts. Rate impacts use scheduled latest-10-K maturities and cash when available. Atlas responses are empirical event/horizon distributions, not confidence intervals or forecasts.", ""];
for (const scenario of report.scenarios) {
  lines.push(`## ${scenario.channel.toUpperCase()} · shock ${scenario.shock} · ${scenario.status}`, "");
  if (scenario.baseline) lines.push(`Baseline: ${scenario.baseline.seriesId} ${scenario.baseline.value} → ${scenario.baseline.scenarioValue} ${scenario.baseline.unit} · observation ${scenario.baseline.observationPeriod} · available ${scenario.baseline.availableAt} · provenance ${scenario.baseline.provenance ?? "official_normalized_archive"}${scenario.baseline.stale ? " · stale" : ""}`, "");
  else lines.push(`No baseline: ${scenario.reasons.join(", ")}`, "");
  for (const impact of scenario.impacts) {
    lines.push(`- ${impact.ticker}: **${impact.status}**${impact.reasons.length ? ` · ${impact.reasons.join("; ")}` : ""}`);
    for (const metric of impact.metrics) lines.push(`  - ${metric.name}: ${metric.value} ${metric.unit} · ${metric.impactType} · ${metric.periodStart ? `${metric.periodStart} → ` : ""}${metric.periodEnd}${metric.stale ? " · stale" : ""}`);
    const measured = impact.measuredResponse;
    lines.push(measured?.status === "available"
      ? `  - Measured atlas response: median ${measured.median} · empirical p05/p95 ${measured.interval?.join(" … ")} · ${measured.count} observations · horizons ${measured.horizons?.join(",")} · ${measured.exposureKinds?.join(",")} · ${measured.disagreement ?? "no filing direction to compare"}`
      : `  - Measured atlas response: unavailable · ${measured?.reason ?? "not provided"}`);
    for (const filing of impact.exposureEvidence ?? []) {
      lines.push(`  - SEC ${filing.form} ${filing.filingDate} · accession ${filing.accessionNo} · ${filing.sourceUrl ?? "cached primary filing"} · SHA256 ${filing.sourceHash ?? "unknown"}`);
      for (const measure of filing.measures) {
        lines.push(`    - ${measure.kind}: ${measure.value} ${measure.unit} · ${measure.note ?? "direct filing evidence"}`);
        for (const fact of measure.facts) lines.push(`      - ${fact.id} · ${fact.concept} · ${fact.contextRef} · ${fact.rawValue} ${fact.unitRef} · ${fact.excerpt}`);
      }
    }
  }
  lines.push("");
}
const markdown = `${lines.join("\n")}\n`;
writeFileSync(markdownPath, markdown, "utf8");
if (publish && existsSync(distDir)) writeFileSync(path.join(distDir, "macro-scenarios.md"), markdown, "utf8");
const statusList = ["computable", "historical_only", "not_applicable", "not_computable"] as const;
const afterCoverage = Object.fromEntries(report.scenarios.map(scenario => [scenario.channel, Object.fromEntries(statusList.map(status => [status, scenario.impacts.filter(impact => impact.status === status).length]))]));
const previousSummaryPath = path.resolve("research/engine/exposure-history.summary.json");
const previousSummary = existsSync(previousSummaryPath) ? JSON.parse(readFileSync(previousSummaryPath, "utf8")) : null;
const staleBaseline = previousSummary?.staleEvidenceAudit ?? (previous?.scenarios ?? []).filter(scenario => scenario.channel === "rates" || scenario.channel === "credit").flatMap(scenario => scenario.impacts.filter(impact => impact.status === "historical_only").map(impact => ({ ticker: impact.ticker, channel: scenario.channel, before: { status: impact.status, periodEnd: impact.metrics[0]?.periodEnd ?? null, availableAt: impact.metrics[0]?.availableAt ?? null, concepts: impact.metrics[0]?.concepts ?? [] } })));
const staleEvidenceAudit = staleBaseline.map((row: { ticker: string; channel: string; before: unknown }) => {
  const current = report.scenarios.find(item => item.channel === row.channel)?.impacts.find(item => item.ticker === row.ticker);
  const annual = exposureLatest.companies.find(company => company.ticker === row.ticker);
  const recovered = current?.exposureEvidence?.some(filing => filing.measures.some(measure => measure.kind === "debtMaturingNext12"));
  const evidence = (current?.exposureEvidence ?? []).flatMap(filing => filing.measures.filter(measure => measure.kind === "debtMaturingNext12").map(measure => ({ form: filing.form, filingDate: filing.filingDate, accessionNo: filing.accessionNo, sourceUrl: filing.sourceUrl ?? null, sourceHash: filing.sourceHash ?? null, note: measure.note ?? null, value: measure.value, unit: measure.unit, facts: measure.facts.map(fact => ({ id: fact.id, concept: fact.concept, contextRef: fact.contextRef, rawValue: fact.rawValue, value: fact.value, unitRef: fact.unitRef, format: fact.format ?? null, scale: fact.scale, sign: fact.sign, excerpt: fact.excerpt })) })));
  return {
    ...row,
    after: { status: current?.status ?? "missing", periodEnd: current?.metrics[0]?.periodEnd ?? null, availableAt: current?.metrics[0]?.availableAt ?? null, accessionNo: current?.exposureEvidence?.[0]?.accessionNo ?? null, concepts: current?.metrics[0]?.concepts ?? [], evidence },
    cause: current?.status === "not_applicable" ? "rate_exposure_works_through_interest_margin" : recovered ? "current_inline_xbrl_maturity_total_recovered" : annual?.missing.filter(reason => reason.includes("matur") || reason.includes("cash")).join("; ") || "latest_10k_maturity_evidence_unavailable",
  };
});
const maturityTickers = ["AAPL", "AMD", "INTC", "AMZN", "TSLA", "BA", "RCL", "DAL", "MSFT", "COP", "MU"];
const maturityChecks = maturityTickers.map(ticker => {
  const filing = exposureLatest.companies.find(company => company.ticker === ticker);
  if (!filing) throw new Error(`No latest annual exposure filing for ${ticker}`);
  const detail = (kind: "debtMaturingNext12" | "debtMaturingYearTwo" | "cashShortTerm") => {
    const measure = filing.measures.find(item => item.kind === kind);
    return measure ? { value: measure.value, unit: measure.unit, periodEnd: measure.periodEnd, facts: measure.facts.map(fact => ({ id: fact.id, concept: fact.concept, contextRef: fact.contextRef, rawValue: fact.rawValue, value: fact.value, unitRef: fact.unitRef, format: fact.format ?? null, scale: fact.scale, sign: fact.sign, excerpt: fact.excerpt })) } : null;
  };
  const impact = report.scenarios.find(scenario => scenario.channel === "rates")?.impacts.find(item => item.ticker === ticker);
  return { ticker, form: filing.form, filingDate: filing.filingDate, accessionNo: filing.accessionNo, sourceUrl: filing.sourceUrl ?? null, sourceHash: filing.sourceHash ?? null, next12: detail("debtMaturingNext12"), yearTwo: detail("debtMaturingYearTwo"), cashShortTerm: detail("cashShortTerm"), scenarioStatus: impact?.status ?? null, metrics: impact?.metrics ?? [], missing: filing.missing };
});
if (maturityChecks.some(check => !check.next12)) throw new Error("A named latest-10-K maturity acceptance check has no exact fact");
const atlasComparison = Object.fromEntries(report.scenarios.map(scenario => [scenario.channel, {
  available: scenario.impacts.filter(impact => impact.measuredResponse?.status === "available").length,
  unavailable: scenario.impacts.filter(impact => impact.measuredResponse?.status !== "available").length,
  reasons: Object.fromEntries([...new Set(scenario.impacts.map(impact => impact.measuredResponse?.reason).filter(Boolean))].map(reason => [reason, scenario.impacts.filter(impact => impact.measuredResponse?.reason === reason).length])),
}]));
if (publish) {
  const summaryPath = path.resolve("research/engine/exposure-history.summary.json");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  if (summary.status !== "complete" || summary.published !== true) throw new Error("Exposure history is incomplete; refusing to mark scenario evidence complete");
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  Object.assign(summary, {
    afterCoverage,
    staleEvidenceAudit,
    maturityChecks,
    financialInterestMargin: report.scenarios.find(scenario => scenario.channel === "rates")?.impacts.filter(impact => impact.status === "not_applicable").map(impact => ({ ticker: impact.ticker, sic: INTEREST_MARGIN_SIC_BY_TICKER[impact.ticker] ?? null, reasons: impact.reasons })) ?? [],
    paymentNetworkCorrection: {
      before: previousSummary?.paymentNetworkCorrection?.before ?? previousSummary?.afterCoverage?.rates ?? null,
      after: afterCoverage.rates,
      classificationBasis: "local companies.sic is null; explicit reviewed SIC mapping, not the Financials sector label",
      evidence: ["V", "MA"].map(ticker => {
        const impact = report.scenarios.find(scenario => scenario.channel === "rates")?.impacts.find(item => item.ticker === ticker);
        return {
          ticker,
          sic: "7389",
          status: impact?.status ?? "missing",
          metrics: impact?.metrics ?? [],
          evidence: (impact?.exposureEvidence ?? []).map(filing => ({
            form: filing.form,
            filingDate: filing.filingDate,
            accessionNo: filing.accessionNo,
            sourceUrl: filing.sourceUrl ?? null,
            sourceHash: filing.sourceHash ?? null,
            measures: filing.measures.map(measure => ({ kind: measure.kind, value: measure.value, note: measure.note ?? null, facts: measure.facts.map(fact => ({ id: fact.id, concept: fact.concept, contextRef: fact.contextRef, rawValue: fact.rawValue, value: fact.value, excerpt: fact.excerpt })) })),
          })),
        };
      }),
    },
    atlasComparison,
    atlasAsOf: atlas.asOf,
    scenarioAsOf: report.asOf,
    hashes: { history: summary.sha256, exposureLatest: hash(exposureHistoryPath), scenarios: hash(jsonPath), atlas: hash(atlasPath) },
    productionWrite: false,
    databaseWrite: false,
  });
  writeJsonAtomic(summaryPath, summary, true);
}
prog.done(`scenarios ${report.scenarios.length} · dollar ${afterCoverage.usd.computable}/${pilotReport.companies.length} · maturity checks ${maturityChecks.length} · ${jsonPath}`);
process.exit(0);
