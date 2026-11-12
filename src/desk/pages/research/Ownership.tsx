import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Card, CompanyLink, Delta, Kpi, Shimmer } from "../../components";
import { useDocumentTitle } from "../../context";
import { findCompany, useDeskSnapshot, useReport } from "../../data";
import { DevNotes } from "../../DevNotes";
import { fmtCap, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, personName } from "../../format";
import { EvidenceNote, ResearchFrame } from "../../ResearchParts";

interface InsiderTransaction {
  accessionNo: string;
  ticker: string;
  eventTs: string;
  transactionCode: string;
  shares: number | null;
  pricePerShare: number | null;
  valueUsd: number | null;
  rptOwnerName: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  officerTitle: string | null;
  sourceUrl: string | null;
}

interface InsiderCluster {
  clusterId: string;
  ticker: string;
  windowStart: string;
  windowEnd: string;
  uniqueInsidersExcludingMultiOwner: number;
  aggregatePurchaseUsd: number | null;
  hasCeo: boolean;
  hasCfo: boolean;
  hasDirector: boolean;
  flipAfterSell90d: boolean;
}

interface InsiderReport {
  generatedAt: string;
  universe: number;
  kpi: { openMarketBuyCount: number; openMarketBuyUsd: number; uniqueInsidersBuying: number };
  transactions: InsiderTransaction[];
  clusters: InsiderCluster[];
  benchmarkRuns: { methodologyStatus: string; horizons: Record<string, { hitRate: number | null; medianExcess: number | null; counts: { computed: number } }> }[];
}

function role(row: InsiderTransaction): string {
  if (row.officerTitle) return row.officerTitle;
  return [row.isOfficer && "Officer", row.isDirector && "Director", row.isTenPercentOwner && "10% owner"].filter(Boolean).join(", ") || "Insider";
}

