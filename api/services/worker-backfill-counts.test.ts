import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  affectedRows: 1,
  signalRows: [] as any[],
  digestRows: [] as any[],
}));
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      execute: async (query: any) => {
        const text = query.queryChunks.map((chunk: any) => chunk?.constructor?.name === "StringChunk" ? chunk.value.join("") : "").join("");
        if (text.startsWith("INSERT INTO digests") || text.startsWith("INSERT IGNORE INTO digests")) {
          mocks.digestRows = [{ kind: "morning", scope: "", forDate: "2026-11-06", body: "brief", model: null, meta: null }];
          return [{ affectedRows: mocks.affectedRows }];
        }
        if (text.startsWith("INSERT")) return [{ affectedRows: mocks.affectedRows }];
        if (text.startsWith("SELECT")) return [mocks.signalRows];
        throw new Error("Unexpected SQL");
      },
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => mocks.digestRows.slice(0, 1),
          }),
        }),
      }),
    }),
    execute: async (query: any) => {
      const text = query.queryChunks.map((chunk: any) => chunk?.constructor?.name === "StringChunk" ? chunk.value.join("") : "").join("");
      if (text.startsWith("INSERT INTO digests") || text.startsWith("INSERT IGNORE INTO digests")) {
        mocks.digestRows = [{ kind: "morning", scope: "", forDate: "2026-11-06", body: "brief", model: null, meta: null }];
        return [{ affectedRows: mocks.affectedRows }];
      }
      if (text.startsWith("INSERT")) return [{ affectedRows: mocks.affectedRows }];
      if (text.startsWith("SELECT")) return [mocks.signalRows];
      throw new Error("Unexpected SQL");
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.digestRows.slice(0, 1),
        }),
      }),
    }),
  }),
}));

import { ingestDigests, ingestSignals } from "./worker";

const signal = {
  cik: 1,
  source: "edgar" as const,
  signalType: "tone" as const,
  eventTs: "2026-11-01 00:00:00",
  payloadKey: "source-1",
  src: "live" as const,
};
const digest = { kind: "morning", scope: "", forDate: "2026-11-06", body: "brief", model: null, meta: null };

describe("signals/digests server backfill counts", () => {
  beforeEach(() => {
    mocks.affectedRows = 1;
    mocks.signalRows = [{ cik: 1, source: "edgar", signalType: "tone", eventTs: "2026-11-01 00:00:00", payloadKey: "source-1" }];
    mocks.digestRows = [];
  });

  it("returns accepted on first signal insert and dupes on exact-key retry", async () => {
    const first = await ingestSignals([signal]);
    expect(first).toMatchObject({ accepted: 1, dupes: 0, postCheck: { expected: 1, verified: 1, failed: 0 } });
    mocks.affectedRows = 0;
    const retry = await ingestSignals([signal]);
    expect(retry).toMatchObject({ accepted: 0, dupes: 1, skippedDupes: 1, postCheck: { expected: 1, verified: 1, failed: 0 } });
  });

  it("does not overwrite an identical digest and returns dupes on retry", async () => {
    const first = await ingestDigests([digest]);
    expect(first).toMatchObject({ accepted: 1, dupes: 0, upserted: 1, postCheck: { expected: 1, verified: 1, failed: 0 } });
    mocks.digestRows = [digest];
    const retry = await ingestDigests([digest]);
    expect(retry).toMatchObject({ accepted: 0, dupes: 1, upserted: 0, postCheck: { expected: 1, verified: 1, failed: 0 } });
  });
});
