/**
 * Form 4 insider-buy activity — REVIEWED PREVIEW SAMPLE, not a full-universe run.
 *
 * Two real SEC EDGAR filings fetched 2026-11-08 for UI/logic development:
 *   0000050863-26-000195 — INTC CEO Lip-Bu Tan open-market buy (code P)
 *   0000050863-26-000194 — INTC EVP RSU vest + tax withholding (codes M/F noise)
 * Replaced by the worker export once the full Form 4 pipeline finishes.
 * Source: SEC EDGAR ownership XML. availableAt = filing date, eventTs = trade date.
 */
import type { Form4Transaction } from "@/lib/insider-form4";

export interface Form4ServingCluster {
  clusterId: string;
  ticker: string;
  windowStart: string;
  windowEnd: string;
  availableAt: string;
  status: "computed" | "partial" | "not_computable";
  uniqueInsiders: number;
  multiOwner: boolean;
  hasCeo: boolean;
  hasCfo: boolean;
  hasDirector: boolean;
  hasTenPercentOwner: boolean;
  aggregatePurchaseUsd: number | null;
  maxSinglePurchaseUsd: number | null;
}

export interface Form4ActivityFeed {
  schemaVersion: 1;
  status: "preview_sample" | "full_run";
  generatedAt: string;
  universe: number | string;
  note?: string;
  totals?: { accessions: number; transactions: number; clusters: number };
  transactions: Form4Transaction[];
  clusters?: Form4ServingCluster[];
  kpi?: {
    openMarketBuyCount: number;
    openMarketBuyUsd: number;
    excludedCount: number;
    excludedUsd: number;
    uniqueInsidersBuying: number;
    multiOwnerTransactions: number;
  };
  perTicker?: (Form4ActivityFeed["kpi"] & { ticker: string; clusters: number })[];
  benchmarkRuns?: {
    generatedAt: string;
    dryRun: true;
    notProductionAlpha: true;
    priceCoverage: { status: "degraded" | "current"; latestDate: string; note?: string };
    horizons: Record<string, { hitRate: number; medianExcess: number; coverage: number }>;
  }[];
}

const INTC_CIK = 50863;

