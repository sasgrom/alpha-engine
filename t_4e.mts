/**
 * QA for iteration 4e (D34/D35/D36), live DB (the NEW prod DB).
 * Synthetic users qa_* are created and cascaded away; nothing shared touched.
 * Covers: pairwise DM + unread + markRead + admin oversight read, contacts
 * list SQL, activity record/summary, effectiveUserId view-as lens.
 * Run: npx tsx t_4e.mts
 */
import { getDb } from "./api/queries/connection";
import { messages } from "@db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { convKeyOf } from "./api/routers/messages";
import { createLocalUser, deleteUserCascade, findUserByUsername } from "./api/queries/users";
import { recordEvent, activitySummary, recentActivity } from "./api/services/activity";
import { effectiveUserId } from "./api/middleware";
import { hashPassword } from "./api/services/passwords";

const db = getDb();
const fail = (m: string): never => {
  console.error("FAIL:", m);
  process.exit(1);
};

// --- setup: two synthetic users ----------------------------------------------
const suffix = Math.random().toString(36).slice(2, 6);
const ua = await createLocalUser({ username: `qa_a${suffix}`, passwordHash: await hashPassword("qa-pass-1"), role: "user" });
const ub = await createLocalUser({ username: `qa_b${suffix}`, passwordHash: await hashPassword("qa-pass-1"), role: "user" });
if (!ua?.id || !ub?.id) fail("synthetic users not created");
const [adminRow]: any = (await db.execute(sql`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`))[0];
console.log(`synthetic users: ${ua.id}, ${ub.id} · admin id=${adminRow.id}`);

// --- D34: pairwise DM ----------------------------------------------------------
const ck = convKeyOf(ua.id, ub.id);
if (ck !== convKeyOf(ub.id, ua.id)) fail("convKey not symmetric");

// A → B
await db.insert(messages).values({ convKey: ck, authorId: ua.id, recipientId: ub.id, threadUserId: ua.id, isAdminMsg: false, body: "hi B" });
// unread for B = 1
let [u]: any = (await db.execute(sql`SELECT COUNT(*) n FROM messages WHERE recipientId=${ub.id} AND readAt IS NULL`))[0];
if (Number(u.n) !== 1) fail("unread for B != 1");
// B → A reply
await db.insert(messages).values({ convKey: ck, authorId: ub.id, recipientId: ua.id, threadUserId: ua.id, isAdminMsg: false, body: "hi A" });
[u] = (await db.execute(sql`SELECT COUNT(*) n FROM messages WHERE recipientId=${ua.id} AND readAt IS NULL`))[0];
if (Number(u.n) !== 1) fail("unread for A != 1");
// conversation read (what messages.list does)
const rows = await db.select().from(messages).where(eq(messages.convKey, ck)).orderBy(asc(messages.id));
if (rows.length !== 2) fail("conversation read wrong");
// B reads A's message → markRead semantics
await db.update(messages).set({ readAt: new Date() })
  .where(and(eq(messages.convKey, ck), eq(messages.recipientId, ub.id), isNull(messages.readAt)));
[u] = (await db.execute(sql`SELECT COUNT(*) n FROM messages WHERE recipientId=${ub.id} AND readAt IS NULL`))[0];
if (Number(u.n) !== 0) fail("markRead did not clear B's unread");
console.log("DM round-trip + unread + markRead ok");

// contacts SQL (admin perspective — must list both synthetic users)
const contactsRes: any = await db.execute(sql`
  SELECT u.id, u.username,
         (SELECT COUNT(*) FROM messages m WHERE m.authorId = u.id AND m.recipientId = ${adminRow.id} AND m.readAt IS NULL) AS unread
  FROM users u WHERE u.id <> ${adminRow.id} ORDER BY (u.role = 'admin') DESC, u.username ASC LIMIT 500`);
const contactIds = (contactsRes[0] as any[]).map((r) => Number(r.id));
if (!contactIds.includes(ua.id) || !contactIds.includes(ub.id)) fail("contacts list missing synthetic users");
console.log(`contacts list ok (${contactIds.length} contacts for admin)`);

// --- D35: activity -------------------------------------------------------------
await recordEvent(ua.id, "login", { ip: "203.0.113.1" });
await recordEvent(ua.id, "page", { path: "/universe", ip: "203.0.113.1" });
await recordEvent(ua.id, "page", { path: "/screener", ip: "203.0.113.1" });
const sum = await activitySummary(ua.id);
if (sum.totalEvents !== 3 || sum.logins7d !== 1 || sum.pages24h !== 2) fail("activitySummary wrong: " + JSON.stringify(sum));
const recent = await recentActivity(ua.id, 10);
if (recent.length !== 3 || recent[0].type !== "page") fail("recentActivity wrong");
console.log(`activity ok: ${JSON.stringify(sum)}`);

// --- D36: effectiveUserId -------------------------------------------------------
const ctxPlain = { user: { id: 5 }, viewAsUserId: null };
const ctxLens = { user: { id: 1 }, viewAsUserId: 5 };
if (effectiveUserId(ctxPlain as any) !== 5) fail("plain ctx not identity");
if (effectiveUserId(ctxLens as any) !== 5) fail("view-as ctx not resolved");
console.log("effectiveUserId ok");

// --- cleanup (cascade covers memberships/messages/activity) --------------------
await deleteUserCascade(ua.id);
await deleteUserCascade(ub.id);
if (await findUserByUsername(`qa_a${suffix}`)) fail("cascade left qa_a behind");
const [leftMsg]: any = (await db.execute(sql`SELECT COUNT(*) n FROM messages WHERE convKey=${ck}`))[0];
if (Number(leftMsg.n) !== 0) fail("cascade left messages behind");
const [leftAct]: any = (await db.execute(sql`SELECT COUNT(*) n FROM activity_events WHERE userId=${ua.id}`))[0];
if (Number(leftAct.n) !== 0) fail("cascade left activity behind");
console.log("cascade cleanup ok");

console.log("PASS: 4e (contacts DM + activity collection + view-as lens)");
process.exit(0);
