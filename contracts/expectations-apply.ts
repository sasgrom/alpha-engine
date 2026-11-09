export const EXPECTATIONS_APPLY_TABLES = ["expectations_reviewed_packages", "expectations_reviewed_results"] as const;
export const EXPECTATIONS_REVIEWED_PACKAGE_VERSION = "3.4";
export const EXPECTATIONS_REVIEWED_PACKAGE_SHA256 = "1580284b108cf58127b4541cac0eb0124ccbbd10caf5e6eba9a75b5c097465ea";
export const EXPECTATIONS_REVIEWED_MANIFEST_SHA256 = "39dc5ad95cc226b3d04cd0b8c06085d1bc4db0742d928e032fb56c8726f0e7d1";

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
