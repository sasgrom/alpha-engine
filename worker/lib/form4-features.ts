import { addBusinessDays, sha256Text, type Form4Owner, type Form4Transaction, type PriceBar } from "./form4-core";

export interface Form4FeatureValue {
  status: "computed" | "not_computable";
  value: number | null;
  reason?: string;
}

export interface InsiderBuyCluster {
  signal: "insider_buy_cluster_v1";
  clusterId: string;
  issuerCik: number;
  ticker: string;
  windowStart: string;
  windowEnd: string;
  availableAt: string;
  status: "computed" | "partial" | "not_computable";
  uniqueInsiders: number;
  uniqueInsidersExcludingMultiOwner: number;
  multiOwner: boolean;
  multiOwnerTransactionCount: number;
  multiOwnerPurchaseUsd: number | null;
  purchaseCountExcludingMultiOwner: number;
  aggregatePurchaseUsdExcludingMultiOwner: number | null;
  hasCeo: boolean;
  hasCfo: boolean;
  hasDirector: boolean;
  hasTenPercentOwner: boolean;
  aggregatePurchaseUsd: number | null;
  maxSinglePurchaseUsd: number | null;
  purchaseToMarketCap: Form4FeatureValue;
  purchaseToAdv20: Form4FeatureValue;
  ownershipIncreasePct: number | null;
  drawdown20d: Form4FeatureValue;
  flipAfterSell90d: boolean;
  purchaseCount: number;
  missingValueCount: number;
  accessionNos: string[];
}

export function supersedeForm4Transactions(transactions: Form4Transaction[]): Form4Transaction[] {
  const seen = new Set<string>();
  return transactions.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.accessionNo.localeCompare(b.accessionNo) || a.eventTs.localeCompare(b.eventTs));
}

export function form4ExclusionReason(transaction: Form4Transaction): string | null {
  if (transaction.transactionCode === "P" && transaction.equitySwapInvolved === false) return null;
  if (transaction.transactionCode === "P" && transaction.equitySwapInvolved === true) return "equity_swap";
  if (transaction.transactionCode === "P") return "unknown_equity_swap";
  if (transaction.transactionCode === "A") return "award";
  if (transaction.transactionCode === "M") return "option_exercise";
  if (transaction.transactionCode === "F") return "rsu_tax_withholding";
  if (transaction.transactionCode === "G") return "gift";
  if (transaction.transactionCode === "S") return "sale";
  if (/restricted stock|tax withholding/i.test(`${transaction.transactionFormType} ${transaction.footnotes.join(" ")}`)) return "rsu_tax_withholding";
  return "other_excluded";
}

function ownersOf(transaction: Form4Transaction): Form4Owner[] {
  return transaction.owners?.length ? transaction.owners : [{
    ownerCik: transaction.ownerCik,
    rptOwnerName: transaction.rptOwnerName,
    isDirector: transaction.isDirector,
    isOfficer: transaction.isOfficer,
    isTenPercentOwner: transaction.isTenPercentOwner,
    isOther: false,
    officerTitle: transaction.officerTitle,
    otherText: null,
  }];
}

export function form4AffiliatedOwnerKeys(transaction: Form4Transaction): string[] {
  const owners = ownersOf(transaction);
  if (transaction.multiOwner && owners.length > 1) {
    return [`joint:${owners.map((owner) => String(owner.ownerCik ?? owner.rptOwnerName)).sort().join("|")}`];
  }
  return owners.map((owner) => String(owner.ownerCik ?? owner.rptOwnerName));
}

function sameOwner(left: Form4Transaction, right: Form4Transaction): boolean {
  const rightOwners = new Set(ownersOf(right).map((owner) => owner.ownerCik ?? owner.rptOwnerName));
  return ownersOf(left).some((owner) => rightOwners.has(owner.ownerCik ?? owner.rptOwnerName));
}

function ownershipIncrease(transaction: Form4Transaction): number | null {
  if (transaction.shares === null || transaction.sharesOwnedAfter === null || transaction.shares <= 0) return null;
  const previous = transaction.sharesOwnedAfter - transaction.shares;
  return previous > 0 ? transaction.shares / previous : null;
}

function optionalMarketValues(cluster: Omit<InsiderBuyCluster, "purchaseToMarketCap" | "purchaseToAdv20" | "drawdown20d">, bars: PriceBar[]) {
  const anchorDate = cluster.availableAt.slice(0, 10);
  const eligible = bars.filter((bar) => bar.date <= anchorDate);
  const advBars = eligible.slice(-20);
  const purchaseToAdv20 = cluster.aggregatePurchaseUsd !== null && advBars.length === 20 && advBars.every((bar) => bar.volume > 0)
    ? { status: "computed" as const, value: cluster.aggregatePurchaseUsd / (advBars.reduce((sum, bar) => sum + bar.volume, 0) / 20) }
    : { status: "not_computable" as const, value: null, reason: "20 reviewed daily bars are unavailable before availableAt" };
  const drawdown20d = eligible.length >= 21 && eligible.at(-21)!.close !== 0
    ? { status: "computed" as const, value: eligible.at(-1)!.close / eligible.at(-21)!.close - 1 }
    : { status: "not_computable" as const, value: null, reason: "21 reviewed daily bars are unavailable before availableAt" };
  return { purchaseToAdv20, drawdown20d };
}

