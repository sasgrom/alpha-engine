/** Build source-linked exposure evidence for the reviewed universe. No LLM and no sector inference. */
import "dotenv/config";
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { and, inArray, like, or } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { facts as factRows } from "@db/schema";
import { isFinancialStatementFactForm } from "../api/services/series";
import {
  buildPilotEvidenceReport,
  EXPOSURE_CONCEPTS,
  EXPOSURE_MATURITY_PREFIX,
  type EvidenceCompanyFacts,
  type ExposureEvidence,
} from "../api/services/pilot-exposure-evidence";
import { companyFacts, loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const universeFile = arg("--universe") ?? "research-universe-50.json";
const requested = (arg("--only") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
const source = arg("--source") ?? "db";
if (source !== "db" && source !== "sec") throw new Error("--source must be db or sec");
const asOf = arg("--as-of") ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(asOf))) throw new Error("--as-of must be an ISO timestamp");
const universe = loadEdgarUniverse(universeFile).filter((company) => !requested.length || requested.includes(company.ticker));
if (!universe.length || requested.some((ticker) => !universe.some((company) => company.ticker === ticker))) {
  throw new Error(`Unknown or missing ticker scope: ${requested.join(",") || "empty universe"}`);
}

const prog = startProgress("pilot-exposure-evidence", `${universe.length} companies · ${source === "db" ? "reviewed MySQL facts" : "fresh SEC companyfacts"} · no LLM`);
const payloadsByCik = new Map<number, EvidenceCompanyFacts>();

function emptyPayload(cik: number): EvidenceCompanyFacts {
  return { cik, facts: {} };
}
function addRecord(payload: EvidenceCompanyFacts, row: {
  taxonomy: string;
  concept: string;
  unit: string;
  startDate: string | null;
  endDate: string | null;
  val: number | null;
  form: string | null;
  filed: string | null;
  accn: string | null;
}): void {
  if (!row.endDate || !isFinancialStatementFactForm(row.form)) return;
  const taxonomy = payload.facts[row.taxonomy] ?? {};
  const concept = taxonomy[row.concept] ?? { units: {} };
  const unit = concept.units[row.unit] ?? [];
  unit.push({
    end: row.endDate,
    ...(row.startDate ? { start: row.startDate } : {}),
    ...(row.val !== null ? { val: row.val } : {}),
    ...(row.form ? { form: row.form } : {}),
    ...(row.filed ? { filed: row.filed } : {}),
    ...(row.accn ? { accn: row.accn } : {}),
  });
  concept.units[row.unit] = unit;
  taxonomy[row.concept] = concept;
  payload.facts[row.taxonomy] = taxonomy;
}

if (source === "sec") {
  for (const [index, company] of universe.entries()) {
    const payload = await companyFacts(company.cik);
    const filtered = emptyPayload(company.cik);
    for (const [taxonomy, concepts] of Object.entries(payload.facts)) {
      for (const [concept, body] of Object.entries(concepts)) {
        for (const [unit, records] of Object.entries(body.units ?? {})) {
          for (const record of records) {
            addRecord(filtered, {
              taxonomy,
              concept,
              unit,
              startDate: record.start ?? null,
              endDate: record.end ?? null,
              val: typeof record.val === "number" ? record.val : null,
              form: record.form ?? null,
              filed: record.filed ?? null,
              accn: record.accn ?? null,
            });
          }
        }
      }
    }
    payloadsByCik.set(company.cik, filtered);
    prog.item(index + 1, universe.length, company.ticker);
  }
} else {
  const db = getDb();
  for (let offset = 0; offset < universe.length; offset += 5) {
    const batch = universe.slice(offset, offset + 5);
    const ciks = batch.map((company) => company.cik);
    const rows = await db.select({
      cik: factRows.cik,
      taxonomy: factRows.taxonomy,
      concept: factRows.concept,
      unit: factRows.unit,
      startDate: factRows.startDate,
      endDate: factRows.endDate,
      val: factRows.val,
      form: factRows.form,
      filed: factRows.filed,
      accn: factRows.accn,
    }).from(factRows).where(and(
      inArray(factRows.cik, ciks),
      or(
        inArray(factRows.concept, [...EXPOSURE_CONCEPTS]),
        like(factRows.concept, `${EXPOSURE_MATURITY_PREFIX}%`),
      ),
    ));
    for (const company of batch) if (!payloadsByCik.has(company.cik)) payloadsByCik.set(company.cik, emptyPayload(company.cik));
    for (const row of rows) addRecord(payloadsByCik.get(row.cik)!, row);
    prog.item(Math.min(offset + 5, universe.length), universe.length, `${batch[0].ticker}…${batch.at(-1)!.ticker} · ${rows.length} evidence facts`);
  }
}

const payloads = universe.map((company) => payloadsByCik.get(company.cik) ?? emptyPayload(company.cik));
const report = buildPilotEvidenceReport(payloads, universe.map((company) => company.ticker), asOf, new Date().toISOString());
report.source = source === "db" ? "database" : "sec_companyfacts";
const jsonPath = path.resolve(arg("--out") ?? "public/reports/pilot-exposure-evidence.json");
writeJsonAtomic(jsonPath, report, true);
const publish = !arg("--out");
const distDir = path.resolve("dist/public/reports");
if (publish && existsSync(distDir)) writeJsonAtomic(path.join(distDir, "pilot-exposure-evidence.json"), report, true);
const value = (evidence: ExposureEvidence | null | undefined) => evidence?.value === null || !evidence
  ? "—"
  : `${evidence.value} ${evidence.unit} · ${evidence.periodEnd}${evidence.stale ? " · stale" : ""}`;
const lines = [
  "# Company macro exposure evidence",
  "",
  `As of: ${report.asOf}`,
  `Source: ${report.source}`,
  "Direct SEC XBRL evidence only. No inferred fixed-rate share, hedges or geographic revenue. Source hashes cover the filtered builder inputs, not raw EDGAR packs.",
  "",
];
for (const company of report.companies) {
  lines.push(`## ${company.ticker}`, "",
    `- Fixed interest share: ${value(company.fixedInterestShare)}`,
    `- Variable interest share: ${value(company.variableInterestShare)}`,
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
const markdownPath = jsonPath.replace(/\.json$/i, ".md");
writeFileSync(markdownPath, markdown, "utf8");
if (publish && existsSync(distDir)) writeFileSync(path.join(distDir, "pilot-exposure-evidence.md"), markdown, "utf8");
prog.done(`companies ${report.companies.length} · ${jsonPath}`);
process.exit(0);
