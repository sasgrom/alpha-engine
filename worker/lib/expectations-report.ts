import type { ExpectationResponse, ExpectationStatement } from "./expectations";
import type { ExpectationFallback } from "./expectation-fallback";
import { mergeGuidanceStatus } from "./exhibits";

export interface ExpectationResultForReport {
  cik: number;
  ticker: string;
  cohortId?: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  sourceFile: string;
  status: "extracted" | "empty" | "no_candidate_text" | "unparsed" | "request_failed" | "fallback" | "fallback_unverified";
  guidanceStatus: ExpectationResponse["guidanceStatus"] | null;
  fallback?: (ExpectationFallback & { evidenceVerified: boolean }) | null;
  statements: ExpectationStatement[];
  rejectedEvidence: number;
  usage: { promptTokens: number; evalCount: number } | null;
}
export interface ExpectationCompanyReport {
  cik: number;
  ticker: string;
  documents: number;
  statements: number;
  guidanceStatus: ExpectationResponse["guidanceStatus"] | null;
}
export interface ExpectationReportStatement extends ExpectationStatement {
  cik: number;
  ticker: string;
  cohortId: string | null;
  accessionNo: string;
  form: string;
  filingDate: string;
  sourceUrl: string;
}
export interface ExpectationFallbackReport {
  cik: number;
  ticker: string;
  cohortId: string | null;
  accessionNo: string;
  form: string;
  filingDate: string;
  sourceUrl: string;
  summary: string;
  dataQuality: ExpectationFallback["dataQuality"];
  guidancePresence: ExpectationFallback["guidancePresence"];
  limitations: string[];
  evidence: string;
  evidenceVerified: boolean;
}

export interface ExpectationsReport {
  schemaVersion: 2;
  generatedAt: string;
  scope: string;
  status: "waiting" | "partial" | "reviewed";
  coverage: {
    companiesExpected: number;
    companiesWithResults: number;
    documents: number;
    extracted: number;
    noCandidate: number;
    unparsed: number;
    failed: number;
    statements: number;
    fallback: number;
    fallbackUnverified: number;
    rejectedEvidence: number;
    promptTokens: number;
    evalTokens: number;
  };
  benchmark: { pass: boolean; recall: number | null; issueCount: number } | null;
  companies: ExpectationCompanyReport[];
  statements: ExpectationReportStatement[];
  fallbacks: ExpectationFallbackReport[];
}

export function buildExpectationsReport(
  universe: { cik: number; ticker: string }[],
  results: ExpectationResultForReport[],
  generatedAt: string,
  scope: string,
  benchmark: ExpectationsReport["benchmark"] = null,
  reviewed = false,
): ExpectationsReport {
  const documents = results.length;
  if (reviewed && (!benchmark?.pass || documents === 0)) throw new Error("Reviewed publication requires results and a passing independent benchmark");
  const companies = universe.map((company) => {
    const rows = results.filter((result) => result.cik === company.cik);
    return {
      ...company,
      documents: rows.length,
      statements: rows.reduce((sum, row) => sum + row.statements.length, 0),
      guidanceStatus: mergeGuidanceStatus(rows.map((row) => row.guidanceStatus)),
    };
  });
  const statements = results.flatMap((result) => result.statements.map((statement) => ({
    ...statement,
    cik: result.cik,
    ticker: result.ticker,
    cohortId: result.cohortId ?? null,
    accessionNo: result.accessionNo,
    form: result.form,
    filingDate: result.filingDate,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${result.cik}/${result.accessionNo.replace(/-/g, "")}/`,
  })));
  const fallbacks = results.flatMap((result) => {
    if (!result.fallback) return [];
    const { summary, dataQuality, guidancePresence, limitations, evidence } = result.fallback;
    return [{
      cik: result.cik,
      ticker: result.ticker,
      cohortId: result.cohortId ?? null,
      accessionNo: result.accessionNo,
      form: result.form,
      filingDate: result.filingDate,
      sourceUrl: `https://www.sec.gov/Archives/edgar/data/${result.cik}/${result.accessionNo.replace(/-/g, "")}/`,
      summary,
      dataQuality,
      guidancePresence,
      limitations,
      evidence,
      evidenceVerified: result.fallback.evidenceVerified,
    }];
  });
  return {
    schemaVersion: 2,
    generatedAt,
    scope,
    status: reviewed ? "reviewed" : documents ? "partial" : "waiting",
    coverage: {
      companiesExpected: universe.length,
      companiesWithResults: new Set(results.map((result) => result.cik)).size,
      documents,
      extracted: results.filter((result) => result.status === "extracted").length,
      noCandidate: results.filter((result) => result.status === "no_candidate_text").length,
      unparsed: results.filter((result) => result.status === "unparsed").length,
      failed: results.filter((result) => result.status === "request_failed").length,
      statements: statements.length,
      fallback: results.filter((result) => result.status === "fallback").length,
      fallbackUnverified: results.filter((result) => result.status === "fallback_unverified").length,
      rejectedEvidence: results.reduce((sum, result) => sum + result.rejectedEvidence, 0),
      promptTokens: results.reduce((sum, result) => sum + (result.usage?.promptTokens ?? 0), 0),
      evalTokens: results.reduce((sum, result) => sum + (result.usage?.evalCount ?? 0), 0),
    },
    benchmark,
    companies,
    statements,
    fallbacks,
  };
}
