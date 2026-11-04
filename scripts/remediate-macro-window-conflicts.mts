/** Exact-ID macro realtime-window remediation. Default is dry-run;
 * apply requires a matching saved plan and complete current-table backup. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { asc } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { macroPoints } from "@db/schema";
import { applyExactMacroWindowRemediation, buildExactMacroWindowPlan, EXACT_MACRO_WINDOW_TARGETS, verifyExactWindowTable, verifyMacroPointBackup } from "../worker/lib/macro-window-remediation";
import type { NormalizedMacroVintageRow } from "../worker/lib/macro-vintage-backfill";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const apply = process.argv.includes("--apply");
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const outDir = path.resolve(arg("--out") ?? `worker/.runs/macro-window-remediation-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
const resultPath = path.join(outDir, apply ? "apply-result.json" : "plan.json");
if (existsSync(resultPath)) throw new Error(`Refusing to overwrite existing remediation result ${resultPath}`);
if (apply && (!arg("--plan") || !arg("--backup-manifest"))) throw new Error("Apply requires --plan and --backup-manifest");
mkdirSync(outDir, { recursive: true });
const db = getDb();
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const writeResult = (result: unknown) => {
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const parsed = JSON.parse(readFileSync(resultPath, "utf8"));
  console.log(JSON.stringify({ result: resultPath, mode: apply ? "apply" : "dry-run", status: parsed.status, message: parsed.message ?? null, diffs: parsed.diffs?.length ?? 0, mismatches: parsed.mismatches ?? [], updatedRows: parsed.apply?.updatedRows ?? 0 }, null, 2));
  if (!parsed.processCompleted) throw new Error("Remediation result did not complete");
};
let exitCode = 0;
try {
  const rows = await db.select().from(macroPoints).orderBy(asc(macroPoints.id));
  const manifest = JSON.parse(readFileSync(path.join(macroRoot, "manifest-fred.json"), "utf8"));
  const archives: Record<string, NormalizedMacroVintageRow[]> = {};
  const evidence: Record<string, { path: string; sha256: string }> = {};
  for (const seriesId of [...new Set(EXACT_MACRO_WINDOW_TARGETS.map((target) => target.seriesId))]) {
    const normalizedPath = path.join(macroRoot, "normalized", "fred", `${seriesId}.json`);
    const text = readFileSync(normalizedPath, "utf8");
    archives[seriesId] = JSON.parse(text);
    const entry = manifest.entries?.find((item: any) => item.seriesId === seriesId);
    if (!entry || entry.status !== "complete") throw new Error(`Complete manifest entry missing for ${seriesId}`);
    const rawPath = entry.raw?.observations?.file;
    if (!rawPath || sha256(readFileSync(rawPath)) !== entry.raw.observations.sha256) throw new Error(`Raw hash mismatch for ${seriesId}`);
    if (new Set(archives[seriesId].map((row) => row.sourceHash)).size !== 1 || archives[seriesId][0]?.sourceHash !== entry.raw.observations.sha256) throw new Error(`Normalized source hash mismatch for ${seriesId}`);
    evidence[seriesId] = { path: normalizedPath, sha256: sha256(text) };
  }
  const plan = buildExactMacroWindowPlan(rows, archives, evidence);
  if (apply) {
    const saved = JSON.parse(readFileSync(path.resolve(arg("--plan")!), "utf8"));
    if (saved.status !== "planned" || saved.fingerprint !== plan.fingerprint) throw new Error("Saved exact-ID plan differs from current official evidence or database rows");
  }
  if (plan.status !== "planned") {
    writeResult({ schemaVersion: 1, generatedAt: new Date().toISOString(), processCompleted: true, mode: apply ? "apply" : "dry-run", ...plan, message: "At least one exact ID mismatches official evidence; no apply is permitted" });
    exitCode = 1;
  } else if (!apply) {
    writeResult({ schemaVersion: 1, generatedAt: new Date().toISOString(), processCompleted: true, mode: "dry-run", ...plan });
  } else {
    const backup = verifyMacroPointBackup(path.resolve(arg("--backup-manifest")!), rows);
    const applied = await applyExactMacroWindowRemediation(db, plan);
    const afterRows = await db.select().from(macroPoints).orderBy(asc(macroPoints.id));
    const post = verifyExactWindowTable(backup.backupRows, afterRows, EXACT_MACRO_WINDOW_TARGETS.map((target) => target.id));
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
