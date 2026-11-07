/** Build an evidence-only company exposure table from canonical SEC series. No sector inference or production sync. */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { companies as companyRegistry, seriesPoints } from "@db/schema";
import { buildCompanyExposureReport, mergeCompanyExposureReports, type CompanyExposureInput, type CompanyExposureReport, type ExposureMetric } from "../api/services/company-exposure";
import type { ExposureEvidence, PilotEvidenceReport } from "../api/services/pilot-exposure-evidence";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "research-universe-50.json";
const asOf = arg("--as-of") ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(asOf))) throw new Error("--as-of must be an ISO timestamp");
const universe = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const db = getDb();
const prog = startProgress("company-exposure", `${universe.length} companies · evidence only · no direction score`);
const ciks = universe.map((company) => company.cik);
const metadata = await db.select().from(companyRegistry).where(inArray(companyRegistry.cik, ciks));
const seriesRows: Array<typeof seriesPoints.$inferSelect> = [];
const EXPOSURE_SERIES_CONCEPTS = [
  "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt", "LongTermDebtCurrent", "LongTermDebtNoncurrent", "DebtInstrumentCarryingAmount",
  "OperatingIncomeLoss", "InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestIncomeExpenseNet",
  "CashAndCashEquivalentsAtCarryingValue", "FuelCosts", "OilAndGasRevenue", "CostOfPurchasedOilAndGas",
  "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
  "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile",
  "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToForeignCountries",
  "NotionalAmountOfForeignCurrencyDerivatives",
];
for (let offset = 0; offset < ciks.length; offset += 5) {
  const batch = ciks.slice(offset, offset + 5);
  const batchRows = await db.select().from(seriesPoints).where(and(
    inArray(seriesPoints.cik, batch),
    inArray(seriesPoints.concept, EXPOSURE_SERIES_CONCEPTS),
    eq(seriesPoints.vintage, "latest"),
  ));
  for (const row of batchRows) seriesRows.push(row);
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
const publishedJsonPath = path.resolve("public/reports/company-exposures.json");
const jsonPath = path.resolve(arg("--out") ?? publishedJsonPath);
const generated = buildCompanyExposureReport(inputs, asOf, new Date().toISOString());
const previous = only && existsSync(publishedJsonPath) ? JSON.parse(readFileSync(publishedJsonPath, "utf8")) as CompanyExposureReport : null;
const report = previous ? mergeCompanyExposureReports(previous, generated) : generated;
const pilotEvidencePath = arg("--pilot-evidence");
if (pilotEvidencePath) {
  const pilot = JSON.parse(readFileSync(path.resolve(pilotEvidencePath), "utf8")) as PilotEvidenceReport;
  const byTicker = new Map(pilot.companies.map((company) => [company.ticker, company]));
  const directMetric = (evidence: ExposureEvidence | null): ExposureMetric | null => {
    if (!evidence || evidence.value === null || !evidence.periodEnd) return null;
    return {
      value: evidence.value,
      unit: evidence.unit,
      concepts: evidence.concepts ?? (evidence.concept ? [evidence.concept] : []),
      periodEnd: evidence.periodEnd,
      sourceFiled: evidence.availableAt,
      quality: "available",
      note: evidence.note,
      stale: evidence.stale,
    };
  };
  for (const company of report.companies) {
    const evidence = byTicker.get(company.ticker);
    if (!evidence) continue;
    const foreign = directMetric(evidence.foreignRevenueShare);
    const derivative = directMetric(evidence.foreignDerivativeNotional);
    if (foreign) company.foreignRevenueShare = foreign;
    if (derivative) company.foreignDerivativeNotional = derivative;
    const retainedMissing = company.missing.filter((item) => !["floating rate share", "debt maturity schedule", "foreign revenue share"].includes(item));
    company.missing = [...new Set([...retainedMissing, ...evidence.missing])];
  }
  report.coverage.foreignRevenueShare = report.companies.filter((company) => company.foreignRevenueShare.quality !== "missing").length;
}
writeJsonAtomic(jsonPath, report, true);
const publish = !arg("--out");
const distDir = path.resolve("dist/public/reports");
if (publish && existsSync(distDir)) writeJsonAtomic(path.join(distDir, "company-exposures.json"), report, true);
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
writeFileSync(jsonPath.replace(/\.json$/i, ".md"), markdown, "utf8");
if (publish && existsSync(distDir)) writeFileSync(path.join(distDir, "company-exposures.md"), markdown, "utf8");
prog.done(`companies ${report.coverage.companies} · debt ${report.coverage.debt} · interest coverage ${report.coverage.interestCoverage} · fuel ${report.coverage.fuelCost} · foreign revenue share ${report.coverage.foreignRevenueShare} · ${jsonPath}`);
process.exit(0);
