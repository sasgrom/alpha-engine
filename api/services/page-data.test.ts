import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  servePageData: vi.fn(),
  db: { select: vi.fn() },
}));
vi.mock("../../worker/lib/precomputed-page-data", () => ({ servePageData: mocks.servePageData }));
vi.mock("../queries/connection", () => ({ getDb: () => mocks.db }));
vi.mock("./institutional", () => ({ institutionalSummary: vi.fn(), sectorFlowsDetailed: vi.fn() }));
vi.mock("./probability-engine", () => ({ evaluateCompany: vi.fn() }));

import { dashboardStats, institutionalPageData, probabilityPageData, sectorFlowsPageData } from "./page-data";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("precomputed API wrappers", () => {
  it("keeps live universe and job counters outside the cached global counts", async () => {
    mocks.servePageData.mockResolvedValue({ payload: { companies: 495, filings: 100, facts: 200, latestFilingDate: "2026-11-11" }, asOf: "2026-11-11T12:00:00.000Z", stale: true, dataMode: "precomputed" });
    const counts = [50, 2, 1];
    mocks.db.select.mockImplementation(() => ({ from: () => ({ where: async () => [{ n: counts.shift() }] }) }));
    expect(await dashboardStats(1)).toEqual({
      companies: 495,
      filings: 100,
      facts: 200,
      latestFilingDate: "2026-11-11",
      universe: 50,
      runningJobs: 2,
      queuedJobs: 1,
      asOf: "2026-11-11T12:00:00.000Z",
      stale: true,
      dataMode: "precomputed",
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(3);
  });

  it("preserves the institutional payload and cache metadata", async () => {
    const payload = { quarterDate: "2026-06-30", previousQuarterDate: "2026-03-31", holders: 20, sharesHeld: 100, valueUsd: 200, qoqSharesDeltaPct: 1, ownershipPct: 2, guard: null, top: [] };
    mocks.servePageData.mockResolvedValue({ payload, asOf: "2026-11-11T12:00:00.000Z", stale: false, dataMode: "precomputed" });
    expect(await institutionalPageData(320193)).toEqual({ ...payload, asOf: "2026-11-11T12:00:00.000Z", stale: false, dataMode: "precomputed" });
    expect(mocks.servePageData).toHaveBeenCalledWith(expect.objectContaining({ key: "institutional-320193" }));
  });

  it("keeps the guarded sector-flow rows unchanged", async () => {
    const payload = { rows: [{ sector: "Technology", deltaUsd: 1, curUsd: 2, deltaShares: 3, curShares: 4, deltaWeightPp: 0.1 }], guard: null };
    mocks.servePageData.mockResolvedValue({ payload, asOf: null, stale: false, dataMode: "on_request" });
    expect(await sectorFlowsPageData()).toEqual({ ...payload, asOf: null, stale: false, dataMode: "on_request" });
  });

  it("preserves a null probability result", async () => {
    mocks.servePageData.mockResolvedValue({ payload: null, asOf: "2026-11-11T12:00:00.000Z", stale: false, dataMode: "precomputed" });
    expect(await probabilityPageData(320193)).toBeNull();
  });
});
