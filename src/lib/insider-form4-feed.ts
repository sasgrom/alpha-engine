import { form4InsiderActivity, type Form4ActivityFeed } from "@/data/form4-insider-activity";
import type { Form4Transaction } from "@/lib/insider-form4";

export function normalizeForm4Transaction(row: any): Form4Transaction {
  return {
    accessionNo: String(row.accessionNo),
    issuerCik: Number(row.issuerCik),
    ticker: String(row.ticker),
    ownerName: String(row.rptOwnerName),
    ownerCik: String(row.ownerCik ?? ""),
    isDirector: row.isDirector === true,
    isOfficer: row.isOfficer === true,
    officerTitle: row.officerTitle ?? null,
    isTenPercentHolder: row.isTenPercentOwner === true,
    preplanned: false,
    securityTitle: "Form 4 ownership",
    transactionDate: String(row.eventTs),
    transactionCode: String(row.transactionCode),
    equitySwapInvolved: row.equitySwapInvolved === true,
    acquiredDisposedCode: row.acquiredDisposedCode ?? null,
    shares: row.shares ?? null,
    pricePerShare: row.pricePerShare ?? null,
    sharesOwnedAfter: row.sharesOwnedAfter ?? null,
    directOrIndirect: row.directOrIndirect ?? null,
    natureOfOwnership: row.natureOfOwnership || null,
    footnoteIds: [],
    filingDate: String(row.availableAt).slice(0, 10),
    sourceUrl: String(row.sourceUrl),
    owners: row.owners,
    multiOwner: row.multiOwner === true,
    exclusionReason: row.exclusionReason ?? null,
    clusterId: row.clusterId ?? null,
    availableAt: String(row.availableAt),
    isAmendment: row.isAmendment === true,
    amendmentOf: row.amendmentOf ?? null,
  };
}

export async function loadForm4ActivityFeed(fetcher: typeof fetch = fetch): Promise<Form4ActivityFeed> {
  const response = await fetcher("/reports/insider-form4.json", { cache: "no-store" });
  if (response.status === 404) return form4InsiderActivity;
  if (!response.ok) throw new Error(`Form 4 full-run report is unavailable (HTTP ${response.status})`);
  const feed = await response.json() as Form4ActivityFeed;
  if (feed.status !== "full_run" || feed.universe !== 50 || !feed.totals || !feed.kpi || !feed.perTicker
    || feed.transactions.length !== Math.min(500, feed.totals.transactions)
    || !feed.clusters || feed.clusters.length !== feed.totals.clusters) {
    throw new Error("Form 4 report is not a complete full-run artifact");
  }
  return { ...feed, transactions: feed.transactions.map(normalizeForm4Transaction) };
}
