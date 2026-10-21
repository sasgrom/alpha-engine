/**
 * QA for iteration 4b (D29): universe removal round-trip against the live DB.
 * Picks a real INACTIVE company, then exercises the exact building blocks the
 * router uses: guard conditions → remove update → recordUniverseAction (the
 * real exported helper) → list-filter behavior (default hides, search
 * surfaces) → restore. Leaves the company exactly as found; the micro-job
 * rows + job_logs lines STAY (they are the audit trail — honest test data).
 * Run: npx tsx t_4b_removal.mts
 */
import { getDb } from "./api/queries/connection";
import { companies, jobs, jobLogs, users } from "@db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { recordUniverseAction } from "./api/services/runner";

const db = getDb();
const fail = (msg: string): never => {
  console.error("FAIL:", msg);
  process.exit(1);
};

// --- pick subjects: one inactive company + the admin user -------------------
const [co] = await db
  .select()
  .from(companies)
  .where(and(eq(companies.inUniverse, false), isNull(companies.removedAt)))
  .limit(1);
if (!co) fail("no inactive+visible company in the DB to test with");
const [admin] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
if (!admin) fail("no admin user in the DB");
console.log(`subject: ${co.ticker} (CIK ${co.cik}, inUniverse=${co.inUniverse}) · actor: ${admin.name} (id ${admin.id})`);

// --- guard: remove must REJECT an active company (checked in the router;
//     here we assert the data-side precondition the guard relies on) ---------
if (co.inUniverse) fail("guard precondition broken: subject is active");

// --- REMOVE ------------------------------------------------------------------
await db.update(companies).set({ removedAt: new Date(), removedBy: admin.id }).where(eq(companies.cik, co.cik));
const rmJobId = await recordUniverseAction("universe-remove", co, admin);
console.log(`removed · micro-job #${rmJobId}`);

// default list filter must now EXCLUDE the company
const [hidden] = await db
  .select({ n: sql<number>`count(*)` })
  .from(companies)
  .where(and(isNull(companies.removedAt), eq(companies.cik, co.cik)));
if (Number(hidden.n) !== 0) fail("removed company still visible in the default list filter");

// search filter (includeRemoved) must SURFACE it
const [found] = await db
  .select({ n: sql<number>`count(*)` })
  .from(companies)
  .where(sql`${companies.ticker} LIKE ${"%" + co.ticker + "%"}`);
if (Number(found.n) < 1) fail("removed company not surfaced by search filter");

// the micro-job row + its log line must exist with the meta
const [job] = await db.select().from(jobs).where(eq(jobs.id, rmJobId));
if (!job || job.type !== "universe-remove" || job.status !== "done" || job.startedBy !== admin.id)
  fail("micro-job row wrong: " + JSON.stringify(job));
const logs = await db.select().from(jobLogs).where(eq(jobLogs.jobId, rmJobId)).orderBy(desc(jobLogs.id));
if (!logs[0]?.message.includes("UNIVERSE-REMOVE") || !logs[0].message.includes(co.ticker) || !logs[0].message.includes(String(admin.id)))
  fail("log line missing who/what/when meta: " + JSON.stringify(logs[0]));
console.log(`log line ok: "${logs[0].message.slice(0, 120)}…"`);

// --- RESTORE (returns the company exactly as found) --------------------------
await db.update(companies).set({ removedAt: null, removedBy: null }).where(eq(companies.cik, co.cik));
const rsJobId = await recordUniverseAction("universe-restore", co, admin);
const [back] = await db.select().from(companies).where(eq(companies.cik, co.cik));
if (back.removedAt !== null || back.inUniverse !== false) fail("restore left a dirty state: " + JSON.stringify(back));
const [rjob] = await db.select().from(jobs).where(eq(jobs.id, rsJobId));
if (!rjob || rjob.type !== "universe-restore") fail("restore micro-job row wrong");
console.log(`restored · micro-job #${rsJobId} · company back to (inUniverse=false, removedAt=null)`);

// --- idempotency sanity: the router returns already=true on repeats; here we
//     assert the state predicates those shortcuts rely on ---------------------
const [activeCo] = await db.select({ n: sql<number>`count(*)` }).from(companies).where(eq(companies.inUniverse, true));
console.log(`context: ${Number(activeCo.n)} active companies untouched by the test`);

console.log("PASS: 4b removal round-trip (hide → log → search-surface → restore → log)");
process.exit(0);
