import { describe, expect, it } from "vitest";
import { sortSources, sourceFreshness, type SourceInput } from "./source-freshness";

const source = (id: string, newest: string | null, maxAgeDays: number, run?: SourceInput["run"]): SourceInput => ({ id, label: id, newest, what: "newest filing", arrives: "nightly", maxAgeDays, run });

describe("how current a source is", () => {
  it("goes by the newest day in the data, not by the job's status", () => {
    const [filings, calendar] = sourceFreshness([source("filings", "2026-11-23", 4, { status: "done", endedAt: "2026-11-24T10:06:04Z" }), source("calendar", "2026-11-12", 4, { status: "done", endedAt: "2026-11-24T10:06:42Z" })], "2026-11-24");
    expect(filings).toMatchObject({ ageDays: 1, state: "current" });
    expect(calendar).toMatchObject({ ageDays: 12, state: "late" });
  });

  it("allows exactly the stated number of days", () => {
    const rows = sourceFreshness([source("a", "2026-11-20", 4), source("b", "2026-11-19", 4)], "2026-11-24");
    expect(rows.map((row) => row.state)).toEqual(["current", "late"]);
  });

  it("reports a failed job as failed whatever the data's age, and a running one by its data", () => {
    const rows = sourceFreshness([source("a", "2026-11-23", 4, { status: "error", endedAt: "2026-11-24T11:40:00Z", error: "gate" }), source("b", "2026-11-23", 4, { status: "running", endedAt: null }), source("c", "2026-11-23", 4, { status: "unchanged", endedAt: "x" }), source("d", "2026-11-23", 4, { status: "built_not_published", endedAt: "x" })], "2026-11-24");
    expect(rows.map((row) => row.state)).toEqual(["failed", "current", "current", "current"]);
  });

  it("says unknown when the data's newest day cannot be read, and takes a timestamp by its day", () => {
    const rows = sourceFreshness([source("a", null, 4), source("b", "not a date", 4), source("c", "2026-11-24T00:35:00.180Z", 2)], "2026-11-24T12:00:00Z");
    expect(rows.map((row) => row.state)).toEqual(["unknown", "unknown", "current"]);
    expect(rows[2]).toMatchObject({ newest: "2026-11-24", ageDays: 0 });
  });

  it("orders the worst first", () => {
    const rows = sortSources(sourceFreshness([source("current", "2026-11-23", 4), source("late-12", "2026-11-12", 4), source("failed", "2026-11-23", 4, { status: "failed", endedAt: "x" }), source("unknown", null, 4), source("late-40", "2026-10-15", 30)], "2026-11-24"));
    expect(rows.map((row) => row.id)).toEqual(["failed", "late-40", "late-12", "unknown", "current"]);
  });
});
