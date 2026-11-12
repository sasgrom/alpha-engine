import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeJsonAtomic: vi.fn(), buildMarketReportGzip: vi.fn() }));
vi.mock("./json-file", () => ({ writeJsonAtomic: mocks.writeJsonAtomic }));
vi.mock("./market-report-gzip", () => ({ buildMarketReportGzip: mocks.buildMarketReportGzip }));

import { writeSchwabJsonOutputs } from "./schwab-output";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Schwab JSON outputs", () => {
  it("builds gzip immediately after writing the normalized market JSON", () => {
    const snapshot = { generatedAt: "2026-11-11T12:00:00.000Z", options: [] };
    writeSchwabJsonOutputs("schwab-market-data.json", snapshot);
    expect(mocks.buildMarketReportGzip).toHaveBeenCalledWith({ sourceFile: expect.stringMatching(/public[\\/]reports[\\/]schwab-market-data\.json$/) });
  });

  it("does not gzip unrelated context reports", () => {
    writeSchwabJsonOutputs("schwab-context.json", { generatedAt: "2026-11-11T12:00:00.000Z" });
    expect(mocks.buildMarketReportGzip).not.toHaveBeenCalled();
  });
});
