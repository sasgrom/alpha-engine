import { describe, expect, it } from "vitest";
import { Param, SQL } from "drizzle-orm";
import { applyMacroSourcePlan, buildMacroSourcePlan, classifyBamlChunk, verifyMacroSourceTable, type MacroPointBackupRow, type MacroSourceDatabase } from "./macro-source-remediation";
import type { NormalizedMacroPoint } from "./fred";

const fedLegacy = { id: 47763, seriesId: "FEDFUNDS", date: "2026-09-01", value: 3.75, realtimeStart: "2026-10-19", realtimeEnd: "2026-10-19", fetchedAt: "2026-10-19T19:44:10.000Z" };
const cpiLegacy = { id: 47832, seriesId: "CPIAUCSL", date: "2026-09-01", value: 336.298, realtimeStart: "2026-10-19", realtimeEnd: "2026-10-19", fetchedAt: "2026-10-19T19:44:11.000Z" };
const fedCanonical = { id: 410405, seriesId: "FEDFUNDS", date: "2026-09-01", value: 3.75, realtimeStart: "2026-10-01", realtimeEnd: null, fetchedAt: "2026-11-04T19:28:36.000Z" };
const cpiCanonical = { id: 31824, seriesId: "CPIAUCSL", date: "2026-09-01", value: 336.298, realtimeStart: "2026-10-14", realtimeEnd: null, fetchedAt: "2026-10-19T19:42:04.000Z" };
const other = { id: 999999, seriesId: "VIXCLS", date: "2026-11-02", value: 21.15, realtimeStart: "2026-11-02", realtimeEnd: null, fetchedAt: "2026-11-04T19:00:00.000Z" };
const official = (seriesId: string, value: number, start: string): NormalizedMacroPoint => ({ seriesId, observationPeriod: "2026-09-01", value, unit: "Percent", frequency: "Monthly", releasedAt: null, availableAt: `${start}T00:00:00.000Z`, availablePrecision: "day", availabilityBasis: "fred_realtime_start", researchEligibleAt: `${start}T23:59:59.999Z`, vintageId: `${seriesId}|2026-09-01|${start}`, supersededAt: null, ingestedAt: "2026-11-04T19:23:31.259Z", sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`, sourceHash: "official" });
const fedOfficial = [official("FEDFUNDS", 3.75, "2026-10-01")];
const cpiOfficial = [official("CPIAUCSL", 336.298, "2026-10-14")];
const allRows = [fedLegacy, cpiLegacy, fedCanonical, cpiCanonical, other];
function params(node: unknown): unknown[] {
  if (typeof node === "number") return [node];
  if (node instanceof Param) return [node.value];
  if (node instanceof SQL) return node.queryChunks.flatMap(params);
  if (Array.isArray(node)) return node.flatMap(params);
  return [];
}
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node instanceof SQL) return node.queryChunks.flatMap(strings);
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object" && "value" in node) return strings((node as { value: unknown }).value);
  return [];
}
function fakeDb(initial: MacroPointBackupRow[], failAt = 0) {
  const current = new Map(initial.map((row) => [row.id, { ...row }]));
  let mutations = 0;
  let transactions = 0;
  const db: MacroSourceDatabase = {
    transaction: async (callback) => {
      transactions++;
      const before = new Map(current);
      try {
        return await callback({ execute: async (query: SQL) => {
          const text = strings(query).join("");
          const ids = params(query).filter((value): value is number => typeof value === "number");
          if (text.includes("DELETE FROM") || text.includes("UPDATE macro_points")) {
            mutations++;
            if (mutations === failAt) throw new Error("forced mutation failure");
            const id = ids[0];
            if (!current.has(id)) return [{ affectedRows: 0 }];
            if (text.includes("DELETE FROM")) current.delete(id);
            else {
              const start = ids.includes(47763) ? "2026-10-01" : current.get(id)!.realtimeStart;
              current.set(id, { ...current.get(id)!, realtimeStart: start, realtimeEnd: null });
            }
            return [{ affectedRows: 1 }];
          }
          const id = ids[0];
          return [[current.get(id)].filter(Boolean)];
        } });
      } catch (error) {
        current.clear();
        for (const [id, row] of before) current.set(id, row);
        throw error;
      }
    },
  };
  return { db, current, mutations: () => mutations, transactions: () => transactions };
}

describe("macro noncanonical source remediation", () => {
  it("deletes only noncanonical duplicates when both canonical rows are proven", async () => {
    const plan = buildMacroSourcePlan(allRows, fedOfficial, cpiOfficial);
    expect(plan.status).toBe("planned");
    expect(plan.decisions.map((row) => [row.id, row.action])).toEqual([[47763, "delete_noncanonical_duplicate"], [47832, "delete_noncanonical_duplicate"]]);
    const fake = fakeDb(allRows);
    const applied = await applyMacroSourcePlan(fake.db, plan);
    expect(applied.deletedIds).toEqual([47763, 47832]);
    expect(applied.updatedIds).toEqual([]);
    expect(fake.transactions()).toBe(1);
    expect(fake.current.has(410405)).toBe(true);
    expect(fake.current.has(31824)).toBe(true);
    expect(verifyMacroSourceTable(allRows, [...fake.current.values()], plan).status).toBe("pass");
  });

  it("updates only availability when the FEDFUNDS canonical row is absent", async () => {
    const input = allRows.filter((row) => row.id !== 410405);
    const plan = buildMacroSourcePlan(input, fedOfficial, cpiOfficial);
    expect(plan.decisions[0]).toMatchObject({ id: 47763, action: "update_availability", realtimeStartAfter: "2026-10-01", realtimeEndAfter: null });
    const fake = fakeDb(input);
    await applyMacroSourcePlan(fake.db, plan);
    expect(fake.current.get(47763)).toMatchObject({ date: "2026-09-01", value: 3.75, realtimeStart: "2026-10-01", realtimeEnd: null, fetchedAt: fedLegacy.fetchedAt });
    expect(fake.current.has(410405)).toBe(false);
    expect(verifyMacroSourceTable(input, [...fake.current.values()], plan).status).toBe("pass");
  });

  it("blocks the entire apply if the CPI canonical row is missing or mismatched", async () => {
    const plan = buildMacroSourcePlan(allRows.filter((row) => row.id !== 31824), fedOfficial, cpiOfficial);
    expect(plan.status).toBe("mismatch");
    const fake = fakeDb(allRows);
    await expect(applyMacroSourcePlan(fake.db, plan)).rejects.toThrow("Refusing apply");
    expect(fake.transactions()).toBe(0);
    expect(fake.current.has(47832)).toBe(true);
  });

  it("rolls back both exact-ID mutations after an artificial error", async () => {
    const plan = buildMacroSourcePlan(allRows, fedOfficial, cpiOfficial);
    const fake = fakeDb(allRows, 2);
    await expect(applyMacroSourcePlan(fake.db, plan)).rejects.toThrow("forced mutation failure");
    expect(fake.transactions()).toBe(1);
    expect([...fake.current.values()]).toEqual(allRows);
  });

  it("rejects a second apply when legacy rows no longer exist", async () => {
    const plan = buildMacroSourcePlan(allRows, fedOfficial, cpiOfficial);
    const fake = fakeDb(allRows);
    await applyMacroSourcePlan(fake.db, plan);
    const second = buildMacroSourcePlan([...fake.current.values()], fedOfficial, cpiOfficial);
    expect(second.status).toBe("mismatch");
    await expect(applyMacroSourcePlan(fake.db, second)).rejects.toThrow("Refusing apply");
    expect(fake.transactions()).toBe(1);
  });
});

describe("BAML chunk official classification", () => {
  const observations = Array.from({ length: 45 }, (_, index) => ({ realtime_start: "2023-10-31", realtime_end: "2023-12-31", date: new Date(Date.UTC(2023, 9, 31 + index)).toISOString().slice(0, 10), value: "4.42" }));
  const local = { metadata: { id: "BAMLH0A0HYM2" }, observations, vintageDates: observations.map((row) => row.date) };
  it("accepts a chunk only when every official value and availability date matches", () => {
    const official = { metadata: { id: "BAMLH0A0HYM2" }, observations: observations.map((row) => ({ ...row })), vintageDates: observations.map((row) => row.date) };
    expect(classifyBamlChunk(local, official).classification).toBe("OFFICIAL_VALID_CHUNK");
  });

  it("quarantines a stale chunk when official first vintage is later", () => {
    const officialObservations = Array.from({ length: 41 }, (_, index) => ({ realtime_start: "2023-11-06", realtime_end: "2023-12-31", date: new Date(Date.UTC(2023, 10, 6 + index)).toISOString().slice(0, 10), value: "4.00" }));
    const official = { metadata: { id: "BAMLH0A0HYM2" }, observations: officialObservations, vintageDates: officialObservations.map((row) => row.date) };
    const result = classifyBamlChunk(local, official);
    expect(result.classification).toBe("UNVERIFIED_OR_STALE_CHUNK");
    expect(result.observationStructureMatches).toBe(false);
    expect(result.vintageStructureMatches).toBe(false);
    expect(result.official.firstVintage).toBe("2023-11-06");
  });

  it("fails closed for conflicting duplicates and availability inversions", () => {
    const conflict = { ...local, observations: [...local.observations, { ...local.observations[0], value: "9.99" }] };
    expect(classifyBamlChunk(conflict, conflict).classification).toBe("UNVERIFIED_OR_STALE_CHUNK");
    const inverted = { ...local, observations: [{ ...local.observations[0], realtime_start: "2023-12-31", realtime_end: "2023-10-31" }] };
    expect(classifyBamlChunk(inverted, inverted).classification).toBe("UNVERIFIED_OR_STALE_CHUNK");
  });
});
