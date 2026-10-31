import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OPERATION_JOBS, OPERATION_JOB_MAP } from "../../contracts/operations";
import {
  OPERATIONS_ROOT,
  appendOperationCommand,
  defaultOperationConfig,
  dependenciesReady,
  loadOperationConfig,
  loadOperationsState,
  operationChain,
  saveOperationConfig,
  saveOperationsState,
  validateOperationRegistry,
  type OperationsState,
} from "./operations-scheduler";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "alpha-operations-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("operations registry", () => {
  it("has valid unique jobs, cron and acyclic dependencies", () => {
    expect(validateOperationRegistry()).toEqual([]);
    expect(OPERATION_JOBS.length).toBeGreaterThanOrEqual(30);
  });

  it("points every executable job at a real script", () => {
    for (const job of OPERATION_JOBS) {
      if (job.executable === "npx") expect(existsSync(path.join(OPERATIONS_ROOT, job.args[1])), job.id).toBe(true);
      if (job.executable === "npm") expect(job.args).toEqual(["run", "build"]);
    }
  });

  it("keeps production apply, GDELT and unfinished streaming out of executable automation", () => {
    for (const id of ["signals-production-push", "facts-production-push", "gdelt-frozen", "schwab-selective-stream", "mysql-backup-restore"]) {
      expect(OPERATION_JOB_MAP[id].executable).toBeNull();
      expect(OPERATION_JOB_MAP[id].defaultEnabled).toBe(false);
    }
    expect(OPERATION_JOB_MAP["edgar-tone-nightly"].defaultEnabled).toBe(false);
    expect(OPERATION_JOB_MAP["expectations-extract"].defaultEnabled).toBe(false);
  });

  it("orders every parent before its child in a run chain", () => {
    const chain = operationChain("ui-production-build");
    const positions = new Map(chain.map((job, index) => [job.id, index]));
    for (const job of chain) for (const parent of job.dependsOn) expect(positions.get(parent)!).toBeLessThan(positions.get(job.id)!);
    expect(chain.at(-1)?.id).toBe("ui-production-build");
  });
});

describe("operations config and dependency state", () => {
  it("round-trips owner schedule edits and preserves safe defaults", () => {
    const file = path.join(tempDir(), "config.json");
    const config = defaultOperationConfig();
    config["schwab-fetch-daily"] = { enabled: false, cron: "15 4 * * *" };
    saveOperationConfig(config, file);
    const loaded = loadOperationConfig(file);
    expect(loaded["schwab-fetch-daily"]).toEqual({ enabled: false, cron: "15 4 * * *" });
    expect(loaded["gdelt-frozen"]).toEqual({ enabled: false, cron: null });
  });

  it("rejects an invalid cron before writing", () => {
    const file = path.join(tempDir(), "config.json");
    const config = defaultOperationConfig();
    config["schwab-fetch-daily"].cron = "not a cron";
    expect(() => saveOperationConfig(config, file)).toThrow();
    expect(existsSync(file)).toBe(false);
  });

  it("runs a child only after all parents are fresh, successful and newer than the previous child", () => {
    const job = OPERATION_JOB_MAP["ui-production-build"];
    const now = Date.parse("2026-10-31T12:00:00Z");
    const state = { lastRuns: {} } as OperationsState;
    expect(dependenciesReady(job, state, now)).toBe(false);
    for (const [index, parent] of job.dependsOn.entries()) {
      state.lastRuns[parent] = { runId: parent, jobId: parent, status: "done", trigger: "cron", startedAt: "2026-10-31T10:00:00Z", endedAt: `2026-10-31T1${index}:00:00Z`, exitCode: 0, logFile: "", error: null };
    }
    expect(dependenciesReady(job, state, now)).toBe(true);
    state.lastRuns[job.id] = { ...state.lastRuns[job.dependsOn[0]], jobId: job.id, endedAt: "2026-10-31T11:30:00Z" };
    expect(dependenciesReady(job, state, now)).toBe(false);
    state.lastRuns[job.dependsOn[0]].status = "error";
    expect(dependenciesReady(job, state, now)).toBe(false);
  });

  it("persists the command offset so offline UI requests run once, not again after restart", () => {
    const file = path.join(tempDir(), "state.json");
    const state = loadOperationsState(file);
    expect(state.commandOffset).toBe(0);
    state.commandOffset = 123;
    saveOperationsState(state, file);
    expect(loadOperationsState(file).commandOffset).toBe(123);
  });

  it("appends structured UI commands without exposing arbitrary shell text", () => {
    const file = path.join(tempDir(), "commands.jsonl");
    appendOperationCommand({ id: "1", action: "run", jobId: "schwab-fetch-daily", requestedAt: "2026-10-31T12:00:00Z" }, file);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ id: "1", action: "run", jobId: "schwab-fetch-daily", requestedAt: "2026-10-31T12:00:00Z" });
  });
});
