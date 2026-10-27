/**
 * Reviewed local → prod companyfacts transport. One complete snapshot per CIK;
 * prod replaces only that company transactionally. No SEC requests, no scoring.
 * Run: npx tsx scripts/push-local-facts.mts [--dry] [--only XOM]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { loadEdgarUniverse, type CompanyFactRow } from "../worker/lib/edgar";
import { postFactsSnapshot, PROD_INGEST_URL } from "../worker/lib/ingest";

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const universeIdx = process.argv.indexOf("--universe");
const universeFile = universeIdx > -1 ? process.argv[universeIdx + 1] : "edgar-universe-35.json";
const dry = process.argv.includes("--dry");
const universe = loadEdgarUniverse(universeFile).filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[facts-push] unknown ticker ${only}`); process.exit(1); }
const db = getDb();
const date = (v: unknown) => v ? (typeof v === "string" ? v.slice(0, 10) : new Date(v as string).toISOString().slice(0, 10)) : null;
let companies = 0, rowsTotal = 0, failed = 0;
const missing: string[] = [];
for (const co of universe) {
  const [raw]: any = await db.execute(sql`SELECT cik, taxonomy, concept, unit, startDate, endDate, val, fy, fp, form, filed, accn FROM facts WHERE cik=${co.cik} ORDER BY id`);
  if (raw.length === 0) {
    missing.push(co.ticker);
    console.log(`[facts-push] ${co.ticker}: no local facts`);
    continue;
  }
  const rows: CompanyFactRow[] = raw.map((r: any) => ({
    cik: Number(r.cik), taxonomy: String(r.taxonomy), concept: String(r.concept), unit: String(r.unit),
    startDate: date(r.startDate), endDate: date(r.endDate), val: r.val === null ? null : Number(r.val),
    fy: r.fy === null ? null : Number(r.fy), fp: r.fp ?? null, form: r.form ?? null,
    filed: date(r.filed), accn: r.accn ?? null,
  }));
  rowsTotal += rows.length;
  if (dry) {
    console.log(`[facts-push] DRY ${co.ticker}: ${rows.length} facts`);
  } else {
    try {
      const res = await postFactsSnapshot(co.cik, rows, { url: PROD_INGEST_URL });
      console.log(`[facts-push] ${co.ticker}: ${res.replaced} replaced`);
      companies++;
    } catch (e: any) {
      failed++;
      console.error(`[facts-push] ${co.ticker}: FAILED ${String(e?.message ?? e).slice(0, 300)}`);
    }
  }
}
console.log(`[facts-push] ${dry ? "DRY " : ""}done: ${dry ? universe.length - missing.length : companies} companies · ${rowsTotal || "counts shown per company"} rows · ${missing.length} missing locally${missing.length ? ` (${missing.join(",")})` : ""} · ${failed} failed`);
process.exit(failed > 0 || (!dry && missing.length > 0) ? 1 : 0);
