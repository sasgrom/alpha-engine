/** Reviewed exact-ID macro source remediation. Default is dry-run;
 * --apply requires a matching saved plan and a complete current-table backup. */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { asc } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { macroPoints } from "@db/schema";
import { applyMacroSourcePlan, buildMacroSourcePlan, verifyMacroSourceTable } from "../worker/lib/macro-source-remediation";
import { verifyMacroPointBackup } from "../worker/lib/macro-window-remediation";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const apply = process.argv.includes("--apply");
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const outDir = path.resolve(arg("--out") ?? `worker/.runs/macro-source-plan-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
const resultPath = path.join(outDir, apply ? "apply-result.json" : "plan.json");
if (existsSync(resultPath)) throw new Error(`Refusing to overwrite ${resultPath}`);
if (apply && (!arg("--plan") || !arg("--backup-manifest"))) throw new Error("Apply requires --plan and --backup-manifest");
mkdirSync(outDir, { recursive: true });
const db = getDb();
const writeResult = (result: unknown) => {
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const parsed = JSON.parse(readFileSync(resultPath, "utf8"));
  console.log(JSON.stringify({ result: resultPath, status: parsed.status, message: parsed.message ?? null, decisions: parsed.decisions ?? [], mismatches: parsed.mismatches ?? [], apply: parsed.apply ?? null, post: parsed.post ?? null }, null, 2));
  if (!parsed.processCompleted) throw new Error("Macro source result did not complete");
};
let exitCode = 0;
try {
  const rows = await db.select().from(macroPoints).orderBy(asc(macroPoints.id));
  const fedArchive = JSON.parse(readFileSync(path.join(macroRoot, "normalized/fred/FEDFUNDS.json"), "utf8"));
  const cpiArchive = JSON.parse(readFileSync(path.join(macroRoot, "normalized/fred/CPIAUCSL.json"), "utf8"));
  const plan = buildMacroSourcePlan(rows, fedArchive, cpiArchive);
  if (apply) {
    const saved = JSON.parse(readFileSync(path.resolve(arg("--plan")!), "utf8"));
    if (saved.status !== "planned" || saved.fingerprint !== plan.fingerprint) throw new Error("Saved plan differs from current official evidence or database rows");
  }
  if (plan.status !== "planned") {
    writeResult({ schemaVersion: 1, generatedAt: new Date().toISOString(), processCompleted: true, mode: apply ? "apply" : "dry-run", status: "mismatch", ...plan });
    exitCode = 1;
  } else if (!apply) {
    writeResult({ schemaVersion: 1, generatedAt: new Date().toISOString(), processCompleted: true, mode: "dry-run", status: "planned", ...plan });
  } else {
    const backup = verifyMacroPointBackup(path.resolve(arg("--backup-manifest")!), rows);
    const applied = await applyMacroSourcePlan(db, plan);
    const afterRows = await db.select().from(macroPoints).orderBy(asc(macroPoints.id));
    const post = verifyMacroSourceTable(backup.backupRows, afterRows, plan);
    writeResult({ schemaVersion: 1, generatedAt: new Date().toISOString(), processCompleted: true, mode: "apply", ...plan, status: post.status === "pass" ? "complete" : "failed_verification", backup: { path: backup.backupPath, sha256: backup.manifest.sha256, fingerprint: backup.fingerprint }, apply: applied, post });
    if (post.status !== "pass") exitCode = 1;
  }
} catch (error) {
  writeResult({ schemaVersion: 1, generatedAt: new Date().toISOString(), processCompleted: true, mode: apply ? "apply" : "dry-run", status: "error", message: error instanceof Error ? error.message.slice(0, 1000) : "unknown error" });
  exitCode = 1;
} finally {
  await db.$client.end();
}
process.exitCode = exitCode;
