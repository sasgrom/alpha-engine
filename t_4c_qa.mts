/**
 * QA for iteration 4c (D30/D31/D32): per-user universe + chat, live DB.
 * Uses a SYNTHETIC user id (999999 — no users row needed: membership and
 * message tables carry no FK) so real users' universes are untouched.
 * Covers: add/hide/remove round-trip, per-user scope isolation, per-user
 * screener build, chat thread unread/markRead semantics. QA membership and
 * message rows are cleaned up; the audit micro-jobs stay (they ARE the log).
 * Run: npx tsx t_4c.mts
 */
import { getDb } from "./api/queries/connection";
import { userUniverse, messages, jobs, jobLogs, users } from "@db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { universeTickersOf, allActiveUniverseTickers, invalidateScreenerCache } from "./api/services/membership";
import { resolveScope } from "./api/services/scope";
import { buildScreenerRows } from "./api/services/screener";
import { recordUniverseAction } from "./api/services/runner";

const db = getDb();
const SYNTH = 999999;
const fail = (msg: string): never => {
  console.error("FAIL:", msg);
  process.exit(1);
};

const [admin] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
if (!admin) fail("no admin user");
const adminUniverse = await universeTickersOf(admin.id);
console.log(`admin universe: ${adminUniverse.join(",")}`);

// --- membership round-trip (synthetic user, existing company AAPL) ---------
const AAPL = { cik: 320193, ticker: "AAPL", name: "Apple Inc." };
await db.insert(userUniverse).values({ userId: SYNTH, cik: AAPL.cik, ticker: AAPL.ticker, name: AAPL.name, active: true });
await recordUniverseAction("universe-add", AAPL, { id: SYNTH, name: "qa-synth" });

let tickers = await universeTickersOf(SYNTH);
if (tickers.length !== 1 || tickers[0] !== "AAPL") fail("synthetic universe wrong: " + tickers.join(","));

// isolation: admin's universe unchanged
const adminAfter = await universeTickersOf(admin.id);
if (adminAfter.length !== adminUniverse.length) fail("admin universe changed by synthetic add");

// hide → excluded from active tickers but the row stays
await db.update(userUniverse).set({ active: false }).where(and(eq(userUniverse.userId, SYNTH), eq(userUniverse.cik, AAPL.cik)));
tickers = await universeTickersOf(SYNTH);
if (tickers.length !== 0) fail("hidden membership still active");

// scope resolve: synthetic user → empty universe; admin → his set
const rSynth = await resolveScope("universe", "", SYNTH);
const rAdmin = await resolveScope("universe", "", admin.id);
if (rSynth.tickers.length !== 0) fail("synthetic universe scope not empty");
if (rAdmin.tickers.length !== adminUniverse.length) fail("admin scope drifted: " + rAdmin.tickers.join(","));
// legacy job without startedBy → admin fallback
const rLegacy = await resolveScope("universe", "", undefined);
if (rLegacy.tickers.length !== adminUniverse.length) fail("legacy fallback did not resolve to admin universe");
console.log("scope isolation + legacy fallback ok");

// re-add: fresh ACTIVE row (upsert) — exactly like a brand-new add
await db.insert(userUniverse).values({ userId: SYNTH, cik: AAPL.cik, ticker: AAPL.ticker, name: AAPL.name, active: true })
  .onDuplicateKeyUpdate({ set: { active: true, ticker: AAPL.ticker, name: AAPL.name } });
tickers = await universeTickersOf(SYNTH);
if (tickers.length !== 1) fail("re-add did not reactivate");

// per-user screener build: synthetic user gets AAPL row, admin gets his set
const rowsSynth = await buildScreenerRows(SYNTH);
if (rowsSynth.length !== 1 || rowsSynth[0].ticker !== "AAPL") fail("synthetic screener rows wrong: " + JSON.stringify(rowsSynth.map((r) => r.ticker)));
if (rowsSynth[0].price === null) fail("synthetic screener: AAPL should have price data (shared DB)");
console.log(`screener per-user ok: synth=[${rowsSynth.map((r) => r.ticker)}], price=${rowsSynth[0].price}`);

// allActiveUniverseTickers = union across users (price-import wanted set)
const union = await allActiveUniverseTickers();
if (!union.includes("AAPL")) fail("union missing AAPL");

// screener cache invalidation deletes only the caller's key
await invalidateScreenerCache(SYNTH);
console.log("membership round-trip ok");

// --- chat (D32): synthetic thread -------------------------------------------
// user → admin
const m1 = await db.insert(messages).values({ threadUserId: SYNTH, authorId: SYNTH, isAdminMsg: false, body: "QA: please update PLD coverage" });
const m1Id = Number(m1[0].insertId);
// admin unread = 1 (user messages unread), user unread = 0
const [aUnread] = await db.select({ n: sql<number>`COUNT(*)` }).from(messages)
  .where(and(isNull(messages.readAt), eq(messages.isAdminMsg, false)));
if (Number(aUnread.n) < 1) fail("admin unread count did not see the user message");
// admin → user reply
await db.insert(messages).values({ threadUserId: SYNTH, authorId: admin.id, isAdminMsg: true, body: "QA: on it" });
// user marks admin's reply read
await db.update(messages).set({ readAt: new Date() })
  .where(and(eq(messages.threadUserId, SYNTH), eq(messages.isAdminMsg, true), isNull(messages.readAt)));
const [uUnread] = await db.select({ n: sql<number>`COUNT(*)` }).from(messages)
  .where(and(eq(messages.threadUserId, SYNTH), isNull(messages.readAt), eq(messages.isAdminMsg, true)));
if (Number(uUnread.n) !== 0) fail("user unread not cleared after markRead");
console.log(`chat ok (message ids ${m1Id}…)`);

// --- audit trail check -------------------------------------------------------
const logRows = await db.select().from(jobLogs)
  .where(sql`${jobLogs.jobId} IN (SELECT id FROM jobs WHERE type='universe-add' AND startedBy=${SYNTH})`)
  .orderBy(desc(jobLogs.id)).limit(1);
if (!logRows[0]?.message.includes("UNIVERSE-ADD")) fail("audit log line missing");
console.log(`audit ok: "${logRows[0].message.slice(0, 100)}…"`);

// --- cleanup of SYNTHETIC rows (audit micro-jobs stay) -----------------------
await db.delete(messages).where(eq(messages.threadUserId, SYNTH));
await db.delete(userUniverse).where(eq(userUniverse.userId, SYNTH));
const left = await universeTickersOf(SYNTH);
if (left.length !== 0) fail("cleanup incomplete");

console.log("PASS: 4c per-user universe (add/hide/remove/re-add, isolation, screener, union) + chat + audit");
process.exit(0);
