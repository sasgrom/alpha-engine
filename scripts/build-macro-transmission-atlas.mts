/** Build the Macro Transmission Atlas from first-release macro events, SEC exposure and market-model returns. */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { companies as companyRegistry, seriesPoints } from "@db/schema";
import { getBars } from "../api/services/prices";
import { buildMacroTransmissionAtlas } from "../api/services/macro-transmission";
import type { MacroEventStudyReport } from "../api/services/macro-event-study";
import type { FundamentalSeriesRow } from "../api/services/fundamental-integrity";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { parseExposureHistory } from "../worker/lib/exposure-history";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "research-universe-50.json";
const universe = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const eventStudyPath = path.resolve("public/reports/macro-event-study.json");
if (!existsSync(eventStudyPath)) throw new Error("Build macro-event-study.json before the transmission Atlas");
const eventStudy = JSON.parse(readFileSync(eventStudyPath, "utf8")) as MacroEventStudyReport;
if (!eventStudy.observations.length) throw new Error("Macro event study has no observations; insufficient macro evidence for Atlas");
const earliestEvent = eventStudy.observations.map((observation) => observation.publishedAt).sort()[0];
const from = new Date(Date.parse(`${earliestEvent.slice(0, 10)}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
const clean = async (cik: number) => (await getBars(cik, from)).filter((bar) => (bar.adjClose ?? bar.close) !== null)
  .map((bar) => ({ date: bar.date, close: Number(bar.adjClose ?? bar.close) })).sort((a, b) => a.date.localeCompare(b.date));
const db = getDb();
const ciks = universe.map((company) => company.cik);
const metadata = await db.select().from(companyRegistry).where(inArray(companyRegistry.cik, ciks));
const metadataByCik = new Map(metadata.map((row) => [row.cik, row]));
const seriesRows: FundamentalSeriesRow[] = [];
for (let offset = 0; offset < ciks.length; offset += 5) {
  const batch = ciks.slice(offset, offset + 5);
  const rows = await db.select().from(seriesPoints).where(inArray(seriesPoints.cik, batch));
  for (const row of rows) seriesRows.push(row);
}
const rowsByCik = new Map<number, FundamentalSeriesRow[]>();
for (const row of seriesRows) rowsByCik.set(row.cik, [...(rowsByCik.get(row.cik) ?? []), row]);
const spyBars = await clean(0);
const companies = [];
const prog = startProgress("macro-transmission-atlas", `${universe.length} companies · ${eventStudy.observations.length} macro observations`);
for (const [index, company] of universe.entries()) {
  const bars = await clean(company.cik);
  companies.push({
    cik: company.cik,
    ticker: company.ticker,
    sector: metadataByCik.get(company.cik)?.sector ?? null,
    rows: rowsByCik.get(company.cik) ?? [],
    bars,
  });
  prog.item(index + 1, universe.length, `${company.ticker} · ${bars.length} price bars`);
}
const historySummary = JSON.parse(readFileSync(path.resolve("research/engine/exposure-history.summary.json"), "utf8")) as { status: string; published: boolean; historyFile: string; sha256: string };
if (historySummary.status !== "complete" || !historySummary.published) throw new Error("Complete exposure history is required before rebuilding the atlas");
const historyText = readFileSync(path.resolve(historySummary.historyFile), "utf8");
const { createHash } = await import("node:crypto");
if (createHash("sha256").update(historyText).digest("hex") !== historySummary.sha256) throw new Error("Exposure history hash differs from its reviewed summary");
const exposureHistory = parseExposureHistory(historyText);
const report = buildMacroTransmissionAtlas({
  macroObservations: eventStudy.observations,
  companies,
  spyBars,
  exposureHistory,
  asOf: eventStudy.asOf,
  generatedAt: new Date().toISOString(),
  dataMode: eventStudy.dataMode,
});
const jsonPath = path.resolve(arg("--out") ?? "public/reports/macro-transmission-atlas.json");
const markdownPath = jsonPath.replace(/\.json$/i, ".md");
writeJsonAtomic(jsonPath, report, true);
const number = (value: number | null) => value === null ? "—" : value.toFixed(6);
const lines = [
  "# Macro Transmission Atlas",
  "",
  `As of: ${report.asOf} · Status: ${report.status}`,
  "Discovery-only OLS with shock, exposure, shock × exposure and sector fixed effects. OOS uses frozen discovery coefficients. Results are conditional transmission measurements, not directional forecasts.",
  "",
  `Coverage: ${report.coverage.records} records · ${report.coverage.exposureMissing} missing exposure · ${report.coverage.exposurePartial} partial · ${report.coverage.exposureStale} stale · ${report.coverage.priceMissing} price failures · ${report.coverage.shockMissing} missing shock/CAR`,
  "",
  "| Series | Exposure | Horizon | Discovery rows | Coverage | β interaction | CI95 | OOS rows | OOS R² vs discovery mean |",
  "|---|---|---:|---:|---|---:|---|---:|---:|",
  ...report.studies.map((study) => {
    const fit = study.discovery;
    const oos = study.outOfSample;
    return `| ${study.seriesId} | ${study.exposureKind} | ${study.horizon} | ${fit?.rows ?? 0} | ${fit?.coverage ?? "insufficient"} | ${number(fit?.betaInteraction ?? null)} | ${fit?.ci95Interaction ? `${number(fit.ci95Interaction[0])}…${number(fit.ci95Interaction[1])}` : "—"} | ${oos?.rows ?? 0} | ${number(oos?.r2AgainstDiscoveryMean ?? null)} |`;
  }),
  "",
];
const markdown = `${lines.join("\n")}\n`;
writeFileSync(markdownPath, markdown, "utf8");
const publish = !arg("--out");
const distDir = path.resolve("dist/public/reports");
if (publish && existsSync(distDir)) {
  writeJsonAtomic(path.join(distDir, "macro-transmission-atlas.json"), report, true);
  writeFileSync(path.join(distDir, "macro-transmission-atlas.md"), markdown, "utf8");
}
prog.done(`${report.status} · records ${report.records.length} · studies ${report.studies.length} · ${jsonPath}`);
process.exit(0);
