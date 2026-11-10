/** Build reviewed OLS4 imputation candidates from canonical series. Read-only; never changes reported values. */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { seriesPoints } from "@db/schema";
import { buildCausalImputationReport } from "../api/services/causal-imputation";
import type { RecentGapDiagnosisReport } from "../api/services/edgar-recent-gap-diagnosis";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const ticker = arg("--ticker")?.toUpperCase();
if (!ticker || !/^[A-Z0-9._-]{1,12}$/.test(ticker)) throw new Error("Use --ticker SYMBOL");
const company = loadEdgarUniverse("research-universe-50.json").find((item) => item.ticker === ticker);
if (!company) throw new Error(`Unknown ticker ${ticker}`);
const diagnosisPath = path.resolve(arg("--diagnosis") ?? `public/reports/remediation/${ticker}-recent-gap-diagnosis.json`);
if (!existsSync(diagnosisPath)) throw new Error(`Missing ${diagnosisPath}. Run edgar-recent-gap-diagnosis first.`);
const diagnosis = JSON.parse(readFileSync(diagnosisPath, "utf8")) as RecentGapDiagnosisReport;
if (diagnosis.cik !== company.cik) throw new Error(`Diagnosis CIK ${diagnosis.cik} does not match ${ticker} CIK ${company.cik}`);
const prog = startProgress("causal-imputation", `${ticker} · availability-anchored canonical series · no DB writes`);
const rows = await getDb().select().from(seriesPoints).where(eq(seriesPoints.cik, company.cik));
const report = buildCausalImputationReport(diagnosis, rows, new Date().toISOString());
const file = path.resolve(`public/reports/remediation/${ticker}-imputation-candidates.json`);
writeJsonAtomic(file, report, true);
const distDir = path.resolve("dist/public/reports/remediation");
if (existsSync(path.dirname(distDir))) writeJsonAtomic(path.join(distDir, `${ticker}-imputation-candidates.json`), report, true);
const number = (value: number | undefined) => value === undefined ? "n/a" : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
const lines = [
  `# ${ticker} causal imputation candidates`, "",
  `Source diagnosis: ${report.sourceDiagnosisGeneratedAt}`,
  `Source facts SHA256: ${report.sourceFactsSha256}`,
  `Annual-only quarters excluded: ${report.summary.annualExcludedQuarters}`,
  `Quarterly/mixed quarters evaluated: ${report.summary.evaluatedQuarters}`,
  `Candidate quarters: ${report.summary.candidateQuarters}`,
  `Skipped quarters: ${report.summary.skippedQuarters}`, "",
  "No reported or canonical value was changed. Causal OLS4 never uses the following-quarter actual. The retrospective average uses it and inherits its sourceFiled availability anchor.", "",
  "## Candidates", "",
  ...report.quarters.filter((quarter) => quarter.status === "candidate").map((quarter) =>
    `- ${quarter.concept} · ${quarter.quarter} · ${quarter.unit} · sources ${quarter.sourceQuarters.join(", ")} · causal **${number(quarter.causal?.value)}** · retrospective ${number(quarter.retrospective?.value)} · available ${quarter.causal?.availableAt}`),
  "", "## Skipped", "",
  ...report.quarters.filter((quarter) => quarter.status === "skipped").map((quarter) => `- ${quarter.concept} · ${quarter.quarter} — ${quarter.reason}`),
];
const markdown = `${lines.join("\n")}\n`;
writeFileSync(path.resolve(`public/reports/remediation/${ticker}-imputation-candidates.md`), markdown, "utf8");
if (existsSync(path.dirname(distDir))) writeFileSync(path.join(distDir, `${ticker}-imputation-candidates.md`), markdown, "utf8");
prog.done(`${ticker} · annual excluded ${report.summary.annualExcludedQuarters} · evaluated ${report.summary.evaluatedQuarters} · candidates ${report.summary.candidateQuarters} · skipped ${report.summary.skippedQuarters}`);
process.exit(0);
