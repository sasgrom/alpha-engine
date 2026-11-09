import {
  canonicalExpectationPackageRow,
  canonicalExpectationResultRow,
  expectationResultKey,
  expectationResultSamples,
} from "../../contracts/expectations-apply";
import { tableContentSha256 } from "./prod-backup";

export function expectedExpectationsPostCheck(reviewed: any) {
  const packageVersion = reviewed.manifest.packageVersion;
  const resultRows = reviewed.results.map((row: any) => canonicalExpectationResultRow({ ...row, packageVersion }));
  const packageRow = canonicalExpectationPackageRow({
    packageVersion,
    scope: reviewed.manifest.scope,
    normalizationVersion: reviewed.manifest.normalizationVersion,
    productionApply: false,
    benchmarkEvaluationType: reviewed.manifest.benchmarkEvaluationType,
    manifestJson: reviewed.manifest,
    readinessJson: reviewed.readiness,
  });
  return [
    {
      table: "expectations_reviewed_packages",
      packageRows: 1,
      contentSha256: tableContentSha256([packageRow]),
      sampleContentHashes: [{ key: packageVersion, sha256: tableContentSha256([packageRow]) }],
      statements: undefined,
    },
    {
      table: "expectations_reviewed_results",
      packageRows: resultRows.length,
      contentSha256: tableContentSha256(resultRows),
      sampleContentHashes: expectationResultSamples(resultRows).map((row) => ({ key: expectationResultKey(row as never), sha256: tableContentSha256([row]) })),
      statements: resultRows.reduce((sum: number, row: any) => sum + row.statements.length, 0),
    },
  ];
}

export function assertExpectationsPostCheck(response: any, reviewed: any): void {
  if (response?.packageVersion !== reviewed.manifest.packageVersion || response.results !== reviewed.results.length || response.statements !== reviewed.statements) {
    throw new Error("Worker apply response counts do not match the reviewed payload");
  }
  const actualTables = new Map((response.postCheck?.tables ?? []).map((table: any) => [table.table, table]));
  for (const expected of expectedExpectationsPostCheck(reviewed)) {
    const actual: any = actualTables.get(expected.table);
    if (!actual || actual.packageRows !== expected.packageRows || actual.contentSha256 !== expected.contentSha256 || actual.statements !== expected.statements ||
      JSON.stringify(actual.sampleContentHashes) !== JSON.stringify(expected.sampleContentHashes)) {
      throw new Error(`Worker apply post-check mismatch: ${expected.table}`);
    }
  }
}
