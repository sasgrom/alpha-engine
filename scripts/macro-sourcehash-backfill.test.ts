import { describe, expect, it } from "vitest";
import { resolveSourceHashRow } from "./build-macro-sourcehash-backfill.mts";

const hash = "a".repeat(64);
const local = [{ value: 1, realtimeEnd: null }];
const archive = [{ value: 1, supersededAt: null, sourceHash: hash }];

describe("macro sourceHash backfill", () => {
  it("uses archive hashes only when the local exact key exists", () => {
    expect(resolveSourceHashRow([], archive)).toEqual({ status: "missing_local" });
    expect(resolveSourceHashRow(local, archive)).toEqual({ status: "backfill", sourceHash: hash });
  });

  it("canonicalizes date-only and timestamped realtimeEnd values", () => {
    expect(resolveSourceHashRow([{ value: 1, realtimeEnd: "2023-12-31" }], [{ value: 1, supersededAt: "2023-12-31T23:59:59.999Z", sourceHash: hash }])).toEqual({ status: "backfill", sourceHash: hash });
  });

  it("keeps missing hashes and content conflicts visible", () => {
    expect(resolveSourceHashRow(local, [{ value: 1, supersededAt: null }])).toEqual({ status: "missing_archive_hash" });
    expect(resolveSourceHashRow(local, [{ value: 2, supersededAt: null, sourceHash: hash }])).toEqual({ status: "conflict", reason: "local_vs_archive" });
  });
});
