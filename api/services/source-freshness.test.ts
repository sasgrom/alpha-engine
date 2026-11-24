import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sourceFreshness } from "../../worker/lib/source-freshness";
import { sourceInputs } from "./source-freshness";

const root = mkdtempSync(path.join(tmpdir(), "source-freshness-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const write = (relative: string, value: unknown) => { const file = path.join(root, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value)); };

describe("the sources table's inputs", () => {
  it("reads each source's newest day from the desk's own files and its job's last run", () => {
    write("worker/.runs/desk-company/index.json", { builtAt: "2026-11-24T10:28:03Z", filingsAsOf: "2026-11-23", insidersAsOf: "2026-11-13", insidersVersion: "i1.1.20261116", guidanceVersion: "g1.2.20261124", standard: "v3.2", standardGeneratedAt: "2026-11-23T11:32:43Z", holdersPeriod: "2026-09-30", holdersVersion: "k16.6", pricesAsOf: "2026-11-23" });
    write("worker/.runs/desk-company/guidance-market.json", { asOf: "2026-11-20" });
    write("worker/.runs/desk-macro.json", { archiveGeneratedAt: "2026-11-22T13:43:12Z", series: [{ seriesId: "DGS10", date: "2026-11-19" }, { seriesId: "CPIAUCSL", date: "2026-10-01" }, { seriesId: "VIXCLS", date: "2026-11-19" }] });
    write("worker/.runs/desk-short-interest.json", { asOf: "2026-10-30", settlements: ["2026-10-30"] });
    write("public/reports/prediction-markets.json", { asOf: "2026-11-24T00:35:00.180Z" });
    write("worker/.runs/local-generated/std-insiders-refresh.json", { status: "failed", finishedAt: "2026-11-24T11:50:00Z", error: "Regression check refused the load" });
    write("worker/.runs/local-generated/std-guidance-refresh.json", { status: "complete", finishedAt: "2026-11-24T10:28:31Z" });
    const inputs = sourceInputs(root, { "desk-company-statements": { status: "done", endedAt: "2026-11-24T10:06:42Z" }, "13f-refresh": { status: "done", endedAt: "2026-11-23T13:00:36Z" } }, "2026-11-23");
    const rows = Object.fromEntries(sourceFreshness(inputs, "2026-11-24").map((row) => [row.id, row]));
    expect(rows.filings).toMatchObject({ newest: "2026-11-23", state: "current", run: { status: "done" } });
    // the insider refresh failed: the row says so whatever the data's age
    expect(rows.insiders).toMatchObject({ newest: "2026-11-13", ageDays: 11, state: "failed", detail: "i1.1.20261116", run: { error: "Regression check refused the load" } });
    expect(rows.guidance).toMatchObject({ newest: "2026-11-20", state: "current", detail: "g1.2.20261124" });
    // the monthly series do not make the macro row look old: the daily ones are read
    expect(rows.macro).toMatchObject({ newest: "2026-11-19", state: "current" });
    expect(rows["short-interest"]).toMatchObject({ newest: "2026-10-30", ageDays: 25, state: "current" });
    expect(rows.holders).toMatchObject({ newest: "2026-09-30", state: "current" });
    expect(rows.prices).toMatchObject({ newest: "2026-11-23", state: "current" });
    expect(rows["prediction-markets"]).toMatchObject({ newest: "2026-11-24", ageDays: 0, state: "current" });
    expect(rows.fundamentals).toMatchObject({ newest: "2026-11-23", detail: "v3.2" });
  });

  it("says unknown for every source when nothing is built", () => {
    const rows = sourceFreshness(sourceInputs(path.join(root, "empty"), {}, null), "2026-11-24");
    expect(new Set(rows.map((row) => row.state))).toEqual(new Set(["unknown"]));
    expect(rows).toHaveLength(10);
  });
});