export const form4InsiderActivity: Form4ActivityFeed = {
  schemaVersion: 1,
  status: "preview_sample",
  generatedAt: "2026-11-08T00:00:00.000Z",
  universe: "research-universe-50",
  note: "Two real EDGAR filings for UI development — not a full-universe extraction. Derivative-table legs of RSU exercises are excluded from the MVP surface.",
  transactions: [
    // --- INTC CEO open-market purchase (the signal) ---
    {
      accessionNo: "0000050863-26-000195",
      issuerCik: INTC_CIK,
      ticker: "INTC",
      ownerName: "TAN LIP BU",
      ownerCik: "0001008463",
      isDirector: true,
      isOfficer: true,
      officerTitle: "CEO",
      isTenPercentHolder: false,
      preplanned: false,
      securityTitle: "Common Stock",
      transactionDate: "2026-11-02",
      transactionCode: "P",
      equitySwapInvolved: false,
      acquiredDisposedCode: "A",
      shares: 150000,
      pricePerShare: 64.7312,
      sharesOwnedAfter: 1464669,
      directOrIndirect: "I",
      natureOfOwnership: "by Family Trust",
      footnoteIds: ["F1"],
      filingDate: "2026-11-04",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000195/0000050863-26-000195-index.html",
    },
    // --- INTC EVP, CT & Ops Officer / GM Foundry — RSU vest noise (excluded) ---
    {
      accessionNo: "0000050863-26-000194",
      issuerCik: INTC_CIK,
      ticker: "INTC",
      ownerName: "Chandrasekaran Nagasubramaniyan",
      ownerCik: "0002082075",
      isDirector: false,
      isOfficer: true,
      officerTitle: "EVP, CT & Ops Off, GM Foundry",
      isTenPercentHolder: false,
      preplanned: false,
      securityTitle: "Common Stock",
      transactionDate: "2026-10-30",
      transactionCode: "M",
      equitySwapInvolved: false,
      acquiredDisposedCode: "A",
      shares: 33008,
      pricePerShare: null,
      sharesOwnedAfter: 257377,
      directOrIndirect: "D",
      natureOfOwnership: null,
      footnoteIds: ["F1", "F3"],
      filingDate: "2026-11-02",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000194/0000050863-26-000194-index.html",
    },
    {
      accessionNo: "0000050863-26-000194",
      issuerCik: INTC_CIK,
      ticker: "INTC",
      ownerName: "Chandrasekaran Nagasubramaniyan",
      ownerCik: "0002082075",
      isDirector: false,
      isOfficer: true,
      officerTitle: "EVP, CT & Ops Off, GM Foundry",
      isTenPercentHolder: false,
      preplanned: false,
      securityTitle: "Common Stock",
      transactionDate: "2026-10-30",
      transactionCode: "F",
      equitySwapInvolved: false,
      acquiredDisposedCode: "D",
      shares: 14739,
      pricePerShare: 65.99,
      sharesOwnedAfter: 242638,
      directOrIndirect: "D",
      natureOfOwnership: null,
      footnoteIds: [],
      filingDate: "2026-11-02",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000194/0000050863-26-000194-index.html",
    },
    {
      accessionNo: "0000050863-26-000194",
      issuerCik: INTC_CIK,
      ticker: "INTC",
      ownerName: "Chandrasekaran Nagasubramaniyan",
      ownerCik: "0002082075",
      isDirector: false,
      isOfficer: true,
      officerTitle: "EVP, CT & Ops Off, GM Foundry",
      isTenPercentHolder: false,
      preplanned: false,
      securityTitle: "Common Stock",
      transactionDate: "2026-10-30",
      transactionCode: "M",
      equitySwapInvolved: false,
      acquiredDisposedCode: "A",
      shares: 44010,
      pricePerShare: null,
      sharesOwnedAfter: 286648,
      directOrIndirect: "D",
      natureOfOwnership: null,
      footnoteIds: ["F4"],
      filingDate: "2026-11-02",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000194/0000050863-26-000194-index.html",
    },
    {
      accessionNo: "0000050863-26-000194",
      issuerCik: INTC_CIK,
      ticker: "INTC",
      ownerName: "Chandrasekaran Nagasubramaniyan",
      ownerCik: "0002082075",
      isDirector: false,
      isOfficer: true,
      officerTitle: "EVP, CT & Ops Off, GM Foundry",
      isTenPercentHolder: false,
      preplanned: false,
      securityTitle: "Common Stock",
      transactionDate: "2026-10-30",
      transactionCode: "F",
      equitySwapInvolved: false,
      acquiredDisposedCode: "D",
      shares: 19651,
      pricePerShare: 65.99,
      sharesOwnedAfter: 266997,
      directOrIndirect: "D",
      natureOfOwnership: null,
      footnoteIds: [],
      filingDate: "2026-11-02",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000194/0000050863-26-000194-index.html",
    },
    {
      accessionNo: "0000050863-26-000194",
      issuerCik: INTC_CIK,
      ticker: "INTC",
      ownerName: "Chandrasekaran Nagasubramaniyan",
      ownerCik: "0002082075",
      isDirector: false,
      isOfficer: true,
      officerTitle: "EVP, CT & Ops Off, GM Foundry",
      isTenPercentHolder: false,
      preplanned: false,
      securityTitle: "Common Stock",
      transactionDate: "2026-10-30",
      transactionCode: "M",
      equitySwapInvolved: false,
      acquiredDisposedCode: "A",
      shares: 102680,
      pricePerShare: null,
      sharesOwnedAfter: 369677,
      directOrIndirect: "D",
      natureOfOwnership: null,
      footnoteIds: ["F5"],
      filingDate: "2026-11-02",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000194/0000050863-26-000194-index.html",
    },
    {
      accessionNo: "0000050863-26-000194",
      issuerCik: INTC_CIK,
      ticker: "INTC",
      ownerName: "Chandrasekaran Nagasubramaniyan",
      ownerCik: "0002082075",
      isDirector: false,
      isOfficer: true,
      officerTitle: "EVP, CT & Ops Off, GM Foundry",
      isTenPercentHolder: false,
      preplanned: false,
      securityTitle: "Common Stock",
      transactionDate: "2026-10-30",
      transactionCode: "F",
      equitySwapInvolved: false,
      acquiredDisposedCode: "D",
      shares: 45847,
      pricePerShare: 65.99,
      sharesOwnedAfter: 323830,
      directOrIndirect: "D",
      natureOfOwnership: null,
      footnoteIds: [],
      filingDate: "2026-11-02",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000194/0000050863-26-000194-index.html",
    },
  ],
} as const;
