import { describe, expect, it } from "vitest";
import { requiresStandaloneRequest } from "./trpc";

describe("tRPC request batching", () => {
  it("keeps slow or research procedures out of ordinary batches", () => {
    for (const path of ["dashboard.stats", "dashboard.sectorFlows", "dashboard.sectorFlowsDetailed", "company.institutional", "company.factorIc", "company.probability"]) {
      expect(requiresStandaloneRequest(path), path).toBe(true);
    }
  });

  it("retains batching for fast queries", () => {
    for (const path of ["auth.me", "company.overview", "prices.quote", "jobs.list", "universe.list"]) {
      expect(requiresStandaloneRequest(path), path).toBe(false);
    }
  });
});
