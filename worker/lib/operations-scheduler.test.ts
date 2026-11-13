import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OPERATION_JOBS, OPERATION_JOB_MAP } from "../../contracts/operations";
import {
  OPERATIONS_ROOT,
  acquireSchedulerLock,
  appendOperationCommand,
  cronParts,
  defaultOperationConfig,
  dependenciesReady,
  loadOperationConfig,
  loadOperationsState,
  nextCronRun,
  operationChain,
  releaseSchedulerLock,
  repositoryRoot,
  saveOperationConfig,
  saveOperationsState,
  succeededLocally,
  validateCron,
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

  it("registers data health after the daily data jobs", () => {
    expect(OPERATION_JOB_MAP["data-health"].dependsOn).toEqual(["research-series", "schwab-daily-bars", "edgar-exhibits-daily", "schwab-feature-lab"]);
    expect(OPERATION_JOB_MAP["data-health"].defaultEnabled).toBe(true);
  });

  it("points every executable job at a real script", () => {
    for (const job of OPERATION_JOBS) {
      if (job.executable === "npx") expect(existsSync(path.join(OPERATIONS_ROOT, job.args[1])), job.id).toBe(true);
      if (job.executable === "npm") expect(job.args).toEqual(["run", "build"]);
    }
  });

  it("keeps production apply, GDELT and unfinished streaming out of executable automation", () => {
    for (const id of ["signals-production-push", "facts-production-push", "gdelt-frozen", "schwab-selective-stream"]) {
      expect(OPERATION_JOB_MAP[id].executable).toBeNull();
      expect(OPERATION_JOB_MAP[id].defaultEnabled).toBe(false);
    }
    expect(OPERATION_JOB_MAP["mysql-backup-restore"]).toMatchObject({ mode: "manual", defaultEnabled: false, cron: null });
    expect(OPERATION_JOB_MAP["mysql-backup-restore"].command).toContain("--full --source-env DATABASE_URL");
    expect(OPERATION_JOB_MAP["mysql-backup-restore"].command).not.toContain("--apply");
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

  it("lets dependents run when the parent's own work succeeded but its production push failed", () => {
    const job = OPERATION_JOB_MAP["schwab-snapshot"];
    const now = Date.parse("2026-11-12T12:10:00Z");
    const parent = { runId: "p", jobId: "schwab-fetch-daily", status: "error" as const, trigger: "cron" as const, startedAt: "2026-11-12T12:00:00Z", endedAt: "2026-11-12T12:03:37Z", exitCode: 0, logFile: "", error: "Operational push failed: HTTP 200 answered with text/html instead of JSON" };
    const state = { lastRuns: { "schwab-fetch-daily": parent } } as unknown as OperationsState;
    // before 2026-11-12 a failed push blocked the options chain (no localStatus recorded)
    expect(succeededLocally(parent)).toBe(false);
    expect(dependenciesReady(job, state, now)).toBe(false);
    state.lastRuns["schwab-fetch-daily"] = { ...parent, localStatus: "done", push: { status: "failed", at: "2026-11-12T12:03:37Z", error: parent.error } };
    expect(succeededLocally(state.lastRuns["schwab-fetch-daily"])).toBe(true);
    expect(dependenciesReady(job, state, now)).toBe(true);
    // a job whose own work failed still stops its dependents
    state.lastRuns["schwab-fetch-daily"] = { ...parent, exitCode: 1, localStatus: "error", error: "Process exited with code 1" };
    expect(dependenciesReady(job, state, now)).toBe(false);
  });
});

describe("schedules", () => {
  it("runs the market lanes after each weekday close and again as a morning catch-up", () => {
    expect(cronParts(OPERATION_JOB_MAP["schwab-fetch-sp500"].cron!)).toEqual(["10 16 * * 1-5", "30 4 * * *"]);
    expect(cronParts(OPERATION_JOB_MAP["schwab-fetch-daily"].cron!)).toEqual(["45 16 * * 1-5", "0 4 * * *"]);
    const sp500 = OPERATION_JOB_MAP["schwab-fetch-sp500"].cron!;
    // local wall-clock times (the scheduler runs in the machine's time zone)
    expect(nextCronRun(sp500, new Date(2026, 10, 12, 19, 47))).toEqual(new Date(2026, 10, 13, 4, 30)); // Thursday evening -> Friday catch-up
    expect(nextCronRun(sp500, new Date(2026, 10, 13, 5, 0))).toEqual(new Date(2026, 10, 13, 16, 10)); // Friday morning -> Friday after the close
    expect(nextCronRun(sp500, new Date(2026, 10, 13, 17, 0))).toEqual(new Date(2026, 10, 14, 4, 30)); // Friday evening -> Saturday catch-up
    expect(nextCronRun(sp500, new Date(2026, 10, 14, 5, 0))).toEqual(new Date(2026, 10, 15, 4, 30)); // no Saturday evening run
  });

  it("validates every part of a schedule", () => {
    expect(() => validateCron("10 16 * * 1-5; 30 4 * * *")).not.toThrow();
    expect(() => validateCron("10 16 * * 1-5; not a cron")).toThrow();
    expect(() => validateCron(" ; ")).toThrow();
    const file = path.join(tempDir(), "config.json");
    const config = defaultOperationConfig();
    config["schwab-fetch-sp500"].cron = "0 17 * * 1-5; 0 5 * * *";
    saveOperationConfig(config, file);
    expect(loadOperationConfig(file)["schwab-fetch-sp500"].cron).toBe("0 17 * * 1-5; 0 5 * * *");
  });
});

describe("repository root", () => {
  it("is two folders above the module from source, and the working folder when bundled into dist/", () => {
    expect(repositoryRoot(path.join(OPERATIONS_ROOT, "worker", "lib"), "C:/elsewhere")).toBe(OPERATIONS_ROOT);
    // dist/boot.js: two folders above dist/ is not the repository (2026-11-03: a stray config was written there)
    expect(repositoryRoot(path.join(OPERATIONS_ROOT, "dist"), OPERATIONS_ROOT)).toBe(OPERATIONS_ROOT);
  });
});

describe("one scheduler at a time", () => {
  const files = () => {
    const dir = tempDir();
    return { file: path.join(dir, "scheduler.lock"), stateFile: path.join(dir, "state.json") };
  };
  const beat = (stateFile: string, at: number) => writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, heartbeatAt: new Date(at).toISOString() }));
  const now = Date.parse("2026-11-12T20:00:00Z");

  it("takes a free lock and lets a second start leave while the first is alive and beating", () => {
    const { file, stateFile } = files();
    expect(acquireSchedulerLock({ file, stateFile, now, pid: 100, settleMs: 0 })).toMatchObject({ acquired: true, reason: "free" });
    beat(stateFile, now - 20_000);
    expect(acquireSchedulerLock({ file, stateFile, now, pid: 200, settleMs: 0, alive: (pid) => pid === 100 })).toEqual({ acquired: false, holder: 100, reason: "running" });
    expect(acquireSchedulerLock({ file, stateFile, now, pid: 100, settleMs: 0 })).toMatchObject({ acquired: true, reason: "own" });
  });

  it("takes over the lock of a stopped scheduler, and of one silent for ten minutes", () => {
    const { file, stateFile } = files();
    acquireSchedulerLock({ file, stateFile, now, pid: 100, settleMs: 0 });
    beat(stateFile, now - 20_000);
    expect(acquireSchedulerLock({ file, stateFile, now, pid: 200, settleMs: 0, alive: () => false })).toMatchObject({ acquired: true, holder: 100, reason: "taken over from a stopped scheduler" });
    beat(stateFile, now - 11 * 60_000);
    expect(acquireSchedulerLock({ file, stateFile, now, pid: 300, settleMs: 0, alive: () => true })).toMatchObject({ acquired: true, holder: 200, reason: "taken over from a silent scheduler" });
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(300);
  });

  it("respects a scheduler from before the lock that is still beating", () => {
    const { file, stateFile } = files();
    beat(stateFile, now - 30_000);
    expect(acquireSchedulerLock({ file, stateFile, now, pid: 100, settleMs: 0 })).toEqual({ acquired: false, reason: "a scheduler without a lock file is running" });
    beat(stateFile, now - 5 * 60_000);
    expect(acquireSchedulerLock({ file, stateFile, now, pid: 100, settleMs: 0 })).toMatchObject({ acquired: true });
  });

  it("releases only its own lock", () => {
    const { file, stateFile } = files();
    acquireSchedulerLock({ file, stateFile, now, pid: 100, settleMs: 0 });
    releaseSchedulerLock(file, 200);
    expect(existsSync(file)).toBe(true);
    releaseSchedulerLock(file, 100);
    expect(existsSync(file)).toBe(false);
  });
});
