/**
 * Pairwise messages with a conversation list and a 2,000-character composer.
 * Members can contact admins and people with whom they already share a thread;
 * owners can contact every account. Every read or send is confined to a thread
 * that includes the caller. Reviewer mutations remain blocked by middleware.
 */
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { messages, users } from "@db/schema";

const BODY_MAX = 2000;

export const convKeyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

async function requireMessageContact(ctx: { user: { id: number; role: string } }, peerId: number): Promise<void> {
  if (peerId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "cannot message yourself" });
  const db = getDb();
  const [peer] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, peerId)).limit(1);
  if (!peer) throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
  if (ctx.user.role === "admin" || peer.role === "admin") return;
  const [existing] = await db.select({ id: messages.id }).from(messages).where(eq(messages.convKey, convKeyOf(ctx.user.id, peerId))).limit(1);
  if (!existing) throw new TRPCError({ code: "FORBIDDEN", message: "this recipient is not in your allowed contacts" });
}

export const messagesRouter = createRouter({
  contacts: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const owner = ctx.user.role === "admin";
    const res: any = await db.execute(sql`
      SELECT u.id, u.username, u.name, u.role, u.lastSignInAt,
             (SELECT COUNT(*) FROM messages m WHERE m.authorId = u.id AND m.recipientId = ${ctx.user.id} AND m.readAt IS NULL) AS unread,
             (SELECT MAX(m2.createdAt) FROM messages m2 WHERE m2.convKey = CONCAT(LEAST(u.id, ${ctx.user.id}), '_', GREATEST(u.id, ${ctx.user.id}))) AS lastMsgAt,
             (SELECT MAX(a.createdAt) FROM activity_events a WHERE a.userId = u.id) AS lastActivityAt
      FROM users u
      WHERE u.id <> ${ctx.user.id}
        ${owner ? sql`` : sql`AND (u.role = 'admin' OR EXISTS (
          SELECT 1 FROM messages allowed
          WHERE (allowed.authorId = u.id AND allowed.recipientId = ${ctx.user.id})
             OR (allowed.authorId = ${ctx.user.id} AND allowed.recipientId = u.id)
        ))`}
      ORDER BY unread DESC, (lastMsgAt IS NULL) ASC, lastMsgAt DESC, (u.role = 'admin') DESC, u.username ASC
      LIMIT 500`);
    return (res[0] as any[]).map((row) => ({
      id: Number(row.id),
      username: row.username as string | null,
      name: row.name as string | null,
      unread: Number(row.unread ?? 0),
      lastMsgAt: row.lastMsgAt as string | null,
      ...(owner ? {
        role: row.role as "user" | "admin",
        lastSignInAt: row.lastSignInAt as string | null,
        lastActivityAt: row.lastActivityAt as string | null,
      } : {}),
    }));
  }),

  list: authedQuery
    .input(z.object({ withUserId: z.number(), limit: z.number().min(1).max(500).default(200) }))
    .query(async ({ input, ctx }) => {
      await requireMessageContact(ctx, input.withUserId);
      const rows = await getDb()
        .select()
        .from(messages)
        .where(eq(messages.convKey, convKeyOf(ctx.user.id, input.withUserId)))
        .orderBy(asc(messages.id))
        .limit(input.limit);
      return { withUserId: input.withUserId, rows };
    }),

  send: authedQuery
    .input(z.object({ toUserId: z.number(), body: z.string().trim().min(1).max(BODY_MAX) }))
    .mutation(async ({ input, ctx }) => {
      await requireMessageContact(ctx, input.toUserId);
      const res = await getDb().insert(messages).values({
        convKey: convKeyOf(ctx.user.id, input.toUserId),
        authorId: ctx.user.id,
        recipientId: input.toUserId,
        threadUserId: ctx.user.role === "admin" ? input.toUserId : ctx.user.id,
        isAdminMsg: ctx.user.role === "admin",
        body: input.body,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),

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

  unreadCount: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb()
      .select({ n: sql<number>`COUNT(*)` })
      .from(messages)
      .where(and(eq(messages.recipientId, ctx.user.id), isNull(messages.readAt)));
    return { count: Number(row?.n ?? 0) };
  }),
});