export default function Ownership() {
  useDocumentTitle("Ownership");
  const snapshot = useDeskSnapshot();
  const insiders = useReport<InsiderReport>("insider-form4.json");
  // the 13F aggregation is the slow read of this page; it loads on its own and never holds the rest back
  const flows = trpc.dashboard.sectorFlowsDetailed.useQuery(undefined, { staleTime: 30 * 60_000, enabled: !insiders.isLoading });
  const data = snapshot.data;

  const purchases = useMemo(() => (insiders.data?.transactions ?? []).filter((row) => row.transactionCode === "P").sort((a, b) => b.eventTs.localeCompare(a.eventTs)).slice(0, 15), [insiders.data]);
  const clusters = useMemo(() => (insiders.data?.clusters ?? []).filter((row) => row.uniqueInsidersExcludingMultiOwner >= 2).sort((a, b) => b.windowEnd.localeCompare(a.windowEnd)).slice(0, 10), [insiders.data]);
  const benchmark = insiders.data?.benchmarkRuns.filter((run) => run.methodologyStatus === "canonical").at(-1) ?? null;
  const shorts = useMemo(() => (data?.companies ?? []).filter((company) => company.shortInterest?.shares).sort((a, b) => (b.shortInterest!.daysToCover ?? 0) - (a.shortInterest!.daysToCover ?? 0)).slice(0, 12), [data]);
  const flowRows = useMemo(() => [...(flows.data?.rows ?? [])].sort((a, b) => (b.deltaWeightPp ?? -Infinity) - (a.deltaWeightPp ?? -Infinity)), [flows.data]);
  const companyLink = (ticker: string) => {
    const company = findCompany(data, ticker);
    return company ? <CompanyLink company={company} className="desk-ticker">{ticker}</CompanyLink> : <span className="desk-ticker">{ticker}</span>;
  };

  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · insiders, institutions and short sellers</span>
          <h1>Ownership</h1>
          <p className="desk-lede">Who has been buying and selling the stock itself: officers and directors on Form 4, large funds in their quarterly 13F filings, and the short side.</p>
        </div>
      </div>

      <EvidenceNote family="insiders" />

      <div className="desk-kpis four">
        <Kpi label="Open-market purchases on file" value={insiders.data ? insiders.data.kpi.openMarketBuyCount.toLocaleString("en-US") : "—"} note={insiders.data ? `${fmtCap(insiders.data.kpi.openMarketBuyUsd)} by ${insiders.data.kpi.uniqueInsidersBuying} insiders · ${insiders.data.universe} companies` : "loading"} />
        <Kpi label="Windows with 3+ insiders" value={insiders.data ? String(insiders.data.clusters.filter((row) => row.uniqueInsidersExcludingMultiOwner >= 3).length) : "—"} note={insiders.data ? `of ${insiders.data.clusters.length} purchase windows of 10 days` : ""} />
        <Kpi label="Dry-run excess, 5 sessions" value={<Delta value={benchmark?.horizons.forward5d?.medianExcess ?? null} digits={2} />} note={benchmark ? `hit rate ${fmtPct(benchmark.horizons.forward5d?.hitRate ?? null, 1, false)} · ${benchmark.horizons.forward5d?.counts.computed ?? 0} windows · no interval` : "no valid run"} />
        <Kpi label="Dry-run excess, 20 sessions" value={<Delta value={benchmark?.horizons.forward20d?.medianExcess ?? null} digits={2} />} note={benchmark ? `hit rate ${fmtPct(benchmark.horizons.forward20d?.hitRate ?? null, 1, false)}` : ""} />
      </div>

      <div className="desk-grid">
        <Card className="desk-span-7" flush title="Latest insider purchases" subtitle="Open-market buys (code P) of the research companies, newest first" action={<Link className="desk-link desk-nowrap" to="/insider-activity" style={{ fontSize: 12.5 }}>All transactions <ArrowUpRight size={13} aria-hidden="true" /></Link>}>
          {insiders.isLoading ? (
            <div style={{ padding: 20 }}><Shimmer height={260} /></div>
          ) : insiders.error ? (
            <div className="desk-empty" style={{ padding: 20 }}>{(insiders.error as Error).message}</div>
          ) : purchases.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Traded</th><th>Company</th><th>Insider</th><th className="num">Value</th><th className="num">Shares at price</th><th /></tr>
                </thead>
                <tbody>
                  {purchases.map((row) => (
                    <tr key={`${row.accessionNo}-${row.eventTs}-${row.shares}`} style={{ cursor: "default" }}>
                      <td className="desk-ink-2">{fmtDate(row.eventTs, "medium")}</td>
                      <td>{companyLink(row.ticker)}</td>
                      <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{personName(row.rptOwnerName)}<span className="desk-muted"> · {role(row)}</span></td>
                      <td className="num" style={{ fontWeight: 560 }}>{fmtCap(row.valueUsd)}</td>
                      <td className="num desk-ink-2">{fmtCompact(row.shares)} at {fmtPrice(row.pricePerShare)}</td>
                      <td>{row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open the filing at the SEC"><ArrowUpRight size={14} aria-hidden="true" /></a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>No open-market purchases in the latest filings.</div>
          )}
        </Card>

        <Card className="desk-span-5" flush title="Purchase windows with several insiders" subtitle="Two or more insiders buying within 10 days, newest first">
          {insiders.isLoading ? (
            <div style={{ padding: 20 }}><Shimmer height={260} /></div>
          ) : clusters.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Window</th><th>Company</th><th className="num">Insiders</th><th className="num">Bought</th><th>Who</th></tr>
                </thead>
                <tbody>
                  {clusters.map((row) => (
                    <tr key={row.clusterId} style={{ cursor: "default" }}>
                      <td className="desk-ink-2">{fmtDate(row.windowStart, "short")} – {fmtDate(row.windowEnd, "medium")}</td>
                      <td>{companyLink(row.ticker)}</td>
                      <td className="num">{row.uniqueInsidersExcludingMultiOwner}</td>
                      <td className="num">{fmtCap(row.aggregatePurchaseUsd)}</td>
                      <td className="desk-ink-2">{[row.hasCeo && "CEO", row.hasCfo && "CFO", row.hasDirector && "director"].filter(Boolean).join(", ") || "—"}{row.flipAfterSell90d ? " · after selling" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>No window with two or more insiders.</div>
          )}
        </Card>

        <Card className="desk-span-7" flush title="Institutions by sector" subtitle={flows.data?.guard ? "Quarter-on-quarter change across the funds that filed in both quarters" : "Quarter-on-quarter change in 13F holdings"}>
          {flows.isPending ? (
            <div style={{ padding: 20, display: "grid", gap: 8 }}><Shimmer height={18} /><Shimmer height={18} width="70%" /><span className="desk-muted" style={{ fontSize: 12 }}>Reading the 13F holdings…</span></div>
          ) : flows.isError ? (
            <div className="desk-empty" style={{ padding: 20 }}>The 13F flows could not be read right now.</div>
          ) : flowRows.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Sector</th><th className="num">Held now</th><th className="num">Change in value</th><th className="num">Change in weight</th></tr>
                </thead>
                <tbody>
                  {flowRows.map((row) => (
                    <tr key={row.sector} style={{ cursor: "default" }}>
                      <td style={{ fontWeight: 560 }}>{row.sector}</td>
                      <td className="num">{fmtCap(row.curUsd)}</td>
                      <td className="num"><span className={`desk-num desk-${row.deltaUsd > 0 ? "up" : row.deltaUsd < 0 ? "down" : "flat"}`}>{row.deltaUsd < 0 ? "−" : "+"}{fmtCap(Math.abs(row.deltaUsd)).replace("—", "$0")}</span></td>
                      <td className="num">{row.deltaWeightPp === null ? "—" : <span className={`desk-num desk-${row.deltaWeightPp > 0 ? "up" : row.deltaWeightPp < 0 ? "down" : "flat"}`}>{fmtNum(row.deltaWeightPp, 2)} pts</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>No comparable pair of 13F quarters is stored.</div>
          )}
        </Card>

        <Card className="desk-span-5" flush title="Short interest" subtitle="Research companies, most days to cover first">
          {shorts.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Company</th><th className="num">Shares short</th><th className="num">Days to cover</th><th>As of</th></tr>
                </thead>
                <tbody>
                  {shorts.map((company) => (
                    <tr key={company.cik} style={{ cursor: "default" }}>
                      <td><CompanyLink company={company} className="desk-ticker">{company.ticker}</CompanyLink></td>
                      <td className="num">{fmtCompact(company.shortInterest!.shares)}</td>
                      <td className="num">{fmtNum(company.shortInterest!.daysToCover, 1)}</td>
                      <td className="desk-ink-2">{fmtDate(company.shortInterest!.date, "short")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>No short-interest readings are stored.</div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}><EvidenceNote family="institutions" /></div>
      <DevNotes page="ownership" />
    </ResearchFrame>
  );
}
