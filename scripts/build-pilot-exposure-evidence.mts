/** Build source-linked pilot evidence from fresh SEC companyfacts. No LLM and no sector inference. */
import path from "node:path";
import { buildPilotEvidenceReport, type EvidenceCompanyFacts, type ExposureEvidence } from "../api/services/pilot-exposure-evidence";
import { companyFacts, loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";
import { existsSync, writeFileSync } from "node:fs";

const PILOTS = ["DAL", "RCL", "CVX", "COP", "PFE"] as const;
const asOf = new Date().toISOString();
const universe = loadEdgarUniverse("research-universe-51.json");
const prog = startProgress("pilot-exposure-evidence", "fresh SEC facts · exact concepts · no LLM");
const payloads: EvidenceCompanyFacts[] = [];
for (const [index, ticker] of PILOTS.entries()) {
  const company = universe.find((item) => item.ticker === ticker);
  if (!company) throw new Error(`Missing pilot ${ticker}`);
  payloads.push(await companyFacts(company.cik));
  prog.item(index + 1, PILOTS.length, ticker);
}
const report = buildPilotEvidenceReport(payloads, [...PILOTS], asOf, new Date().toISOString());
const jsonPath = path.resolve("public/reports/pilot-exposure-evidence.json");
writeJsonAtomic(jsonPath, report, true);
const distDir = path.resolve("dist/public/reports");
if (existsSync(distDir)) writeJsonAtomic(path.join(distDir, "pilot-exposure-evidence.json"), report, true);
const value = (evidence: ExposureEvidence | null) => evidence?.value === null || !evidence ? "—" : `${evidence.value} ${evidence.unit} · ${evidence.periodEnd}${evidence.stale ? " · stale" : ""}`;
const lines = ["# Pilot macro exposure evidence", "", `As of: ${report.asOf}`, "Direct SEC XBRL evidence only. No inferred fixed-rate share, hedges or geographic revenue.", ""];
for (const company of report.companies) {
  lines.push(`## ${company.ticker}`, "",
    `- Fixed interest share: ${value(company.fixedInterestShare)}`,
    `- Weighted average interest rate: ${value(company.weightedAverageInterestRate)}`,
    `- Interest-rate hedge share: ${value(company.interestRateHedgeShare)}`,
    `- Effective interest rate: ${value(company.effectiveInterestRate)}`,
    `- Debt maturity concepts: ${company.debtMaturities.length}`,
    `- Fuel cost: ${value(company.fuelCost)}`,
    `- Oil revenue: ${value(company.oilRevenue)}`,
    `- Oil cost: ${value(company.oilCost)}`,
    `- Foreign revenue share: ${value(company.foreignRevenueShare)}`,
    `- Foreign derivative notional: ${value(company.foreignDerivativeNotional)}`,
    `- Missing: ${company.missing.join("; ") || "none"}`,
    `- Source facts SHA256: ${company.sourceFactsSha256}`, "");
}
const markdown = `${lines.join("\n")}\n`;
writeFileSync(path.resolve("public/reports/pilot-exposure-evidence.md"), markdown, "utf8");
if (existsSync(distDir)) writeFileSync(path.join(distDir, "pilot-exposure-evidence.md"), markdown, "utf8");
prog.done(`companies ${report.companies.length} · ${jsonPath}`);
