import { beforeEach, describe, expect, it, vi } from "vitest";

const { computeCompanyFactorsMock, executeMock, transactionMock, valuesMock } = vi.hoisted(() => ({
  computeCompanyFactorsMock: vi.fn(),
  executeMock: vi.fn(),
  transactionMock: vi.fn(),
  valuesMock: vi.fn(),
}));

vi.mock("../queries/connection", () => ({
  getDb: () => ({ execute: executeMock, transaction: transactionMock }),
}));
vi.mock("./factors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./factors")>()),
  computeCompanyFactors: computeCompanyFactorsMock,
}));

import { materializeFactorPoints } from "./factor-ic";

const periodEnd = "2024-12-31";
const availability = (concept: string, firstFiled: string | null, val: number | null = 1) => ({ concept, periodEnd, sourceFiled: firstFiled, val });
const requiredAvailability = (firstFiled = "2025-02-01") => [
  availability("NetIncomeLoss", firstFiled),
  availability("NetCashProvidedByUsedInOperatingActivities", firstFiled),
  availability("Assets", firstFiled),
];

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (callback) => callback({
    delete: () => ({ where: async () => undefined }),
    insert: () => ({ values: valuesMock }),
  }));
  valuesMock.mockResolvedValue(undefined);
  computeCompanyFactorsMock.mockImplementation(async (_cik, vintage = "latest") => ({
    detail: {
      accruals: {
        value: vintage === "first" ? 100 : 200,
        history: [{ t: periodEnd, v: vintage === "first" ? 100 : 200 }],
        band: null,
      },
    },
  }));
});

describe("research factor point materialization", () => {
  it("uses first-vintage values and first-filed availability instead of revised values", async () => {
    executeMock.mockResolvedValue([[...requiredAvailability(), availability("NetIncomeLoss", "2025-02-01", 100)]]);

    const count = await materializeFactorPoints(1);

    expect(computeCompanyFactorsMock).toHaveBeenCalledWith(1, "first");
    expect(count).toBe(1);
    const rows = valuesMock.mock.calls[0][0];
    expect(rows).toEqual([expect.objectContaining({ value: 100, filedAt: "2025-02-01 00:00:00" })]);
    expect(rows.some((row: { value: number; filedAt: string }) => row.value === 200 && row.filedAt < "2025-06-01")).toBe(false);
  });

  it("uses MAX first-filed across required concepts and ignores unrelated early facts", async () => {
    executeMock.mockResolvedValue([[
      availability("UnrelatedEarlyConcept", "2025-02-01"),
      ...requiredAvailability("2025-04-15"),
    ]]);

    await materializeFactorPoints(1);

    expect(valuesMock.mock.calls[0][0][0].filedAt).toBe("2025-04-15 00:00:00");
  });

  it("omits the research row when required availability is missing", async () => {
    executeMock.mockResolvedValue([[
      availability("NetIncomeLoss", "2025-02-01"),
      availability("Assets", "2025-02-01"),
    ]]);

    const count = await materializeFactorPoints(1);

    expect(count).toBe(0);
    expect(valuesMock).not.toHaveBeenCalled();
  });
});
