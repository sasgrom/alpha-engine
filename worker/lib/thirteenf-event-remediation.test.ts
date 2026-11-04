import { Param, SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildPositionRow, mergeQuarterFilings, positionEvent } from "./thirteenf";
import { applyThirteenFRemediationPlan, buildThirteenFRemediationPlan, type ThirteenFPositionRow, type ThirteenFRemediationDatabase, type ThirteenFRemediationPlan } from "./thirteenf-event-remediation";

const quarter = { fundCik: 1, quarterDate: "2025-03-31", accessionNo: "original", filingDate: "2025-05-10" };
const accessions = [{ fundCik: 1, quarterDate: "2025-03-31", accessionNo: "original" }];
const row = (id: number, eventTs = "2025-03-31", overrides: Partial<ThirteenFPositionRow> = {}): ThirteenFPositionRow => ({
  id, cik: 320193, source: "13f", signalType: "position", eventTs, ingestedAt: "2025-06-01 00:00:00",
  payloadKey: "13f:pos:1:320193:COM:original", score: 1, magnitude: null, note: "evidence", src: "backfill", ...overrides,
});
const plan = (rows: ThirteenFPositionRow[], metadata = [quarter]) => buildThirteenFRemediationPlan(rows, metadata, accessions, "2026-01-01T00:00:00Z");

function params(node: unknown): unknown[] {
  if (typeof node === "number") return [node];
  if (node instanceof Param) return [node.value];
  if (node instanceof SQL) return node.queryChunks.flatMap(params);
  if (Array.isArray(node)) return node.flatMap(params);
  return [];
}
function fakeDb(initial: ThirteenFPositionRow[], failOnBatch = 0) {
  const current = new Map(initial.map((item) => [item.id, item]));
  let batches = 0;
  const db: ThirteenFRemediationDatabase = {
    transaction: async (callback) => {
      const before = new Map(current);
      try {
        return await callback({ execute: async (query: SQL) => {
          batches++;
          if (batches === failOnBatch) throw new Error("forced batch failure");
          const ids = params(query).filter((value): value is number => typeof value === "number");
          let affectedRows = 0;
          for (const id of ids) if (current.delete(id)) affectedRows++;
          return [{ affectedRows }];
        } });
      } catch (error) {
        current.clear();
        for (const [id, item] of before) current.set(id, item);
        throw error;
      }
    },
  };
  return { db, current, batches: () => batches };
}

