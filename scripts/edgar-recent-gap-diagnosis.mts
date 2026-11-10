/** Diagnose recent EDGAR gaps against fresh companyfacts: exact, alias or unavailable. Read-only. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { companyFacts, loadEdgarUniverse } from "../worker/lib/edgar";
import { diagnoseRecentGaps } from "../api/services/edgar-recent-gap-diagnosis";
import type { EdgarGapAnalysis } from "../api/services/edgar-gap-analysis";
import type { FundamentalIntegrityReport } from "../api/services/fundamental-integrity";
import { sha256Text } from "../worker/lib/schwab-normalize";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const ticker = arg("--ticker")?.toUpperCase();
if (!ticker || !/^[A-Z0-9._-]{1,12}$/.test(ticker)) throw new Error("Use --ticker SYMBOL");
const company = loadEdgarUniverse("research-universe-50.json").find((item) => item.ticker === ticker);
if (!company) throw new Error(`Unknown ticker ${ticker}`);
const gapPath = path.resolve(arg("--gaps") ?? "public/reports/edgar-coverage-gaps.json");
if (!existsSync(gapPath)) throw new Error(`Missing ${gapPath}. Run edgar-gap-analysis first.`);
const gapAnalysis = JSON.parse(readFileSync(gapPath, "utf8")) as EdgarGapAnalysis;
const integrityPath = path.resolve(arg("--integrity") ?? "public/reports/fundamental-integrity.json");
if (!existsSync(integrityPath)) throw new Error(`Missing ${integrityPath}. Run fundamental-integrity-audit first.`);
const integrity = JSON.parse(readFileSync(integrityPath, "utf8")) as FundamentalIntegrityReport;
if (!gapAnalysis.byCik.some((row) => row.cik === company.cik) || !integrity.issues.some((issue) => issue.cik === company.cik)) {
  throw new Error(`Inputs have no CIK ${company.cik} (${ticker}); regenerate the per-company audit and gap analysis instead of diagnosing another company's report.`);
}
if (gapAnalysis.sourceGeneratedAt !== integrity.generatedAt) {
  throw new Error("Gap analysis and integrity audit come from different runs; regenerate both before diagnosis.");
}
if (gapAnalysis.omittedGaps > 0) throw new Error("Gap analysis is capped; rerun per company with no omitted gaps before diagnosis.");
const prog = startProgress("edgar-recent-gap-diagnosis", `${ticker} · fresh companyfacts · no DB writes`);
const payload = await companyFacts(company.cik);
const sourceFactsSha256 = sha256Text(JSON.stringify(payload));
const report = diagnoseRecentGaps(gapAnalysis, integrity.issues, payload, company.cik, sourceFactsSha256, new Date().toISOString());
const file = path.resolve(`public/reports/remediation/${ticker}-recent-gap-diagnosis.json`);
writeJsonAtomic(file, report, true);
const distDir = path.resolve("dist/public/reports/remediation");
if (existsSync(path.dirname(distDir))) writeJsonAtomic(path.join(distDir, `${ticker}-recent-gap-diagnosis.json`), report, true);
const lines = [
  `# ${ticker} recent gap diagnosis`, "",
  `Source gap analysis: ${report.sourceGapGeneratedAt}`,
  `Source integrity audit: ${integrity.generatedAt}`,
  `Source facts SHA256: ${sourceFactsSha256}`,
  `Recent strict continuity errors: ${report.summary.recentErrors}`,
  `Annual-cadence findings reclassified from errors: ${report.summary.cadenceExpectedIssues}`,
  `Concepts: ${report.summary.concepts}`,
  `Missing recent quarters: ${report.summary.missingQuarters}`,
  `Exact recoverable quarters: ${report.summary.recoverableQuarters}`,
  `Alias candidate quarters: ${report.summary.aliasQuarters}`,
  `Unavailable quarters: ${report.summary.unavailableQuarters}`,
  `Annual-only concepts: ${report.summary.annualOnlyConcepts} · quarters excluded from quarterly imputation: ${report.summary.annualOnlyQuarters}`,
  `Quarterly/mixed concepts for isolated-gap review: ${report.summary.quarterlyReviewConcepts} · quarters: ${report.summary.quarterlyReviewQuarters}`, "",
  "## Concepts", "",
  ...report.gaps.map((gap) => `- ${gap.concept} · **${gap.status}** · cadence ${gap.cadence} (${gap.forms.join(", ") || "no recent form"}) · ${gap.cadenceAction} · last available ${gap.lastAvailable ?? "n/a"} · recent ${gap.recentQuarters.length} · recoverable ${gap.recoverableQuarters.length} · alias ${gap.aliasQuarters.length} · unavailable ${gap.unavailableQuarters.length} — ${gap.reason}`),
];
writeFileSync(path.resolve(`public/reports/remediation/${ticker}-recent-gap-diagnosis.md`), `${lines.join("\n")}\n`, "utf8");
if (existsSync(path.dirname(distDir))) writeFileSync(path.join(distDir, `${ticker}-recent-gap-diagnosis.md`), `${lines.join("\n")}\n`, "utf8");
prog.done(`${ticker} · recent errors ${report.summary.recentErrors} · concepts ${report.summary.concepts} · quarters ${report.summary.missingQuarters} · annual-only ${report.summary.annualOnlyQuarters} · quarterly review ${report.summary.quarterlyReviewQuarters} · exact ${report.summary.recoverableQuarters} · alias ${report.summary.aliasQuarters}`);
