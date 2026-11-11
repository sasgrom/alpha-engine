import { describe, expect, it } from "vitest";
import { buildFactIndex, type SecFact } from "./flash-facts";
import { processRelease, sourceSha256, type ReleaseContext } from "./flash-pipeline";
import { buildFlashSummary, buildFlashSummaryStreaming } from "./flash-summary";

describe("flash summary streaming", () => {
  it("matches the full in-memory summary on the same releases", () => {
    const html = `<p>Consolidated Statements of Income (In millions)</p><table><tr><td></td><td>Three Months Ended September 26, 2026</td><td>Three Months Ended September 27, 2025</td></tr><tr><td>Revenue</td><td>114477</td><td>102466</td></tr><tr><td>Operating income</td><td>35631</td><td>30100</td></tr></table>`;
    const release: ReleaseContext = { cik: 1, ticker: "AAA", accessionNo: "one", filingDate: "2026-10-01", acceptedEt: null, fiscalPeriodEnd: "2026-09-26", periodicAccession: "periodic", periodicForm: "10-Q" };
    const facts: SecFact[] = [
      { cik: 1, concept: "Revenue", unit: "USD", startDate: "2025-06-29", endDate: "2025-09-27", val: 102466000000, form: "10-Q", filed: "2025-10-30", accn: "old" },
      { cik: 1, concept: "Revenue", unit: "USD", startDate: "2026-06-28", endDate: "2026-09-26", val: 114477000000, form: "10-Q", filed: "2026-11-03", accn: "periodic" },
    ];
    const result = processRelease(release, [{ file: "one.htm", sha256: sourceSha256(html), html }], buildFactIndex(facts));
    const options = { generatedAt: "2026-11-11T00:00:00Z", codeCommit: "test", codeHash: "test", goldenDocuments: [], run: { expectedReleases: 1, cacheHits: 0, processedThisRun: 1, exhibits: 1, duplicateExhibits: 0, missingExhibitReleases: 0 }, artifacts: {} };
    const full = buildFlashSummary({ releases: [release], results: [result], ...options });
    const streaming = buildFlashSummaryStreaming({ releases: [release], readResult: () => result, ...options });
    expect(streaming).toEqual(full);
  });
});
