/** Reviewed 13F event audit/remediation. Default is read-only dry-run;
 * --apply requires a fresh matching backup and an unchanged audited row set. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { fundHoldings, fundQuarters, signals } from "@db/schema";
import { applyThirteenFRemediationPlan, buildThirteenFRemediationPlan } from "../worker/lib/thirteenf-event-remediation";

const apply = process.argv.includes("--apply");
const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const outDir = path.resolve(arg("--out") ?? `worker/.runs/13f-remediation-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
mkdirSync(outDir, { recursive: true });
const db = getDb();
const sha256 = (value: unknown) => createHash("sha256").update(value).digest("hex");
const write = (name: string, value: unknown) => {
  const file = path.join(outDir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return { file: path.relative(process.cwd(), file).replaceAll("\\", "/"), bytes: readFileSync(file).length, sha256: sha256(readFileSync(file)) };
};

async function positionRows() {
  return db.select({
    id: signals.id,
    cik: signals.cik,
    source: signals.source,
    signalType: signals.signalType,
    eventTs: signals.eventTs,
    ingestedAt: signals.ingestedAt,
    payloadKey: signals.payloadKey,
    score: signals.score,
    magnitude: signals.magnitude,
    note: signals.note,
    src: signals.src,
  }).from(signals).where(and(eq(signals.source, "13f"), eq(signals.signalType, "position"))).orderBy(signals.id);
}

try {
  const rows = await positionRows();
  const quarters = await db.select({ fundCik: fundQuarters.fundCik, quarterDate: fundQuarters.quarterDate, accessionNo: fundQuarters.accessionNo, filingDate: fundQuarters.filingDate }).from(fundQuarters).orderBy(fundQuarters.fundCik, fundQuarters.quarterDate);
  const accessions = await db.selectDistinct({ fundCik: fundHoldings.fundCik, quarterDate: fundHoldings.quarterDate, accessionNo: fundHoldings.accessionNo }).from(fundHoldings).orderBy(fundHoldings.fundCik, fundHoldings.quarterDate, fundHoldings.accessionNo);
  const generatedAt = new Date().toISOString();
  const backup = write("audit-backup-signals.json", { generatedAt, rows });
  const plan = buildThirteenFRemediationPlan(rows, quarters, accessions, generatedAt);
  const backupManifest = write("remediation-backup-manifest.json", { generatedAt, beforeAnyDbWrite: true, rows: rows.length, backups: [backup] });
  write("audit.json", { ...plan, applyRequested: apply, backup: backupManifest, expectedAfterApplyBeforeRebuild: rows.length - plan.deleteCandidates.length });

  if (apply) {
    if (!existsSync(path.join(outDir, "audit-backup-signals.json"))) {
      throw new Error("Refusing apply without a machine backup");
    }
    const currentPlan = buildThirteenFRemediationPlan(await positionRows(), quarters, accessions);
    if (currentPlan.fingerprint !== plan.fingerprint) {
      throw new Error("Position rows changed after audit; refusing stale apply");
    }
    const result = await applyThirteenFRemediationPlan(db, plan);
    write("repair-apply.json", { generatedAt: new Date().toISOString(), ...result, before: plan.counts, backup: backupManifest });
    console.log(JSON.stringify({ mode: "apply", ...result, after: currentPlan.counts }, null, 2));
  } else {
    write("repair-dry-run.json", { generatedAt: new Date().toISOString(), dryRun: true, before: plan.counts, deleteCandidates: plan.deleteCandidates.length, validUntouched: plan.validUntouched.length, unknownUntouched: plan.unknownUntouched.length, backup: backupManifest });
    console.log(JSON.stringify({ mode: "dry-run", counts: plan.counts, deleteCandidates: plan.deleteCandidates.length, validUntouched: plan.validUntouched.length, unknownUntouched: plan.unknownUntouched.length, missingAvailabilityQuarters: plan.missingAvailabilityQuarters.length, backup }, null, 2));
  }
} catch (error) {
  console.error("13F remediation failed:", error instanceof Error ? error.message.slice(0, 240) : "unknown error");
  process.exitCode = 1;
} finally {
  if (db.$client?.end) await db.$client.end();
}
