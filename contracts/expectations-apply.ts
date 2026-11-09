export const EXPECTATIONS_APPLY_TABLES = ["expectations_reviewed_packages", "expectations_reviewed_results"] as const;
export const EXPECTATIONS_REVIEWED_PACKAGE_VERSION = "3.3";
export const EXPECTATIONS_REVIEWED_PACKAGE_SHA256 = "b5feac0eab5c0ae6ed2639c9f14cc859ed3f5a32fc84ffedee64065a1dc5a029";
export const EXPECTATIONS_REVIEWED_MANIFEST_SHA256 = "3f61d4f46b6d9c3f18722a32d7ee7a3be6320451c59b4ce0b8c4104957c062f2";

export interface ExpectationsApplyResultRow {
  cik: number;
  accessionNo: string;
  sourceId: string;
  containerId: string;
  inputSha256: string;
  sourceUrl: string;
  status: string;
  guidanceStatus: string | null;
  statements: unknown[];
  extractionWarnings: unknown[];
  rejectedEvidence: number;
}

export const expectationResultKey = (row: Pick<ExpectationsApplyResultRow, "cik" | "accessionNo" | "sourceId" | "containerId">) =>
  `${row.cik}|${row.accessionNo}|${row.sourceId}|${row.containerId}`;

function jsonValue(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export function canonicalExpectationResultRow(row: Record<string, unknown>) {
  return {
    packageVersion: String(row.packageVersion),
    cik: Number(row.cik),
    accessionNo: String(row.accessionNo),
    sourceId: String(row.sourceId),
    containerId: String(row.containerId),
    inputSha256: String(row.inputSha256),
    sourceUrl: String(row.sourceUrl),
    status: String(row.status),
    guidanceStatus: row.guidanceStatus == null ? null : String(row.guidanceStatus),
    statements: jsonValue(row.statements),
    extractionWarnings: jsonValue(row.extractionWarnings),
    rejectedEvidence: Number(row.rejectedEvidence),
  };
}

export function canonicalExpectationPackageRow(row: Record<string, unknown>) {
  return {
    packageVersion: String(row.packageVersion),
    scope: String(row.scope),
    normalizationVersion: String(row.normalizationVersion),
    productionApply: row.productionApply === true || row.productionApply === 1,
    benchmarkEvaluationType: String(row.benchmarkEvaluationType),
    manifestJson: jsonValue(row.manifestJson),
    readinessJson: jsonValue(row.readinessJson),
  };
}

export function expectationResultSamples(rows: Record<string, unknown>[]) {
  const sorted = [...rows].sort((a, b) => expectationResultKey(a as never).localeCompare(expectationResultKey(b as never)));
  if (!sorted.length) return [];
  const indexes = [...new Set([0, Math.floor((sorted.length - 1) / 2), sorted.length - 1])];
  return indexes.map((index) => sorted[index]);
}
