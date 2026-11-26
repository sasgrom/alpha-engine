import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { Card, CompanyLink, Kpi, Segmented, Shimmer } from "../../components";
import { useDocumentTitle } from "../../context";
import { trpc } from "@/providers/trpc";
import { findCompany, useDeskSnapshot } from "../../data";
import { DevNotes } from "../../DevNotes";
import { quarterLabel, useFlowsOverview } from "../../flows/data";
import { fmtCap, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, personName } from "../../format";
import { EvidenceNote, ResearchFrame } from "../../ResearchParts";

const secFiling = (cik: number, accession: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll("-", "")}/`;

export default function Ownership() {
  useDocumentTitle("Ownership");
  const snapshot = useDeskSnapshot();
  // open-market trades of every company in the insider standard (the company pages' own files, read across companies)
  const insiders = trpc.desk.insiderMarket.useQuery(undefined, { staleTime: 30 * 60_000, refetchOnWindowFocus: false });
  const market = insiders.data ?? null;
  // the funds' quarter from the fund books behind Flows (their filed 13F reports, every row of a position counted)
  const flows = useFlowsOverview();
  const quarter = flows.data?.quarters.at(-1) ?? null;
  const data = snapshot.data;

  const [side, setSide] = useState<"sellers" | "buyers">("sellers");
  const purchases = market?.purchases.slice(0, 15) ?? [];
  const windows = market?.windows.slice(0, 12) ?? [];
  const nets = (side === "sellers" ? market?.netSellers : market?.netBuyers) ?? [];
  const shorts = useMemo(() => (data?.companies ?? []).filter((company) => company.shortInterest?.shares).sort((a, b) => (b.shortInterest!.daysToCover ?? 0) - (a.shortInterest!.daysToCover ?? 0)).slice(0, 12), [data]);
  const flowRows = useMemo(() => [...(quarter?.sectors ?? [])].sort((a, b) => b.net - a.net), [quarter]);
  const signed = (value: number) => <span className={`desk-num desk-${value > 0 ? "up" : value < 0 ? "down" : "flat"}`}>{value < 0 ? "−" : "+"}{fmtCap(Math.abs(value)).replace("—", "$0")}</span>;
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
          <p className="desk-lede">Who has been buying and selling the stock itself: officers and directors on Form 4, large funds in their quarterly 13F filings, and the short side.{market ? ` Insider filings to ${fmtDate(market.asOf, "medium")}, ${market.companies} companies.` : ""}</p>
        </div>
      </div>

      <EvidenceNote family="insiders" />

      <div className="desk-kpis four">
        <Kpi label={`Insiders bought, ${market?.days ?? 90} days`} value={market ? fmtCap(market.totals.bought) : "—"} note={market ? `${market.totals.buyers} insiders at ${market.totals.buyingCompanies} companies · open market` : insiders.isError ? "the insider files could not be read" : "loading"} />
        <Kpi label={`Insiders sold, ${market?.days ?? 90} days`} value={market ? fmtCap(market.totals.sold) : "—"} note={market ? `${market.totals.sellers} insiders at ${market.totals.sellingCompanies} companies · ${market.totals.sold > 0 ? Math.round((100 * market.totals.soldUnderPlan) / market.totals.sold) : 0}% under trading plans` : ""} />
        <Kpi label={quarter ? `Funds bought less sold, ${quarterLabel(quarter.quarter)}` : "Funds bought less sold"} value={quarter ? signed(quarter.net) : "—"} note={quarter ? `bought ${fmtCap(quarter.bought)} · sold ${fmtCap(quarter.sold)} · ${quarter.funds} funds` : flows.isError ? "the fund books could not be read" : "loading"} />
        <Kpi label="Most bought sector, net" value={flowRows.length ? flowRows[0].sector : "—"} note={flowRows.length ? <>{signed(flowRows[0].net)} · most sold {flowRows[flowRows.length - 1].sector} {signed(flowRows[flowRows.length - 1].net)}</> : ""} />
      </div>

      <div className="desk-grid">
        <Card className="desk-span-7" flush title="Latest insider purchases" subtitle="Open-market buys (code P) at any company of the list, newest first">
          {insiders.isLoading ? (
            <div style={{ padding: 20 }}><Shimmer height={260} /></div>
          ) : insiders.error ? (
            <div className="desk-empty" style={{ padding: 20 }}>The insider files could not be read: {insiders.error.message}</div>
          ) : purchases.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Traded</th><th>Company</th><th>Insider</th><th className="num">Value</th><th className="num">Shares at price</th><th /></tr>
                </thead>
                <tbody>
                  {purchases.map((row) => (
                    <tr key={`${row.accession}-${row.date}-${row.owner}-${row.valueUsd}`} style={{ cursor: "default" }}>
                      <td className="desk-ink-2">{fmtDate(row.date, "medium")}</td>
                      <td>{companyLink(row.ticker)}</td>
                      <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{personName(row.owner)}{row.more > 0 && <span className="desk-muted"> +{row.more}</span>}<span className="desk-muted"> · {row.role ?? "Insider"}</span></td>
                      <td className="num" style={{ fontWeight: 560 }}>{fmtCap(row.valueUsd)}</td>
                      <td className="num desk-ink-2">{fmtCompact(row.shares)} at {fmtPrice(row.price)}</td>
                      <td><a href={secFiling(row.cik, row.accession)} target="_blank" rel="noreferrer" aria-label="Open the filing at the SEC"><ArrowUpRight size={14} aria-hidden="true" /></a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>{market ? `No open-market purchase in the ${2 * market.days} days to ${fmtDate(market.asOf, "medium")}.` : "The insider view has not been built yet."}</div>
          )}
        </Card>

        <Card className="desk-span-5" flush title="Several insiders buying together" subtitle="Two or more insiders of a company buying within 10 days, last year, newest first">
          {insiders.isLoading ? (
            <div style={{ padding: 20 }}><Shimmer height={260} /></div>
          ) : windows.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Window</th><th>Company</th><th className="num">Insiders</th><th className="num">Bought</th><th>Who</th></tr>
                </thead>
                <tbody>
                  {windows.map((row) => (
                    <tr key={`${row.cik}-${row.start}`} style={{ cursor: "default" }}>
                      <td className="desk-ink-2">{row.start === row.end ? fmtDate(row.end, "medium") : <>{fmtDate(row.start, "short")} – {fmtDate(row.end, "medium")}</>}</td>
                      <td>{companyLink(row.ticker)}</td>
                      <td className="num">{row.insiders}</td>
                      <td className="num">{fmtCap(row.valueUsd)}</td>
                      <td className="desk-ink-2" style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }} title={row.roles.join(", ")}>{row.roles.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>No window with two or more buying insiders in the last year.</div>
          )}
        </Card>

        <Card className="desk-span-12" flush title={side === "sellers" ? "Where insiders sold most" : "Where insiders bought most"} subtitle={market ? `Open-market sales less purchases per company, ${market.days} days to ${fmtDate(market.asOf, "medium")}` : "Open-market sales less purchases per company"} action={<Segmented label="Side" options={[{ value: "sellers", label: "Net sellers" }, { value: "buyers", label: "Net buyers" }]} value={side} onChange={setSide} />}>
          {insiders.isLoading ? (
            <div style={{ padding: 20 }}><Shimmer height={160} /></div>
          ) : nets.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Company</th><th className="num">Sold</th><th className="num">Sellers</th><th className="num">Under trading plans</th><th className="num">Bought</th><th className="num">Buyers</th><th className="num">Bought less sold</th></tr>
                </thead>
                <tbody>
                  {nets.map((row) => (
                    <tr key={row.cik} style={{ cursor: "default" }}>
                      <td>{companyLink(row.ticker)}</td>
                      <td className="num">{row.sold > 0 ? fmtCap(row.sold) : "—"}</td>
                      <td className="num desk-ink-2">{row.sellers || "—"}</td>
                      <td className="num desk-ink-2">{row.sold > 0 ? `${Math.round((100 * row.soldUnderPlan) / row.sold)}%` : "—"}</td>
                      <td className="num">{row.bought > 0 ? fmtCap(row.bought) : "—"}</td>
                      <td className="num desk-ink-2">{row.buyers || "—"}</td>
                      <td className="num">{signed(row.bought - row.sold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>{side === "sellers" ? "No company with more insider sales than purchases in the period." : "No company with more insider purchases than sales in the period."}</div>
          )}
        </Card>

        <Card className="desk-span-7" flush title="Institutions by sector" subtitle={quarter ? `${quarterLabel(quarter.quarter)} against ${quarterLabel(quarter.previous)}: what ${quarter.funds} funds bought and sold, from their 13F reports` : "What the funds bought and sold in the latest quarter, from their 13F reports"} action={<Link className="desk-link desk-nowrap" to="/desk/flows?view=reading" style={{ fontSize: 12.5 }}>Every quarter, fund and company <ArrowUpRight size={13} aria-hidden="true" /></Link>}>
          {flows.isPending ? (
            <div style={{ padding: 20, display: "grid", gap: 8 }}><Shimmer height={18} /><Shimmer height={18} width="70%" /><span className="desk-muted" style={{ fontSize: 12 }}>Reading the fund books…</span></div>
          ) : flows.isError ? (
            <div className="desk-empty" style={{ padding: 20 }}>The fund books could not be read right now.</div>
          ) : flowRows.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Sector</th><th className="num">Held</th><th className="num">Bought</th><th className="num">Sold</th><th className="num">Bought less sold</th></tr>
                </thead>
                <tbody>
                  {flowRows.map((row) => (
                    <tr key={row.sector} style={{ cursor: "default" }}>
                      <td style={{ fontWeight: 560 }}>{row.sector}</td>
                      <td className="num">{fmtCap(row.held)}</td>
                      <td className="num desk-ink-2">{fmtCap(row.bought)}</td>
                      <td className="num desk-ink-2">{fmtCap(row.sold)}</td>
                      <td className="num">{signed(row.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty" style={{ padding: 20 }}>The fund books hold no quarter yet.</div>
          )}
        </Card>

        <Card className="desk-span-5" flush title="Short interest" subtitle="Research companies, most days to cover first">
          {shorts.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr><th>Company</th><th className="num">Shares short</th><th className="num" title="Shares short over the share count known at that date, all share classes; not the float">Of shares</th><th className="num">Days to cover</th><th>As of</th></tr>
                </thead>
                <tbody>
                  {shorts.map((company) => (
                    <tr key={company.cik} style={{ cursor: "default" }}>
                      <td><CompanyLink company={company} className="desk-ticker">{company.ticker}</CompanyLink></td>
                      <td className="num">{fmtCompact(company.shortInterest!.shares)}</td>
                      <td className="num">{company.shortInterest!.pctShares != null ? fmtPct(company.shortInterest!.pctShares, 1, false) : "—"}</td>
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
