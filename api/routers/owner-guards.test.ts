import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(async () => 123),
  hashPassword: vi.fn(async () => "test-password-hash"),
  spawn: vi.fn(),
  execFile: vi.fn(),
  readFileSync: vi.fn(() => "[]"),
  operationChain: vi.fn(() => [{ id: "job1", executable: true, mode: "scheduled" }]),
  appendOperationCommand: vi.fn(),
  loadOperationConfig: vi.fn(() => ({})),
  loadOperationsState: vi.fn(() => ({ lastRuns: {} })),
  saveOperationConfig: vi.fn(),
  jobStartedBy: 1,
}));

vi.mock("../queries/connection", () => ({
  getDb: () => {
    let result: any[] = [{ n: 0 }];
    const builder: any = {
      from: () => builder,
      leftJoin: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      groupBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      values: () => builder,
      onDuplicateKeyUpdate: async () => result,
      set: () => builder,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
    };
    return {
      select: (selection?: Record<string, unknown>) => {
        result = selection && "startedBy" in selection ? [{ startedBy: mocks.jobStartedBy }] : [{ n: 0 }];
        return builder;
      },
      selectDistinct: () => builder,
      insert: () => builder,
      update: () => builder,
      delete: () => builder,
      execute: async () => [[{ tokens: 0 }]],
    };
  },
}));
vi.mock("../services/runner", () => ({
  createJob: mocks.createJob,
  recordUniverseAction: vi.fn(async () => 1),
  requestCancel: vi.fn(async () => "flagged"),
}));
vi.mock("../services/edgar", async (importActual) => ({
  ...await importActual(),
  fetchFilingDocument: vi.fn(async () => ({ docName: "filing.htm", html: "<p>Evidence</p>" })),
}));
vi.mock("../services/factor-ic", () => ({
  crossSectionFactorIc: vi.fn(async () => []),
  companyFactorIc: vi.fn(async () => []),
}));
vi.mock("../services/institutional", () => ({ fundFlowsGraph: vi.fn(async () => ({ funds: [], companies: [], edges: [], guard: null })) }));
vi.mock("../services/activity", () => ({ activitySummary: vi.fn(async () => ({})), recentActivity: vi.fn(async () => []) }));
vi.mock("../services/passwords", async (importActual) => ({ ...await importActual(), hashPassword: mocks.hashPassword }));
vi.mock("../queries/users", () => ({
  createLocalUser: vi.fn(async () => ({ id: 99 })),
  deleteUserCascade: vi.fn(async () => undefined),
  findUserByUsername: vi.fn(async () => null),
  listUsersWithStats: vi.fn(async () => []),
  setUserPassword: vi.fn(async () => undefined),
  setUserRole: vi.fn(async () => undefined),
}));
vi.mock("../services/reviewer-access", async (importActual) => ({
  ...await importActual(),
  createReviewerAccount: vi.fn(async () => ({ ok: true, userId: 99 })),
  listReviewerProfiles: vi.fn(async () => []),
  resetReviewerFirstIp: vi.fn(async () => ({ ok: true })),
  resetReviewerNda: vi.fn(async () => ({ ok: true })),
  resetReviewerTour: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../services/screener", () => ({ buildScreenerRows: vi.fn(async () => []), getScreener: vi.fn(async () => []) }));
vi.mock("../services/scope", () => ({ enrichClassification: vi.fn(async () => ({ updated: 0, matched: [], unmatched: [] })) }));
vi.mock("../../contracts/operations", async (importActual) => ({
  ...await importActual(),
  OPERATION_JOB_MAP: { job1: { id: "job1", mode: "scheduled", cron: "0 * * * *", executable: true } },
}));
vi.mock("../../worker/lib/operations-scheduler", () => ({
  OPERATIONS_ROOT: process.cwd(),
  OPERATIONS_RUNS_DIR: "test-operation-runs",
  OPERATION_JOB_MAP: { job1: { id: "job1", mode: "scheduled", cron: "0 * * * *", executable: true } },
  appendOperationCommand: mocks.appendOperationCommand,
  loadOperationConfig: mocks.loadOperationConfig,
  loadOperationsState: mocks.loadOperationsState,
  operationChain: mocks.operationChain,
  saveOperationConfig: mocks.saveOperationConfig,
}));
vi.mock("node:fs", async (importActual) => ({
  ...await importActual(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: mocks.readFileSync,
  writeFileSync: vi.fn(),
}));
vi.mock("node:child_process", async (importActual) => ({
  ...await importActual(),
  spawn: mocks.spawn,
  execFile: mocks.execFile,
}));

const inputs: Record<string, unknown> = {
  "browse.filingsList": {},
  "browse.concepts": { cik: 320193 },
  "browse.conceptSeries": { cik: 320193, concept: "Revenues" },
  "browse.filingDocument": { cik: 320193, accessionNo: "0000320193-26-000001", primaryDoc: "filing.htm" },
  "sentiment.labStats": undefined,
  "sentiment.tickersWithScores": undefined,
  "admin.factorIc": undefined,
  "admin.manuals": undefined,
  "admin.manualContent": { id: "engine-manual-en" },
  "admin.recentJobs": undefined,
  "admin.jobLog": { jobId: 123 },
  "jobs.logs": { jobId: 123 },
  "admin.usersList": undefined,
  "admin.createUser": { username: "new_user", password: "test-password", name: "New User", role: "user" },
  "admin.deleteUser": { userId: 99 },
  "admin.resetPassword": { userId: 99, password: "test-password" },
  "admin.setUserRole": { userId: 99, role: "user" },
  "admin.reviewerList": undefined,
  "admin.createReviewer": { username: "new_reviewer", password: "test-password", name: "New Reviewer" },
  "admin.resetReviewerFirstIp": { userId: 99 },
  "admin.resetReviewerNda": { userId: 99 },
  "admin.resetReviewerTour": { userId: 99 },
  "admin.userSummary": { userId: 99 },
  "admin.userActivity": { userId: 99, limit: 10 },
  "workersLocal.enabled": undefined,
  "workersLocal.runs": { limit: 10 },
  "workersLocal.run": { worker: "stocktwits" },
  "workersLocal.kill": { id: "missing-worker" },
  "workersLocal.logTail": { id: "missing-worker", lines: 10 },
  "workersLocal.scheduler": undefined,
  "workersLocal.operations": undefined,
  "workersLocal.setOperation": { jobId: "job1", enabled: true, cron: "0 * * * *" },
  "workersLocal.runOperation": { jobId: "job1" },
  "workersLocal.killOperation": { jobId: "job1" },
  "workersLocal.operationLog": { jobId: "job1", lines: 10 },
  "workersLocal.probe": { query: "not executed" },
  "jobs.startBootstrap": {},
  "jobs.startFilingRefresh": {},
  "jobs.startStream": {},
  "pipeline.startHarvest": {},
  "pipeline.startSeriesBuild": {},
  "pipeline.startSectionParse": {},
  "sentiment.startScore": {},
  "prices.startPrices": {},
  "prices.startImport": { batch: "00000000-0000-0000-0000-000000000000" },
  "screener.refresh": undefined,
  "scope.enrichClassification": undefined,
  "workersMonitor.intake": undefined,
};

const enabledOwnerProcedures = Object.keys(inputs).filter((name) => name !== "workersLocal.probe");

function caller(role: "admin" | "user") {
  return appRouter.createCaller({
    req: new Request("http://127.0.0.1/"),
    resHeaders: new Headers(),
    viewAsUserId: null,
    user: { id: role === "admin" ? 1 : 2, role } as any,
    reviewerAccess: null,
  });
}

function invoke(role: "admin" | "user", procedure: string): Promise<unknown> {
  const [namespace, method] = procedure.split(".");
  const target = caller(role) as any;
  return target[namespace][method](inputs[procedure]);
}

describe("owner procedure authorization", () => {
  const previousLocalWorkerUi = process.env.LOCAL_WORKER_UI;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LOCAL_WORKER_UI = "1";
    mocks.jobStartedBy = 1;
    mocks.spawn.mockReturnValue({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn(), kill: vi.fn() });
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));
  });
  afterEach(() => {
    if (previousLocalWorkerUi === undefined) delete process.env.LOCAL_WORKER_UI;
    else process.env.LOCAL_WORKER_UI = previousLocalWorkerUi;
  });

  it("refuses a member for every owner procedure", async () => {
    for (const procedure of Object.keys(inputs)) {
      await expect(invoke("user", procedure), procedure).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("allows the owner for every enabled owner procedure with mocked side effects", async () => {
    for (const procedure of enabledOwnerProcedures) {
      await expect(invoke("admin", procedure), procedure).resolves.toBeDefined();
    }
    expect(mocks.createJob).toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("keeps the GDELT probe frozen even for the owner", async () => {
    await expect(invoke("admin", "workersLocal.probe")).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("GDELT is frozen") });
  });

  it("lets a member read only logs for jobs they started", async () => {
    mocks.jobStartedBy = 2;
    await expect(invoke("user", "jobs.logs")).resolves.toBeDefined();
    mocks.jobStartedBy = 1;
    await expect(invoke("user", "jobs.logs")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(invoke("admin", "jobs.logs")).resolves.toBeDefined();
  });
});
