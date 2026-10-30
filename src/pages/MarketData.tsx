import { useMemo, useState } from "react";
import { Activity, DatabaseZap, FileCheck2, Filter, RadioTower } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { schwabMarketSnapshot } from "@/data/schwab-market-data";
import type { SchwabMarketSnapshot } from "../../worker/lib/schwab-normalize";

const snapshot = schwabMarketSnapshot as unknown as SchwabMarketSnapshot;
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const price = (value: number | null) => value === null ? "—" : value.toFixed(2).replace(/\.00$/, "");
const iv = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const bucket = (dte: number) => dte === 0 ? "0DTE" : dte <= 7 ? "1-7D" : dte <= 30 ? "8-30D" : dte <= 90 ? "31-90D" : dte <= 365 ? "91-365D" : "365+D";

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="t-panel market-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

export default function MarketData() {
  const [tab, setTab] = useState<"overview" | "options" | "provenance">("overview");
  const [ticker, setTicker] = useState("all");
  const [expiry, setExpiry] = useState("all");
  const [side, setSide] = useState("all");
  const [bucketName, setBucketName] = useState("all");
  const [atmOnly, setAtmOnly] = useState(false);
  const [query, setQuery] = useState("");
  const tickers = useMemo(() => [...new Set(snapshot.options.map((row) => row.underlying))].sort(), []);
  const expirations = useMemo(() => [...new Set(snapshot.options.map((row) => row.expiration))].sort(), []);
  const filtered = useMemo(() => snapshot.options.filter((row) => {
    const atm = Math.abs(row.strike - (row.underlyingPrice ?? row.strike));
    return (ticker === "all" || row.underlying === ticker)
      && (expiry === "all" || row.expiration === expiry)
      && (side === "all" || row.putCall === side.toUpperCase())
      && (bucketName === "all" || bucket(row.dte) === bucketName)
      && (!atmOnly || atm <= Math.max(0.01, (row.underlyingPrice ?? row.strike) * 0.03))
      && (!query || `${row.symbol} ${row.osiId}`.toLowerCase().includes(query.toLowerCase()));
  }), [ticker, expiry, side, bucketName, atmOnly, query]);
  const c = snapshot.coverage;

  return (
    <AppLayout title="Market Data">
      <div className="market-page">
        <section className="market-hero t-panel">
          <div>
            <div className="t-label"><DatabaseZap size={14} /> Schwab Market Data Production · REST snapshots</div>
            <h1>Options, prices and provenance.</h1>
            <p>Reviewed raw captures and normalized contracts. No accounts, orders or direct-to-production sync. This is not a live stream.</p>
          </div>
          <div className="market-hero-status">
            <span className={c.errors ? "market-status-warn" : "market-status-ok"}>{c.errors ? `${c.errors} QA errors` : snapshot.files.length ? "Manifest clean" : "No manifest"}</span>
            <strong>{c.contracts.toLocaleString("en-US")}</strong>
            <span>contracts · {c.expirations} expirations</span>
            <span>{c.latestCapture ? `captured ${c.latestCapture.slice(0, 16).replace("T", " ")} UTC` : "No snapshots yet"}</span>
          </div>
        </section>

        <div className="market-tabs" role="tablist" aria-label="Market data views">
          <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Activity size={14} /> Overview</button>
          <button type="button" role="tab" aria-selected={tab === "options"} className={tab === "options" ? "active" : ""} onClick={() => setTab("options")}><Filter size={14} /> Options</button>
          <button type="button" role="tab" aria-selected={tab === "provenance"} className={tab === "provenance" ? "active" : ""} onClick={() => setTab("provenance")}><FileCheck2 size={14} /> Provenance & QA</button>
        </div>

        {tab === "overview" && (
          <>
            <section className="market-metric-grid">
              <Metric label="Provider" value="Schwab" note="Market Data Production" />
              <Metric label="Coverage" value={`${c.tickersCompleted} / ${c.tickersExpected}`} note="tickers with complete endpoint set" />
              <Metric label="Contracts" value={number.format(c.contracts)} note={`${c.expirations} expirations`} />
              <Metric label="Delayed" value={snapshot.options.length ? snapshot.options.some((row) => row.delayed) ? "Mixed / true" : "False" : "—"} note="Provider flag preserved" />
              <Metric label="Token expiry" value={c.tokenExpiresAt ? c.tokenExpiresAt.slice(0, 10) : "—"} note="Metadata only, no token values" />
              <Metric label="QA errors" value={number.format(snapshot.qa.manifestErrors)} note="Partial or failed manifests" />
            </section>
            <section className="t-panel market-empty">
              <RadioTower size={22} />
              <h2>{snapshot.options.length ? "REST snapshot ready" : "No Schwab snapshots yet"}</h2>
              <p>{snapshot.options.length ? "Open Options to filter by ticker, expiration, side, DTE or ATM. Provenance contains raw hashes and QA status." : "Run the REST collector, then rebuild this static snapshot. No live state is inferred."}</p>
              {!snapshot.options.length && <code>npx tsx worker/schwab-fetch.mts --universe research-universe-51.json<br />npx tsx worker/build-schwab-market-data.mts</code>}
            </section>
          </>
        )}

        {tab === "options" && (
          <>
            <section className="t-panel market-filters">
              <div className="market-search"><Filter size={14} /><input aria-label="Search contracts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Native or OSI contract symbol" /></div>
              <select aria-label="Filter underlying" value={ticker} onChange={(event) => setTicker(event.target.value)}><option value="all">All underlyings</option>{tickers.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="Filter expiration" value={expiry} onChange={(event) => setExpiry(event.target.value)}><option value="all">All expirations</option>{expirations.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="Filter call put" value={side} onChange={(event) => setSide(event.target.value)}><option value="all">Calls + puts</option><option value="call">Calls</option><option value="put">Puts</option></select>
              <select aria-label="Filter DTE bucket" value={bucketName} onChange={(event) => setBucketName(event.target.value)}><option value="all">All DTE</option>{["0DTE", "1-7D", "8-30D", "31-90D", "91-365D", "365+D"].map((value) => <option key={value}>{value}</option>)}</select>
              <label className="market-atm"><input type="checkbox" checked={atmOnly} onChange={(event) => setAtmOnly(event.target.checked)} /> ATM ±3%</label>
              <span className="market-filter-count">{filtered.length} rows{filtered.length > 200 ? " · first 200" : ""}</span>
            </section>
            {filtered.length ? (
              <section className="t-panel market-table-wrap"><table className="market-table"><thead><tr><th>Contract</th><th>Expiry</th><th>DTE</th><th>Strike</th><th>Bid</th><th>Ask</th><th>Spread</th><th>Last</th><th>Volume</th><th>OI</th><th>IV</th><th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th></tr></thead><tbody>{filtered.slice(0, 200).map((row) => (
                <tr key={row.osiId}><td className="market-contract"><strong>{row.osiId}</strong><small>{row.symbol}</small></td><td>{row.expiration}</td><td>{row.dte}</td><td>{price(row.strike)}</td><td>{price(row.bid)}</td><td>{price(row.ask)}</td><td>{price(row.spread)}</td><td>{price(row.last)}</td><td>{row.volume ?? "—"}</td><td>{row.openInterest ?? "—"}</td><td>{iv(row.iv)}</td><td>{row.delta ?? "—"}</td><td>{row.gamma ?? "—"}</td><td>{row.theta ?? "—"}</td><td>{row.vega ?? "—"}</td></tr>
              ))}</tbody></table></section>
            ) : (
              <section className="t-panel market-empty"><Filter size={22} /><h2>No contracts match</h2><p>Change ticker, expiration, side, DTE, ATM or search text.</p></section>
            )}
          </>
        )}

        {tab === "provenance" && (
          <>
            <section className="market-metric-grid">
              <Metric label="Duplicate OSI" value={number.format(snapshot.qa.duplicateOsi)} note="Contract key collisions" />
              <Metric label="Zero bid" value={number.format(snapshot.qa.zeroBid)} note="Explicitly zero quotes" />
              <Metric label="Zero ask" value={number.format(snapshot.qa.zeroAsk)} note="Explicitly zero quotes" />
              <Metric label="Crossed" value={number.format(snapshot.qa.crossed)} note="Ask below bid" />
              <Metric label="Invalid Greeks" value={number.format(snapshot.qa.invalidGreeks)} note="Non-finite values" />
              <Metric label="Invalid IV" value={number.format(snapshot.qa.invalidIv)} note="Outside 0–500%" />
            </section>
            {snapshot.files.length ? (
              <section className="t-panel market-table-wrap"><table className="market-table"><thead><tr><th>Ticker</th><th>Status</th><th>Captured</th><th>Source file</th><th>SHA256</th><th>Error</th></tr></thead><tbody>{snapshot.files.map((file) => (
                <tr key={`${file.ticker}-${file.capturedAt}`}><td>{file.ticker}</td><td>{file.status}</td><td>{file.capturedAt.slice(0, 19).replace("T", " ")}</td><td>{file.file}</td><td className="market-hash" title={file.sourceHash}>{file.sourceHash ? `${file.sourceHash.slice(0, 12)}…` : "—"}</td><td>{file.error ?? "—"}</td></tr>
              ))}</tbody></table></section>
            ) : (
              <section className="t-panel market-empty"><FileCheck2 size={22} /><h2>No provenance records</h2><p>Run the collector to create a manifest with raw file hashes and endpoint status.</p></section>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
