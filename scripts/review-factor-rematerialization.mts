/** Reviewed first-vintage factor rematerialization: dry-run by default, exact-key upsert only with --apply. */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { factorPoints } from "@db/schema";
import { computeFactorPointRows, type FactorPointWriteRow } from "../api/services/factor-ic";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { startProgress } from "../worker/lib/progress";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const apply = process.argv.includes("--apply");
const universeFile = arg("--universe") ?? "research-universe-50.json";
const only = arg("--only")?.toUpperCase() ?? null;
const universe = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (!universe.length) throw new Error("Empty factor rematerialization scope");
if (apply && only) throw new Error("--apply requires the full reviewed universe, not --only");
const defaultRoot = `worker/.runs/factor-rematerialization-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const root = path.resolve(arg("--plan") ?? arg("--out") ?? defaultRoot);
fs.mkdirSync(root, { recursive: true });
const planPath = path.join(root, "plan.json");
const keyOf = (row: { cik: number; factor: string; periodEnd: string }) => `${row.cik}|${row.factor}|${row.periodEnd}`;
const filedAt = (value: unknown) => String(value).slice(0, 19).replace("T", " ");
const sameNumber = (a: unknown, b: unknown) => {
  const left = Number(a), right = Number(b);
  return left === right || (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-12 * Math.max(1, Math.abs(left), Math.abs(right)));
};
const fingerprint = (rows: unknown) => crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const db = getDb();

async function currentRows(cik?: number) {
  if (cik) return db.select().from(factorPoints).where(eq(factorPoints.cik, cik));
  return db.select().from(factorPoints);
}

function compare(expected: FactorPointWriteRow[], existing: any[]) {
  const expectedByKey = new Map(expected.map((row) => [keyOf(row), row]));
  const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
  const missing = expected.filter((row) => !existingByKey.has(keyOf(row)));
  const extra = existing.filter((row) => !expectedByKey.has(keyOf(row)));
  const valueDiffs = [], availabilityDiffs = [];
  for (const row of expected) {
    const prior = existingByKey.get(keyOf(row));
    if (!prior) continue;
    if (!sameNumber(prior.value, row.value)) valueDiffs.push({ key: keyOf(row), before: prior.value, after: row.value });
    if (filedAt(prior.filedAt) !== filedAt(row.filedAt)) availabilityDiffs.push({ key: keyOf(row), before: filedAt(prior.filedAt), after: filedAt(row.filedAt) });
  }
  return { missing, extra, valueDiffs, availabilityDiffs };
}

if (!apply) {
  const prog = startProgress("factor-review", `${universe.length} companies · read-only rematerialization`);
  const expectedRows: FactorPointWriteRow[] = [];
  const companies = [];
  for (const [index, company] of universe.entries()) {
    const [expected, existing] = await Promise.all([computeFactorPointRows(company.cik), currentRows(company.cik)]);
    const comparison = compare(expected, existing);
    expectedRows.push(...expected);
    companies.push({ cik: company.cik, ticker: company.ticker, expected: expected.length, existing: existing.length, missing: comparison.missing.length, extra: comparison.extra.length, valueDiffs: comparison.valueDiffs.length, availabilityDiffs: comparison.availabilityDiffs.length });
    prog.item(index + 1, universe.length, `${company.ticker} · ${expected.length} rows · availability changes ${comparison.availabilityDiffs.length}`);
  }
  const [allExisting] = await Promise.all([currentRows()]);
  const comparison = compare(expectedRows, allExisting.filter((row: any) => universe.some((company) => company.cik === row.cik)));
  const expectedInversions = expectedRows.filter((row) => filedAt(row.filedAt).slice(0, 10) < row.periodEnd).length;
  const existingInversions = allExisting.filter((row: any) => universe.some((company) => company.cik === row.cik) && filedAt(row.filedAt).slice(0, 10) < row.periodEnd).length;
  const summary = {
    companies: universe.length,
    expectedRows: expectedRows.length,
    existingRows: allExisting.filter((row: any) => universe.some((company) => company.cik === row.cik)).length,
    missing: comparison.missing.length,
    extra: comparison.extra.length,
    valueDiffs: comparison.valueDiffs.length,
    availabilityDiffs: comparison.availabilityDiffs.length,
    existingInversions,
    expectedInversions,
  };
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    universeFile,
    universe: universe.map((company) => ({ cik: company.cik, ticker: company.ticker })),
    summary,
    companies,
    issues: {
      missing: comparison.missing.slice(0, 100),
      extra: comparison.extra.slice(0, 100),
      valueDiffs: comparison.valueDiffs.slice(0, 100),
      availabilityDiffs: comparison.availabilityDiffs.slice(0, 100),
    },
    expectedRows,
  };
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  prog.done(`${JSON.stringify(summary)} · ${planPath}`);
  process.exit(0);
}

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const expectedRows = plan.expectedRows as FactorPointWriteRow[];
if (!Array.isArray(expectedRows) || expectedRows.length !== plan.summary.expectedRows) throw new Error("Invalid reviewed plan");
if (plan.summary.expectedInversions !== 0) throw new Error("Apply blocked: expected availability inversions");
const expectedByKey = new Map(expectedRows.map((row) => [keyOf(row), row]));
if (expectedByKey.size !== expectedRows.length) throw new Error("Apply blocked: duplicate expected factor keys");
const before = await currentRows();
const scopedCiks = new Set((plan.universe as { cik: number }[]).map((company) => company.cik));
const scopedBefore = before.filter((row: any) => scopedCiks.has(Number(row.cik)));
const extraKeys = new Set(scopedBefore.filter((row: any) => !expectedByKey.has(keyOf(row))).map((row: any) => keyOf(row)));
if (extraKeys.size !== plan.summary.extra) throw new Error(`Apply plan changed: expected ${plan.summary.extra} extra keys, found ${extraKeys.size}`);
const liveComparison = compare(expectedRows, scopedBefore);
for (const field of ["missing", "extra", "valueDiffs", "availabilityDiffs"] as const) {
  if (liveComparison[field].length !== plan.summary[field]) throw new Error(`Apply plan changed for ${field}: ${plan.summary[field]} -> ${liveComparison[field].length}`);
}
const backupText = JSON.stringify(before, null, 2);
const backupManifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  rows: before.length,
  bytes: Buffer.byteLength(backupText),
  sha256: sha256(backupText),
  orderedRowPayloadSha256: fingerprint(before),
};
fs.writeFileSync(path.join(root, "backup-factor-points.json"), backupText);
fs.writeFileSync(path.join(root, "backup-manifest.json"), JSON.stringify(backupManifest, null, 2));

const currentFingerprint = fingerprint(before);
if (currentFingerprint !== backupManifest.orderedRowPayloadSha256) throw new Error("Backup fingerprint mismatch before apply");
let companiesApplied = 0;
let batches = 0;
for (const company of plan.universe as { cik: number; ticker: string }[]) {
  const rows = expectedRows.filter((row) => row.cik === company.cik);
  await db.transaction(async (tx) => {
    for (let offset = 0; offset < rows.length; offset += 500) {
      const chunk = rows.slice(offset, offset + 500);
      await tx.execute(sql`INSERT INTO factor_points (cik, factor, periodEnd, filedAt, value)
        VALUES ${sql.join(chunk.map((row) => sql`(${row.cik}, ${row.factor}, ${row.periodEnd}, ${filedAt(row.filedAt)}, ${row.value})`), sql`, `)}
        ON DUPLICATE KEY UPDATE filedAt=VALUES(filedAt), value=VALUES(value), computedAt=CURRENT_TIMESTAMP`);
      batches++;
    }
  });
  companiesApplied++;
}

// Extra keys are retained as explicit historical tombstones, never deleted and
// never left eligible for research. Their IDs and availability lineage remain.
let extrasRetired = 0;
const pendingExtraKeys = [...extraKeys].filter((key) => {
  const [cik, factor, periodEnd] = key.split("|");
  return before.some((row: any) => Number(row.cik) === Number(cik) && row.factor === factor && row.periodEnd === periodEnd && row.value !== null);
});
for (let offset = 0; offset < pendingExtraKeys.length; offset += 250) {
  const chunk = pendingExtraKeys.slice(offset, offset + 250);
  const tuples = chunk.map((key) => {
    const [cik, factor, periodEnd] = key.split("|");
    return sql`(${Number(cik)}, ${factor}, ${periodEnd})`;
  });
  const response: any = await db.execute(sql`UPDATE factor_points SET value=NULL, computedAt=CURRENT_TIMESTAMP
    WHERE (cik, factor, periodEnd) IN (${sql.join(tuples, sql`, `)})`);
  const affected = Number(response?.[0]?.affectedRows ?? 0);
  if (affected !== chunk.length) throw new Error(`Tombstone affected-row mismatch at ${offset}: ${affected}/${chunk.length}`);
  extrasRetired += affected;
}
const after = await currentRows();
const afterById = new Map(after.map((row: any) => [Number(row.id), row]));
const afterByKey = new Map(after.map((row: any) => [keyOf(row), row]));
let missingOriginalIds = 0;
let unexpectedOriginalChanges = 0;
let reviewedMismatches = 0;
let extraNotRetired = 0;
for (const prior of before) {
  const current: any = afterById.get(Number(prior.id));
  if (!current) { missingOriginalIds++; continue; }
  const expected = expectedByKey.get(keyOf(prior));
  if (expected) {
    if (filedAt(current.filedAt) !== filedAt(expected.filedAt) || !sameNumber(current.value, expected.value) || Number(current.cik) !== Number(expected.cik)) reviewedMismatches++;
  } else if (extraKeys.has(keyOf(prior))) {
    if (current.value !== null || current.cik !== prior.cik || current.factor !== prior.factor || current.periodEnd !== prior.periodEnd || current.filedAt !== prior.filedAt) extraNotRetired++;
  } else if (JSON.stringify(prior) !== JSON.stringify(current)) {
    unexpectedOriginalChanges++;
  }
}
for (const row of expectedRows) {
  const current: any = afterByKey.get(keyOf(row));
  if (!current || filedAt(current.filedAt) !== filedAt(row.filedAt) || !sameNumber(current.value, row.value)) reviewedMismatches++;
}
const newRows = after.filter((row: any) => !before.some((prior: any) => Number(prior.id) === Number(row.id)));
const remainingInversions = after.filter((row: any) => row.value !== null && plan.universe.some((company: any) => company.cik === row.cik) && filedAt(row.filedAt).slice(0, 10) < row.periodEnd).length;
const postcheck = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  pass: missingOriginalIds === 0 && unexpectedOriginalChanges === 0 && reviewedMismatches === 0 && remainingInversions === 0 && extraNotRetired === 0 && extrasRetired === plan.summary.extra && newRows.length === plan.summary.missing,
  companiesApplied,
  batches,
  beforeRows: before.length,
  afterRows: after.length,
  newRows: newRows.length,
  extrasRetired,
  missingOriginalIds,
  unexpectedOriginalChanges,
  reviewedMismatches,
  extraNotRetired,
  remainingInversions,
  afterFingerprint: fingerprint(after),
};
fs.writeFileSync(path.join(root, "apply-result.json"), JSON.stringify({ companiesApplied, batches, beforeRows: before.length, afterRows: after.length, newRows: newRows.length, extrasRetired }, null, 2));
fs.writeFileSync(path.join(root, "postcheck.json"), JSON.stringify(postcheck, null, 2));
console.log(JSON.stringify(postcheck, null, 2));
process.exit(postcheck.pass ? 0 : 1);
