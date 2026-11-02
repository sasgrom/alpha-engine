/** Build an evidence-only company exposure table from canonical SEC series. No sector inference or production sync. */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { companies as companyRegistry, seriesPoints } from "@db/schema";
import { buildCompanyExposureReport, mergeCompanyExposureReports, type CompanyExposureInput, type CompanyExposureReport, type ExposureMetric } from "../api/services/company-exposure";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "research-universe-51.json";
const asOf = arg("--as-of") ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(asOf))) throw new Error("--as-of must be an ISO timestamp");
const universe = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const db = getDb();
const prog = startProgress("company-exposure", `${universe.length} companies · evidence only · no direction score`);
const ciks = universe.map((company) => company.cik);
const metadata = await db.select().from(companyRegistry).where(inArray(companyRegistry.cik, ciks));
const seriesRows: Array<typeof seriesPoints.$inferSelect> = [];
for (let offset = 0; offset < ciks.length; offset += 5) {
  const batch = ciks.slice(offset, offset + 5);
  seriesRows.push(...await db.select().from(seriesPoints).where(inArray(seriesPoints.cik, batch)));
}
const metadataByCik = new Map(metadata.map((row) => [row.cik, row]));
const rowsByCik = new Map<number, typeof seriesRows>();
for (const row of seriesRows) rowsByCik.set(row.cik, [...(rowsByCik.get(row.cik) ?? []), row]);
const inputs: CompanyExposureInput[] = universe.map((company, index) => {
  const rows = rowsByCik.get(company.cik) ?? [];
  prog.item(index + 1, universe.length, `${company.ticker} · ${rows.length} series rows`);
  return {
    cik: company.cik,
    ticker: company.ticker,
    name: metadataByCik.get(company.cik)?.name ?? company.name ?? company.ticker,
    sector: metadataByCik.get(company.cik)?.sector ?? null,
    rows,
  };
});
const jsonPath = path.resolve("public/reports/company-exposures.json");
const generated = buildCompanyExposureReport(inputs, asOf, new Date().toISOString());
const previous = only && existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) as CompanyExposureReport : null;
const report = previous ? mergeCompanyExposureReports(previous, generated) : generated;
writeJsonAtomic(jsonPath, report, true);
const distDir = path.resolve("dist/public/reports");
if (existsSync(distDir)) writeJsonAtomic(path.join(distDir, "company-exposures.json"), report, true);
const number = (metric: ExposureMetric) => metric.value === null ? "—" : metric.unit === "ratio" ? metric.value.toFixed(3) : metric.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const period = (metric: ExposureMetric) => metric.periodEnd ? `${metric.periodEnd}${metric.stale ? " · stale" : ""}` : "—";
const lines = [
  "# Company macro exposure evidence", "",
  `As of: ${report.asOf}`,
  `Universe SHA256: ${report.universeSha256}`,
  "Only directly supported metrics are populated. No sector-derived direction scores. Missing evidence remains missing.", "",
  `Coverage: debt ${report.coverage.debt}/${report.coverage.companies} · interest coverage ${report.coverage.interestCoverage} · fuel ${report.coverage.fuelCost} · oil revenue ${report.coverage.oilRevenue} · oil cost ${report.coverage.oilCost} · foreign revenue share ${report.coverage.foreignRevenueShare}`, "",
  "| Ticker | Sector | Debt | Debt period | Debt / op. income | Interest coverage | Cash / debt | Fuel / op. income | Fuel period | Oil revenue / cost | Oil period | Foreign revenue share | FX period |", 
  "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | ---: | --- | ---: | --- |",
  ...report.companies.map((company) => `| ${company.ticker} | ${company.sector ?? "—"} | ${number(company.debt)} | ${period(company.debt)} | ${number(company.debtToOperatingIncome)} | ${number(company.interestCoverage)} | ${number(company.cashToDebt)} | ${number(company.fuelCostToOperatingIncome)} | ${period(company.fuelCostToOperatingIncome)} | ${number(company.oilRevenue)} / ${number(company.oilCost)} | ${period(company.oilRevenue.quality !== "missing" ? company.oilRevenue : company.oilCost)} | ${number(company.foreignRevenueShare)} | ${period(company.foreignRevenueShare)} |`),
  "", "## Missing evidence by company", "",
  ...report.companies.map((company) => `- ${company.ticker}: ${company.missing.join(", ")}`),
];
const markdown = `${lines.join("\n")}\n`;
writeFileSync(path.resolve("public/reports/company-exposures.md"), markdown, "utf8");
if (existsSync(distDir)) writeFileSync(path.join(distDir, "company-exposures.md"), markdown, "utf8");
prog.done(`companies ${report.coverage.companies} · debt ${report.coverage.debt} · interest coverage ${report.coverage.interestCoverage} · fuel ${report.coverage.fuelCost} · foreign revenue share ${report.coverage.foreignRevenueShare} · ${jsonPath}`);
process.exit(0);
