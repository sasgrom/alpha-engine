/**
 * The viewer's watchlist, managed in place: follow an index company from the search box, unfollow from the row.
 * Membership is the per-user universe of the classic view (the same rows), so both views always agree.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Plus, X } from "lucide-react";
import { Sparkline } from "../charts/Sparkline";
import { IntradaySpark } from "../charts/IntradayChart";
import { Card, CompanyLink, Delta, Notice, Shimmer } from "../components";
import { useDocumentTitle } from "../context";
import { searchCompanies, useDeskSnapshot, useWatchlist } from "../data";
import { DevNotes } from "../DevNotes";
import { fmtCap, fmtClock, fmtDate, fmtPrice } from "../format";
import { useDeskIntradayMarket } from "../intraday";
import { INTRADAY_SNAPSHOT_LABEL } from "@contracts/intraday";

export default function Watchlist() {
  useDocumentTitle("Watchlist");
  const snapshot = useDeskSnapshot();
  const watch = useWatchlist();
  const intraday = useDeskIntradayMarket();
  const [query, setQuery] = useState("");
  const data = snapshot.data;
  const byCik = useMemo(() => new Map((data?.companies ?? []).map((company) => [company.cik, company])), [data]);
  const suggestions = useMemo(() => (data ? searchCompanies(data.companies, query, 6).filter((company) => !watch.ciks.has(company.cik)) : []), [data, query, watch.ciks]);

  if (snapshot.isLoading || watch.isLoading) return <Shimmer height={420} />;
  if (snapshot.error) return <Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice>;

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Your workspace</span>
          <h1>Watchlist</h1>
          <p className="desk-lede">The companies you follow. They lead the Today page and feed “Latest filings”.</p>
        </div>
      </div>

      <div className="desk-controls" style={{ alignItems: "flex-start" }}>
        <div style={{ position: "relative", width: 340 }}>
          <input className="desk-input" style={{ width: "100%" }} type="search" placeholder="Follow a company: ticker or name" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Follow a company" />
          {suggestions.length > 0 && (
            <div className="desk-menu" style={{ left: 0, right: "auto", width: "100%" }}>
              {suggestions.map((company) => (
                <button key={company.cik} type="button" disabled={watch.busy} onClick={() => { watch.follow(company); setQuery(""); }}>
                  <Plus size={15} aria-hidden="true" />
                  <span className="desk-ticker" style={{ minWidth: 52 }}>{company.ticker}</span>
                  <span className="desk-ink-2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{company.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="desk-muted" style={{ fontSize: 13, paddingTop: 8 }}>{watch.rows.length} followed</span>
        {watch.error && <span className="desk-down" style={{ fontSize: 13, paddingTop: 8 }}>{watch.error}</span>}
      </div>

      <Card flush>
        {watch.rows.length ? (
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="num">Price</th>
                  <th className="num">1D</th>
                  <th className="num">1W</th>
                  <th className="num">1M</th>
                  <th className="num">YTD</th>
                  <th className="num">Market value</th>
                  <th>Today · 5 min{intraday.data ? ` · ${fmtClock(intraday.data.asOf)}` : ""}</th>
                  <th>3 months</th>
                  <th>Last report</th>
                  <th>Next report</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {watch.rows.map((row) => {
                  const company = byCik.get(row.cik);
                  return (
                    <tr key={row.cik} style={{ cursor: "default" }}>
                      <td>
                        {company ? (
                          <CompanyLink company={company} className="company-cell"><span className="desk-ticker">{company.ticker}</span><span>{company.name}</span></CompanyLink>
                        ) : (
                          <Link to={`/company/${encodeURIComponent(row.ticker)}`} className="company-cell"><span className="desk-ticker">{row.ticker}</span><span>{row.name ?? "outside the index · classic page"}</span></Link>
                        )}
                      </td>
                      <td className="num">{fmtPrice(company?.close ?? null)}</td>
                      <td className="num"><Delta value={company?.returns.d1 ?? null} digits={2} /></td>
                      <td className="num"><Delta value={company?.returns.w1 ?? null} /></td>
                      <td className="num"><Delta value={company?.returns.m1 ?? null} /></td>
                      <td className="num"><Delta value={company?.returns.ytd ?? null} /></td>
                      <td className="num desk-ink-2">{fmtCap(company?.marketCap ?? null)}</td>
                      <td>{company ? <IntradaySpark points={intraday.data?.paths[company.ticker] ?? []} width={96} height={26} label={`${company.ticker} today · 5-minute snapshots`} /> : null}</td>
                      <td>{company ? <Sparkline values={company.spark} width={96} height={26} /> : null}</td>
                      <td className="desk-ink-2">{company?.lastEarnings ? <>{fmtDate(company.lastEarnings, "short")} <Delta value={company.lastEarningsReaction} /></> : "—"}</td>
                      <td className="desk-ink-2">{company?.nextEarnings ? `~${fmtDate(company.nextEarnings, "short")}` : "—"}</td>
                      <td>
                        <button type="button" className="desk-icon-button" disabled={watch.busy} onClick={() => watch.unfollow(row.cik)} aria-label={`Unfollow ${row.ticker}`} title="Unfollow">
                          <X size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="desk-empty" style={{ padding: 24 }}>You follow no company yet. Type a ticker or a name above, or use “Follow” on any company page.</div>
        )}
      </Card>
      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
        Companies outside the index are added in the <Link className="desk-link" to="/universe">classic manager</Link>, because adding one starts a data job.
      </p>
      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
        {INTRADAY_SNAPSHOT_LABEL}. {intraday.data ? `${intraday.data.marketOpen ? "Open session" : `Last session · ${fmtDate(intraday.data.session, "short")}`} · as of ${fmtClock(intraday.data.asOf)}.` : "No 5-minute market session is stored yet."}
      </p>
      <DevNotes page="watchlist" />
    </div>
  );
}
