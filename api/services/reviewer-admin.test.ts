import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewerAccount, listReviewerProfiles, resetReviewerFirstIp, resetReviewerNda, resetReviewerTour } from "./reviewer-access";
import { users, userUniverse, reviewerAccess, reviewerTourPreferences } from "@db/schema";

const state = {
  users: [] as any[],
  access: [] as any[],
  tours: [] as any[],
  universe: [] as any[],
};
const tableFor = (name: any): keyof typeof state => name === users ? "users" : name === reviewerAccess ? "access" : name === reviewerTourPreferences ? "tours" : name === userUniverse ? "universe" : name;
const table = (name: any) => ({
  rows: state[tableFor(name)],
  insert: (values: any) => {
    const key = tableFor(name);
    const input = Array.isArray(values) ? values : [values];
    const rows = input.map((row) => {
      if (key === "users") return { id: 42, ...row };
      if (key === "access") return {
        acceptedAt: null,
        acceptedIpHash: null,
        acceptedUserAgent: null,
        acceptedSessionUnionId: null,
        firstIpHash: null,
        ...row,
      };
      return row;
    });
    state[key].push(...rows);
  },
  select: () => state[tableFor(name)].slice(),
  update: (values: any) => { for (const row of state[tableFor(name)]) Object.assign(row, values); },
  delete: () => { state[tableFor(name)] = state[tableFor(name)].filter(() => false); },
});
const db: any = {
  select: () => ({
    from: (tableName: keyof typeof state) => {
      const rows = () => table(tableName).select();
      return {
        then: (resolve: (value: any[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject),
        limit: async (count: number) => rows().slice(0, count),
        where: () => ({ limit: async (count: number) => rows().slice(0, count) }),
      };
    },
  }),
  insert: (tableName: keyof typeof state) => ({ values: (values: any[]) => table(tableName).insert(values) }),
  update: (tableName: keyof typeof state) => ({
    set: (values: any) => ({ where: async () => { table(tableName).update(values); } }),
  }),
  delete: (tableName: keyof typeof state) => ({ where: async () => { table(tableName).delete(); } }),
  transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
};
vi.mock("../queries/connection", () => ({ getDb: () => db }));
vi.mock("../../worker/lib/edgar", () => ({
  loadEdgarUniverse: () => Array.from({ length: 50 }, (_, index) => ({ cik: index + 1, ticker: `T${index + 1}`, name: `Company ${index + 1}` })),
}));

describe("reviewer account management", () => {
  beforeEach(() => {
    for (const key of Object.keys(state) as Array<keyof typeof state>) state[key] = [];
  });

  it("creates the complete reviewer profile without raw IP or password exposure", async () => {
    const result = await createReviewerAccount({ username: "new_reviewer", password: "secret1", name: "New Reviewer" });
    expect(result.ok).toBe(true);
    expect(result.id).toBe(42);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].role).toBe("user");
    expect(state.users[0].passwordHash).toMatch(/^scrypt\$/);
    expect(state.access).toHaveLength(1);
    expect(state.access[0].acceptedAt).toBeNull();
    expect(state.access[0].firstIpHash).toBeNull();
    expect(state.tours).toHaveLength(2);
    expect(state.universe).toHaveLength(50);
    expect(state.tours.every((tour) => tour.status === "not_started" && tour.currentStep === 0)).toBe(true);
    expect(state.access[0].firstIpHash).not.toBe("203.0.113.9");
    expect(state.users[0].passwordHash).not.toBe("secret1");
  });

  it("resets first IP and NDA independently from tour state", async () => {
    await createReviewerAccount({ username: "new_reviewer", password: "secret1" });
    state.access[0].firstIpHash = "hash";
    state.access[0].acceptedAt = new Date("2026-11-04T00:00:00Z");
    await resetReviewerFirstIp(42);
    expect(state.access[0].firstIpHash).toBeNull();
    expect(state.access[0].acceptedAt).toBeNull();
    await resetReviewerNda(42);
    expect(state.access[0].acceptedAt).toBeNull();
    expect(state.access[0].acceptedIpHash).toBeNull();
    expect(state.access[0].acceptedUserAgent).toBeNull();
    expect(state.access[0].acceptedSessionUnionId).toBeNull();
    await resetReviewerTour(42);
    expect(state.tours.every((tour) => tour.currentStep === 0 && tour.status === "not_started")).toBe(true);
  });

  it("returns status and universe size without IP hashes", async () => {
    await createReviewerAccount({ username: "new_reviewer", password: "secret1" });
    const [profile] = await listReviewerProfiles();
    expect(profile.ndaAccepted).toBe(false);
    expect(profile.firstIpBound).toBe(false);
    expect(profile.universeSize).toBe(50);
    expect(Object.keys(profile)).not.toContain("firstIpHash");
    expect(Object.keys(profile)).not.toContain("acceptedIpHash");
    expect(Object.keys(profile)).not.toContain("passwordHash");
  });
});