export function buildInsiderBuyClusters(
  transactions: Form4Transaction[],
  priceBarsByTicker: Record<string, PriceBar[]>,
): { clusters: InsiderBuyCluster[]; exclusionCounts: Record<string, number> } {
  const rows = supersedeForm4Transactions(transactions);
  const exclusionCounts: Record<string, number> = {};
  const purchases = rows.filter((row) => {
    const reason = form4ExclusionReason(row);
    if (reason) exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
    return reason === null;
  }).sort((a, b) => a.eventTs.localeCompare(b.eventTs) || a.availableAt.localeCompare(b.availableAt));
  const clusters: InsiderBuyCluster[] = [];
  for (let index = 0; index < purchases.length;) {
    const windowStart = purchases[index].eventTs;
    const windowLimit = addBusinessDays(windowStart, 9);
    const clusterRows = [];
    const issuerCik = purchases[index].issuerCik;
    const ticker = purchases[index].ticker;
    while (index < purchases.length && purchases[index].issuerCik === issuerCik && purchases[index].eventTs <= windowLimit) {
      clusterRows.push(purchases[index]);
      index++;
    }
    const windowEnd = clusterRows.at(-1)!.eventTs;
    const values = clusterRows.map((row) => row.valueUsd).filter((value): value is number => value !== null);
    const ownerRows = clusterRows.flatMap(ownersOf);
    const ownerRowsExcludingMulti = clusterRows.filter((row) => !row.multiOwner).flatMap(ownersOf);
    const owners = new Set(clusterRows.flatMap(form4AffiliatedOwnerKeys));
    const ownersExcludingMulti = new Set(ownerRowsExcludingMulti.map((owner) => owner.ownerCik ?? owner.rptOwnerName));
    const multiOwnerRows = clusterRows.filter((row) => row.multiOwner);
    const multiOwnerValues = multiOwnerRows.map((row) => row.valueUsd).filter((value): value is number => value !== null);
    const valuesExcludingMulti = clusterRows.filter((row) => !row.multiOwner).map((row) => row.valueUsd).filter((value): value is number => value !== null);
    const availableAt = clusterRows.map((row) => row.availableAt).sort().at(-1)!;
    const aggregatePurchaseUsd = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    const base = {
      signal: "insider_buy_cluster_v1" as const,
      issuerCik,
      ticker,
      windowStart,
      windowEnd,
      availableAt,
      status: values.length === clusterRows.length ? "computed" as const : "partial" as const,
      uniqueInsiders: owners.size,
      uniqueInsidersExcludingMultiOwner: ownersExcludingMulti.size,
      multiOwner: multiOwnerRows.length > 0,
      multiOwnerTransactionCount: multiOwnerRows.length,
      multiOwnerPurchaseUsd: multiOwnerValues.length ? multiOwnerValues.reduce((sum, value) => sum + value, 0) : null,
      purchaseCountExcludingMultiOwner: clusterRows.length - multiOwnerRows.length,
      aggregatePurchaseUsdExcludingMultiOwner: valuesExcludingMulti.length ? valuesExcludingMulti.reduce((sum, value) => sum + value, 0) : null,
      hasCeo: ownerRows.some((owner) => /chief executive officer|\bCEO\b/i.test(owner.officerTitle ?? "")),
      hasCfo: ownerRows.some((owner) => /chief financial officer|\bCFO\b/i.test(owner.officerTitle ?? "")),
      hasDirector: ownerRows.some((owner) => owner.isDirector),
      hasTenPercentOwner: ownerRows.some((owner) => owner.isTenPercentOwner),
      aggregatePurchaseUsd,
      maxSinglePurchaseUsd: values.length ? Math.max(...values) : null,
      ownershipIncreasePct: (() => {
        const increases = clusterRows.map(ownershipIncrease).filter((value): value is number => value !== null);
        return increases.length ? Math.max(...increases) : null;
      })(),
      flipAfterSell90d: clusterRows.some((purchase) => rows.some((candidate) => candidate.transactionCode === "S"
        && sameOwner(candidate, purchase)
        && candidate.eventTs < windowStart
        && candidate.eventTs >= new Date(new Date(`${windowStart}T00:00:00Z`).getTime() - 90 * 86400_000).toISOString().slice(0, 10))),
      purchaseCount: clusterRows.length,
      missingValueCount: clusterRows.length - values.length,
      accessionNos: [...new Set(clusterRows.map((row) => row.accessionNo))],
    };
    const clusterId = `insider_buy_cluster_v1:${issuerCik}:${windowStart}:${sha256Text([...owners].sort().join("|") + `:${windowEnd}`).slice(0, 16)}`;
    clusters.push({
      ...base,
      clusterId,
      purchaseToMarketCap: { status: "not_computable", value: null, reason: "Point-in-time reviewed market cap is unavailable" },
      ...optionalMarketValues({ ...base, clusterId }, priceBarsByTicker[ticker] ?? []),
    });
  }
  return { clusters, exclusionCounts };
}
