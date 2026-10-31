/**
 * Messages router (4c D32 → reworked 4e D34) — messenger-style DMs between
 * ANY two users, with a contact list and search. A conversation is keyed by
 * convKey = '<minUserId>_<maxUserId>'; recipientId drives unread counts.
 *
 * Participants can read their own conversation; the ADMIN may open any
 * conversation (owner's oversight requirement — the UI tells users so).
 * Admin can also INITIATE a conversation with any user (contacts list).
 *
 * Delivery stays poll-based (React Query refetch — no websockets here).
 */
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { messages, users } from "@db/schema";

const BODY_MAX = 2000;

export const convKeyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

// Read guard note: a non-admin can only ever form convKeys that include
// THEMSELVES (ctx.user.id is always one side), so their reads are confined
// to their own conversations by construction; the admin may open any
// conversation (owner's oversight requirement — the UI tells users so).

export const messagesRouter = createRouter({
  /**
   * Contact list: every other user with the unread count for the caller and
   * last-activity markers. Search by name/username is client-side (the list
   * is small by platform scale).
   */
  contacts: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const res: any = await db.execute(sql`
      SELECT u.id, u.username, u.name, u.role, u.lastSignInAt,
             (SELECT COUNT(*) FROM messages m WHERE m.authorId = u.id AND m.recipientId = ${ctx.user.id} AND m.readAt IS NULL) AS unread,
             (SELECT MAX(m2.createdAt) FROM messages m2 WHERE m2.convKey = CONCAT(LEAST(u.id, ${ctx.user.id}), '_', GREATEST(u.id, ${ctx.user.id}))) AS lastMsgAt,
             (SELECT MAX(a.createdAt) FROM activity_events a WHERE a.userId = u.id) AS lastActivityAt
      FROM users u
      WHERE u.id <> ${ctx.user.id}
      ORDER BY (u.role = 'admin') DESC, u.username ASC
      LIMIT 500`);
    return (res[0] as any[]).map((r) => ({
      id: Number(r.id),
      username: r.username as string | null,
      name: r.name as string | null,
      role: r.role as "user" | "admin",
      lastSignInAt: r.lastSignInAt as string | null,
      unread: Number(r.unread ?? 0),
      lastMsgAt: r.lastMsgAt as string | null,
      lastActivityAt: r.lastActivityAt as string | null,
    }));
  }),

  /** Messages of my conversation with withUserId, oldest → newest. */
  list: authedQuery
    .input(z.object({ withUserId: z.number(), limit: z.number().min(1).max(500).default(200) }))
    .query(async ({ input, ctx }) => {
      const ck = convKeyOf(ctx.user.id, input.withUserId);
      const rows = await getDb()
        .select()
        .from(messages)
        .where(eq(messages.convKey, ck))
        .orderBy(asc(messages.id))
        .limit(input.limit);
      return { withUserId: input.withUserId, rows };
    }),

  /** Send a DM to any user (admin included). */
  send: authedQuery
    .input(z.object({ toUserId: z.number(), body: z.string().trim().min(1).max(BODY_MAX) }))
    .mutation(async ({ input, ctx }) => {
      if (input.toUserId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "cannot message yourself" });
      }
      const db = getDb();
      const [peer] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.toUserId)).limit(1);
      if (!peer) throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
      const res = await db.insert(messages).values({
        convKey: convKeyOf(ctx.user.id, input.toUserId),
        authorId: ctx.user.id,
        recipientId: input.toUserId,
        // deprecated 4c columns stay NOT NULL in the DB — fill them for
        // back-compat (threadUserId ≈ the non-admin side, isAdminMsg ≈ role)
        threadUserId: ctx.user.role === "admin" ? input.toUserId : ctx.user.id,
        isAdminMsg: ctx.user.role === "admin",
        body: input.body,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  /** Mark the peer's messages in this conversation as read. */
  markRead: authedQuery
    .input(z.object({ withUserId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb()
        .update(messages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(messages.convKey, convKeyOf(ctx.user.id, input.withUserId)),
            eq(messages.recipientId, ctx.user.id),
            isNull(messages.readAt)
          )
        );
      return { ok: true };
    }),

  /** Sidebar badge: my unread count across all conversations. */
  unreadCount: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb()
      .select({ n: sql<number>`COUNT(*)` })
      .from(messages)
      .where(and(eq(messages.recipientId, ctx.user.id), isNull(messages.readAt)));
    return { count: Number(row?.n ?? 0) };
  }),
});
