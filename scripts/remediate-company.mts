/** Per-company EDGAR refresh and Schwab fallback. One ticker, one bounded chain, no hidden retries. */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildCompanyRemediationPlan } from "../api/services/company-remediation";
import type { EdgarGapAnalysis } from "../api/services/edgar-gap-analysis";
import type { RecentGapDiagnosisReport } from "../api/services/edgar-recent-gap-diagnosis";
import type { SchwabFundamentalGapMap } from "../api/services/schwab-fundamental-gap-map";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const ticker = arg("--ticker")?.toUpperCase();
if (!ticker || !/^[A-Z0-9._-]{1,12}$/.test(ticker)) throw new Error("Use --ticker SYMBOL (for example AAPL, NVDA, MU)");
const apply = process.argv.includes("--apply");
const strict = process.argv.includes("--strict");
const root = process.cwd();
const prog = startProgress("company-remediation", `${ticker} · ${apply ? "EDGAR refresh + fallback" : "dry-run audit + fallback"}`);
async function run(script: string, args: string[]): Promise<void> {
  prog.log(`step ${script} ${args.join(" ")}`);
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn("npx", ["tsx", script, ...args], { cwd: root, shell: true, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`${script} exited with code ${code}`);
}
if (apply) {
  await run("worker/edgar-fetch.mts", ["--only", ticker]);
  await run("worker/edgar-exhibits.mts", ["--universe", "research-universe-50.json", "--only", ticker]);
  await run("worker/facts-fetch.mts", ["--universe", "research-universe-50.json", "--only", ticker]);
}
await run("scripts/fundamental-integrity-audit.mts", ["--only", ticker]);
await run("scripts/edgar-gap-analysis.mts", ["--input", "public/reports/fundamental-integrity.json"]);
await run("scripts/edgar-recent-gap-diagnosis.mts", ["--ticker", ticker]);
await run("scripts/schwab-fundamental-gap-map.mts", ["--gaps", "public/reports/edgar-coverage-gaps.json", "--context", "public/reports/schwab-context.json"]);
const gapAnalysis = JSON.parse(readFileSync("public/reports/edgar-coverage-gaps.json", "utf8")) as EdgarGapAnalysis;
const recentGapDiagnosis = JSON.parse(readFileSync(`public/reports/remediation/${ticker}-recent-gap-diagnosis.json`, "utf8")) as RecentGapDiagnosisReport;
const gapMap = JSON.parse(readFileSync("public/reports/schwab-fundamental-gap-map.json", "utf8")) as SchwabFundamentalGapMap;
const plan = buildCompanyRemediationPlan({ ticker, gapAnalysis, gapMap, recentGapDiagnosis, apply, strict });
const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), ...plan };
const file = path.resolve(`public/reports/remediation/${ticker}.json`);
writeJsonAtomic(file, output, true);
const distDir = path.resolve("dist/public/reports/remediation");
if (existsSync(path.dirname(distDir))) writeJsonAtomic(path.join(distDir, `${ticker}.json`), output, true);
prog.done(`${ticker} · ${plan.nextAction} · errors ${plan.edgarErrors} · recent ${plan.recentErrors} · exact ${plan.recoverableQuarters} · alias ${plan.aliasQuarters} · unavailable ${plan.unavailableQuarters} · direct ${plan.directCandidates} · derived ${plan.derivedCandidates} · unsupported ${plan.unsupportedConcepts} · ${file}`);
if (strict && plan.edgarErrors > 0) process.exit(1);
