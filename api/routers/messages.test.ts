import { beforeEach, describe, expect, it, vi } from "vitest";
import { messagesRouter } from "./messages";

const state = vi.hoisted(() => ({
  contactRows: [] as any[],
  peer: { id: 3, role: "user" } as { id: number; role: string } | null,
  hasThread: false,
  threadRows: [] as any[],
  inserted: null as any,
  sqlText: "",
}));

function sqlText(value: any): string {
  if (Array.isArray(value)) return value.map(sqlText).join("");
  if (typeof value === "string") return value;
  if (value?.queryChunks) return sqlText(value.queryChunks);
  if (Array.isArray(value?.value)) return sqlText(value.value);
  if (value?.value !== undefined && typeof value.value !== "object") return String(value.value);
  return "";
}

vi.mock("../queries/connection", () => ({
  getDb: () => {
    const builder = (result: any): any => ({
      from: () => builder(result),
      where: () => builder(result),
      orderBy: () => builder(result),
      limit: async () => result,
    });
    return {
      execute: async (query: unknown) => {
        state.sqlText = sqlText(query);
        return [state.contactRows];
      },
      select: (selection?: Record<string, unknown>) => {
        if (selection === undefined) return builder(state.threadRows);
        if ("role" in selection) return builder(state.peer ? [state.peer] : []);
        return builder(state.hasThread ? [{ id: 1 }] : []);
      },
      insert: () => ({
        values: async (values: unknown) => {
          state.inserted = values;
          return [{ insertId: 123 }];
        },
      }),
    };
  },
}));

function caller(role: "admin" | "user") {
  return messagesRouter.createCaller({
    req: new Request("http://127.0.0.1/"),
    resHeaders: new Headers(),
    viewAsUserId: null,
    user: { id: role === "admin" ? 1 : 2, role } as any,
    reviewerAccess: null,
  });
}

describe("message contact privacy", () => {
  beforeEach(() => {
    state.contactRows = [
      { id: 1, username: "owner", name: "Owner", role: "admin", lastSignInAt: "2026-11-13", unread: 0, lastMsgAt: null, lastActivityAt: "2026-11-13" },
      { id: 3, username: "peer", name: "Thread Peer", role: "user", lastSignInAt: "2026-11-12", unread: 2, lastMsgAt: "2026-11-12", lastActivityAt: "2026-11-12" },
    ];
    state.peer = { id: 3, role: "user" };
    state.hasThread = false;
    state.threadRows = [];
    state.inserted = null;
    state.sqlText = "";
  });

  it("limits member contacts by SQL and omits roles and activity", async () => {
    const rows = await caller("user").contacts();
    expect(state.sqlText).toContain("u.role = 'admin' OR EXISTS");
    expect(state.sqlText).toContain("allowed.authorId");
    expect(state.sqlText).toContain("ORDER BY unread DESC");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty("role");
      expect(row).not.toHaveProperty("lastSignInAt");
      expect(row).not.toHaveProperty("lastActivityAt");
    }
    expect(rows[1]).toMatchObject({ id: 3, unread: 2, lastMsgAt: "2026-11-12" });
  });

  it("keeps the full account list and intel fields for the owner", async () => {
    const rows = await caller("admin").contacts();
    expect(state.sqlText).not.toContain("allowed.authorId");
    expect(rows[0]).toMatchObject({ id: 1, role: "admin", lastSignInAt: "2026-11-13", lastActivityAt: "2026-11-13" });
    expect(rows[1]).toMatchObject({ id: 3, role: "user", lastActivityAt: "2026-11-12" });
  });
});

describe("message recipient authorization", () => {
  beforeEach(() => {
    state.peer = { id: 3, role: "user" };
    state.hasThread = false;
    state.threadRows = [];
    state.inserted = null;
  });

  it("refuses list and send when a member has no thread with another member", async () => {
    await expect(caller("user").list({ withUserId: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").send({ toUserId: 3, body: "not allowed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.inserted).toBeNull();
  });

  it("allows list and send for an existing member thread", async () => {
    state.hasThread = true;
    state.threadRows = [{ id: 8, body: "existing" }];
    await expect(caller("user").list({ withUserId: 3 })).resolves.toEqual({ withUserId: 3, rows: state.threadRows });
    await expect(caller("user").send({ toUserId: 3, body: "reply" })).resolves.toEqual({ ok: true, id: 123 });
    expect(state.inserted).toMatchObject({ convKey: "2_3", authorId: 2, recipientId: 3, body: "reply" });
  });

  it("allows a member to write an admin without an existing thread", async () => {
    state.peer = { id: 3, role: "admin" };
    await expect(caller("user").send({ toUserId: 3, body: "admin question" })).resolves.toEqual({ ok: true, id: 123 });
    expect(state.inserted).toMatchObject({ convKey: "2_3", authorId: 2, recipientId: 3 });
  });

  it("allows the owner to list and write any account without an existing thread", async () => {
    await expect(caller("admin").list({ withUserId: 3 })).resolves.toEqual({ withUserId: 3, rows: [] });
    await expect(caller("admin").send({ toUserId: 3, body: "owner note" })).resolves.toEqual({ ok: true, id: 123 });
    expect(state.inserted).toMatchObject({ convKey: "1_3", authorId: 1, recipientId: 3, isAdminMsg: true });
  });

  it("rejects a missing account and self-messaging", async () => {
    state.peer = null;
    await expect(caller("user").send({ toUserId: 3, body: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("user").send({ toUserId: 2, body: "self" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