describe("13F event remediation", () => {
  it("removes quarter-end fallback and replaces it with actual filing availability", async () => {
    const input = [row(1)];
    const remediation = plan(input);
    expect(remediation.counts.STALE_FALLBACK).toBe(1);
    const fake = fakeDb(input);
    await applyThirteenFRemediationPlan(fake.db, remediation);
    expect(fake.current.size).toBe(0);
    const rebuilt = buildPositionRow(1, 320193, { accessionNo: "original", form: "13F-HR", filingDate: "2025-05-10", reportDate: "2025-03-31" }, positionEvent(null, 100, 100)!, "new");
    expect(rebuilt.eventTs).toBe("2025-05-10 00:00:00");
    expect(rebuilt.eventTs).not.toBe("2025-03-31 00:00:00");
  });

  it("uses the latest amendment rather than original or quarter+45d", async () => {
    const merged = mergeQuarterFilings([
      { accessionNo: "original", filingDate: "2025-05-10", form: "13F-HR", amendment: "ORIGINAL", holdings: [{ issuer: "A", cusip: "A", secClass: "COM", valueUsd: 100, shares: 100 }],
      },
      { accessionNo: "amendment", filingDate: "2025-06-01", form: "13F-HR/A", amendment: "NEW HOLDINGS", holdings: [{ issuer: "B", cusip: "B", secClass: "COM", valueUsd: 100, shares: 100 }] },
    ]);
    expect(merged.latestFilingDate).toBe("2025-06-01");
    const input = [row(1, "2025-05-15")];
    const remediation = plan(input, [{ ...quarter, filingDate: merged.latestFilingDate }]);
    expect(remediation.counts.STALE_FALLBACK).toBe(1);
    await applyThirteenFRemediationPlan(fakeDb(input).db, remediation);
    const rebuilt = buildPositionRow(1, 320193, { accessionNo: "amendment", form: "13F-HR/A", filingDate: merged.latestFilingDate, reportDate: "2025-03-31" }, positionEvent(null, 100, 100)!, "new");
    expect(rebuilt.eventTs).toBe("2025-06-01 00:00:00");
    expect(rebuilt.eventTs).not.toBe("2025-05-15 00:00:00");
  });

  it("does not create research events when required metadata is missing", async () => {
    const input = [row(1, "2025-05-10")];
    const remediation = plan(input, [{ ...quarter, filingDate: null }]);
    expect(remediation.counts.MISSING_REQUIRED_AVAILABILITY).toBe(1);
    expect(remediation.missingAvailabilityQuarters).toEqual([{ fundCik: 1, quarterDate: "2025-03-31", reason: "MISSING_13F_FILING_DATE 1/2025-03-31" }]);
    const fake = fakeDb(input);
    await applyThirteenFRemediationPlan(fake.db, remediation);
    expect(fake.current.size).toBe(0);
    expect(() => buildPositionRow(1, 320193, { accessionNo: "original", form: "13F-HR", filingDate: "", reportDate: "2025-03-31" }, positionEvent(null, 100, 100)!, "missing")).toThrow("MISSING_13F_FILING_DATE");
  });

  it("deduplicates while preserving the lowest-ID canonical evidence", async () => {
    const input = [row(1, "2025-05-10"), row(2, "2025-05-10")];
    const remediation = plan(input);
    expect(remediation.counts.DUPLICATE).toBe(1);
    expect(remediation.duplicateGroups).toEqual([{ key: "320193|13f|position|2025-05-10|13f:pos:1:320193:COM:original", canonicalId: 1, duplicateIds: [2] }]);
    const fake = fakeDb(input);
    await applyThirteenFRemediationPlan(fake.db, remediation);
    expect([...fake.current.keys()]).toEqual([1]);
    expect(fake.current.get(1)?.note).toBe("evidence");
  });

  it("does not change valid, unknown or other-source rows", async () => {
    const input = [row(1, "2025-05-10"), row(2, "2025-06-15", { payloadKey: "unparseable" })];
    const other = row(999, "2025-03-31", { source: "edgar" });
    const remediation = plan(input);
    const fake = fakeDb([...input, other]);
    const result = await applyThirteenFRemediationPlan(fake.db, remediation);
    expect(result.affectedRows).toBe(0);
    expect(fake.current.size).toBe(3);
    expect(remediation.validUntouched).toEqual([1]);
    expect(remediation.unknownUntouched).toEqual([2]);
  });

  it("rolls back all batches after an artificial error", async () => {
    const input = Array.from({ length: 501 }, (_, index) => row(index + 1, "2025-03-31", { cik: index + 1, payloadKey: `13f:pos:1:${index + 1}:COM:original` }));
    const remediation = plan(input);
    const fake = fakeDb(input, 2);
    await expect(applyThirteenFRemediationPlan(fake.db, remediation)).rejects.toThrow("forced batch failure");
    expect(fake.current.size).toBe(501);
    expect(fake.batches()).toBe(2);
  });

  it("shows zero pending changes after an idempotent apply", async () => {
    const input = [row(1), row(2, "2025-05-10", { payloadKey: null }), row(3, "2025-05-10")];
    const remediation = plan(input);
    const fake = fakeDb(input);
    await applyThirteenFRemediationPlan(fake.db, remediation);
    const remaining = [...fake.current.values()];
    const next = plan(remaining);
    expect(next.deleteCandidates).toHaveLength(0);
    expect(next.validUntouched).toEqual([3]);
    expect(next.unknownUntouched).toEqual([2]);
  });

  it("does not create duplicates or new writes on repeated apply", async () => {
    const input = [row(1)];
    const remediation = plan(input);
    const fake = fakeDb(input);
    await applyThirteenFRemediationPlan(fake.db, remediation);
    const second = await applyThirteenFRemediationPlan(fake.db, remediation);
    expect(second.affectedRows).toBe(0);
    expect(fake.current.size).toBe(0);
  });
});
