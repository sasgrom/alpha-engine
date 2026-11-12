/**
 * Reading panels of the fund-flow view: the quarter, one fund, one company, and the catalog of players. Every
 * fund and company named in a panel is a link that moves the selection, so the reader can keep following the money.
 */
import { useMemo, useState, type ReactNode } from "react";
import { FUND_NOTES } from "@contracts/fund-notes";
import { FUND_CATEGORY_LABEL, type FlowQuarter, type FundCategory, type FundFlowsOverview } from "@contracts/fund-flows";
import type { ChartPalette } from "../charts/color";
import { Delta, Shimmer } from "../components";
import type { BriefPart } from "../data";
import { fmtCap, fmtPct } from "../format";
import { GrowthChart, SignedBars } from "./charts";
import { moneySince, pctOrDash, quarterLabel, quarterSentence, signedCap, spreadRecord, useFlowsCompany, useFlowsFund } from "./data";

/** A sentence built from the figures; an amount in brackets never breaks across lines. */
export function Sentence({ parts }: { parts: BriefPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part.split(/(\([^)]*\))/).map((piece, inner) => <span key={`${index}-${inner}`} style={piece.startsWith("(") ? { whiteSpace: "nowrap" } : undefined}>{piece}</span>)
        ) : (
          <strong key={index}>{part.strong}</strong>
        ),
      )}
    </>
  );
}

export interface FlowNav {
  fund: (cik: number) => void;
  company: (cik: number) => void;
  sector: (name: string | null) => void;
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 620 }}>{title}{note && <span className="desk-muted" style={{ fontWeight: 400 }}> · {note}</span>}</h3>
      {children}
    </section>
  );
}

function Row({ label, sub, value, onClick }: { label: ReactNode; sub?: ReactNode; value: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="desk-list-main"><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}{sub && <span className="desk-muted" style={{ fontSize: 12 }}> {sub}</span>}</span></span>
      <span className="desk-list-side">{value}</span>
    </>
  );
  return onClick ? <button type="button" className="desk-list-row" style={{ padding: "6px 2px" }} onClick={onClick}>{body}</button> : <div className="desk-list-row" style={{ padding: "6px 2px" }}>{body}</div>;
}

/** Dollars gained or lost. */
const gain = (value: number) => <span className={`desk-num desk-${value > 0 ? "up" : value < 0 ? "down" : "flat"}`}>{signedCap(value)}</span>;

/** Dollars that moved: the sign and a blue (bought) or red (sold) mark; the figure itself stays in text ink. */
const money = (value: number) => (
  <span className="desk-num" style={{ whiteSpace: "nowrap" }}>
    <span className="desk-flow-dot" data-way={value > 0 ? "in" : value < 0 ? "out" : "flat"} aria-hidden="true" />
    {signedCap(value)}
  </span>
);

// ---------------------------------------------------------------------------
export function QuarterPanel({ overview, row, focus, nav, deflator = 1 }: { overview: FundFlowsOverview; row: FlowQuarter; focus: string | null; nav: FlowNav; deflator?: number }) {
  const fundName = useMemo(() => new Map(overview.funds.map((fund) => [fund.cik, fund.name])), [overview]);
  const company = useMemo(() => new Map(overview.companies.map((entry) => [entry.cik, entry])), [overview]);
  const since = moneySince(row, deflator);
  const real = deflator !== 1;
  const next = spreadRecord(overview.quarters, (quarter) => quarter.next1.spread);
  const followed = spreadRecord(overview.quarters, (quarter) => quarter.followed.spread);
  const inSector = (cik: number) => !focus || company.get(cik)?.sector === focus;
  const bought = focus ? row.companyFlows.filter(([cik, net]) => net > 0 && inSector(cik)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cik, net]) => ({ cik, net })) : row.topBought.slice(0, 8);
  const sold = focus ? row.companyFlows.filter(([cik, net]) => net < 0 && inSector(cik)).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([cik, net]) => ({ cik, net })) : row.topSold.slice(0, 8);
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>
        <Sentence parts={quarterSentence(row)} />
      </p>

      <Section title="What happened to that money" note={real ? "total return, after inflation where marked" : "total return, dividends included"}>
        <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
          <div className="desk-stat"><span>Next quarter: bought / sold</span><strong>{pctOrDash(row.next1.bought)} / {pctOrDash(row.next1.sold)}</strong></div>
          <div className="desk-stat"><span>Started when the filings were public</span><strong>{pctOrDash(row.followed.bought)} / {pctOrDash(row.followed.sold)}</strong></div>
          <div className="desk-stat"><span>Since then, on the {fmtCap(row.bought)} bought{real ? ", after inflation" : ""}</span><strong>{since.bought === null ? "—" : <>{gain(since.bought)} <small className="desk-muted">{pctOrDash(since.boughtReturn, 0)}</small></>}</strong></div>
          <div className="desk-stat"><span>Since then, on the {fmtCap(row.sold)} sold, had it stayed{real ? ", after inflation" : ""}</span><strong>{since.sold === null ? "—" : <>{gain(since.sold)} <small className="desk-muted">{pctOrDash(since.soldReturn, 0)}</small></>}</strong></div>
        </div>
        <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>
          Over all quarters, what the funds bought beat what they sold in {next.positive} of {next.measured} following quarters (average {pctOrDash(next.mean, 2)} points); started only once the filings were public, {followed.positive} of {followed.measured} ({pctOrDash(followed.mean, 2)}). A description of {next.measured} quarters, not a test.
        </p>
      </Section>

      <Section title="By sector" note="select one to light its ribbons">
        <div>
          {row.sectors.filter((sector) => sector.sector !== "Other").map((sector) => (
            <Row key={sector.sector} onClick={() => nav.sector(focus === sector.sector ? null : sector.sector)}
              label={<span style={{ fontWeight: focus === sector.sector ? 650 : 400 }}>{sector.sector}</span>}
              sub={`bought ${fmtCap(sector.bought)} · sold ${fmtCap(sector.sold)}`} value={money(sector.net)} />
          ))}
        </div>
      </Section>

      <Section title={focus ? `Most bought in ${focus}` : "Most bought"}>
        <div>{bought.map((entry) => <Row key={entry.cik} onClick={() => nav.company(entry.cik)} label={<span className="desk-ticker">{company.get(entry.cik)?.ticker ?? entry.cik}</span>} sub={company.get(entry.cik)?.name} value={money(entry.net)} />)}</div>
      </Section>
      <Section title={focus ? `Most sold in ${focus}` : "Most sold"}>
        <div>{sold.map((entry) => <Row key={entry.cik} onClick={() => nav.company(entry.cik)} label={<span className="desk-ticker">{company.get(entry.cik)?.ticker ?? entry.cik}</span>} sub={company.get(entry.cik)?.name} value={money(entry.net)} />)}</div>
      </Section>
      {!focus && (
        <>
          <Section title="Biggest buyers">
            <div>{row.topBuyers.slice(0, 6).map((fund) => <Row key={fund.cik} onClick={() => nav.fund(fund.cik)} label={fundName.get(fund.cik) ?? `CIK ${fund.cik}`} value={money(fund.net)} />)}</div>
          </Section>
          <Section title="Biggest sellers">
            <div>{row.topSellers.slice(0, 6).map((fund) => <Row key={fund.cik} onClick={() => nav.fund(fund.cik)} label={fundName.get(fund.cik) ?? `CIK ${fund.cik}`} value={money(fund.net)} />)}</div>
          </Section>
        </>
      )}
      <details className="desk-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
        <summary style={{ cursor: "pointer" }}>What is counted in this quarter, and what is left out</summary>
        <p style={{ margin: "8px 0 0" }}>
          Counted: {row.funds} funds that reported both {quarterLabel(row.previous)} and {quarterLabel(row.quarter)}. A flow is the change in a fund's share count, valued at the quarter-end price; a position is the sum of all rows its report states for the stock.
        </p>
        {row.reportingChanges.length > 0 && (
          <p style={{ margin: "8px 0 0" }}>
            Left out as reporting changes ({row.reportingChanges.length}): {row.reportingChanges.join("; ")}. Most of their positions moved the same way at once, as when a manager moves holdings between the entities that file or takes over another firm's accounts. That is not trading.
          </p>
        )}
        {row.listed.length > 0 && (
          <p style={{ margin: "8px 0 0" }}>Left out as new in the books: {row.listed.join(", ")}. Most holders appear at once (a listing or a spin-off), so nobody bought them in the market this quarter; they count from the next.</p>
        )}
        {row.splits.length > 0 && <p style={{ margin: "8px 0 0" }}>Share counts put on one basis: {row.splits.join(", ")}.</p>}
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function FundPanel({ cik, quarter, latest, nav, palette }: { cik: number; quarter: string; latest: string; nav: FlowNav; palette: ChartPalette }) {
  const fund = useFlowsFund(cik);
  const [real, setReal] = useState(false);
  if (fund.isLoading) return <Shimmer height={360} />;
  if (fund.error) return <div className="desk-empty">{fund.error.message}</div>;
  const data = fund.data;
  if (!data) return <div className="desk-empty">No record for this fund in the flow files.</div>;
  const note = FUND_NOTES[cik]?.note;
  const moves = data.moves.find((entry) => entry.quarter === quarter) ?? null;
  const last = data.series.at(-1);
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <div className="desk-muted" style={{ fontSize: 12.5 }}>{FUND_CATEGORY_LABEL[data.category]}</div>
        <h2 style={{ margin: "2px 0 8px", fontSize: 21, fontWeight: 650, letterSpacing: "-0.01em" }}>{data.name}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{data.tags.map((tag) => <span key={tag} className="desk-badge accent">{tag}</span>)}</div>
        {data.latestQuarter !== latest && (
          <p className="desk-muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
            Its last report here is for {quarterLabel(data.latestQuarter)}. A manager that stops reporting under one name usually goes on under another (a new parent, or several entities instead of one).
          </p>
        )}
      </div>
      {note && (
        <Section title="Background" note="general knowledge, not from the filings">
          <p className="desk-ink-2" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>{note}</p>
        </Section>
      )}
      <Section title="From its own filings">
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13.5, lineHeight: 1.5 }} className="desk-ink-2">
          {data.story.map((sentence) => <li key={sentence}>{sentence}</li>)}
        </ul>
        {data.options && (
          <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>
            Options in its latest report, by the value of the covered shares they are written on: calls {fmtCap(data.options.calls)}, puts {fmtCap(data.options.puts)}. They are not holdings of shares and are not in the flows.
          </p>
        )}
      </Section>
      <Section title="One dollar in its reported books" note={
        <label className="desk-check" style={{ display: "inline-flex", fontSize: 12 }}><input type="checkbox" checked={real} onChange={(event) => setReal(event.target.checked)} /> after inflation</label>
      }>
        <GrowthChart series={data.series} real={real} palette={palette} />
        <div className="desk-legend">
          <span><span className="desk-swatch" style={{ background: palette.accent, height: 3 }} />{data.name}{last?.growth ? ` $${last.growth.toFixed(2)}` : ""}</span>
          <span><span className="desk-swatch" style={{ background: palette.muted, height: 3 }} />All tracked funds{last?.growthAllFunds ? ` $${last.growthAllFunds.toFixed(2)}` : ""}</span>
        </div>
        <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>Each quarter-end book held for one quarter, covered stocks only; trading inside a quarter is not seen.</p>
      </Section>
      <Section title="Did its trading help?" note="bought minus sold, over the following year">
        <SignedBars items={data.series.map((point) => ({ quarter: point.quarter, value: point.next4.spread }))} format={(value) => `${fmtPct(value, 1)} points`} palette={palette} label="Return of what the fund bought minus what it sold, over the following four quarters, by quarter" />
      </Section>
      {!moves && <p className="desk-muted" style={{ margin: 0, fontSize: 12.5 }}>No counted trades in {quarterLabel(quarter)}: the fund did not report both this quarter and the one before, or its report changed.</p>}
      {moves && (
        <Section title={`Trades of ${quarterLabel(moves.quarter)}`} note="and what the stock has done since">
          <div>
            {[...moves.buys, ...moves.sells].map((move) => (
              <Row key={`${move.cik}-${move.kind}`} onClick={() => nav.company(move.cik)}
                label={<span className="desk-ticker">{move.ticker}</span>}
                sub={`${move.kind === "new" ? "new position" : move.kind === "exit" ? "sold out" : move.kind === "add" ? "added" : "trimmed"}${move.since === null ? "" : ` · stock ${fmtPct(move.since, 0)} since`}`}
                value={<>{money(move.usd)}{move.since !== null && <span className="desk-muted" style={{ fontSize: 12 }}> → {signedCap(move.usd * move.since)}</span>}</>} />
            ))}
          </div>
          <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>After the arrow: the gain or loss since on the dollars bought, or what the dollars sold would have made (a negative figure after a sale means the stock rose after it was sold).</p>
        </Section>
      )}
      <Section title="Largest positions" note={quarterLabel(data.latestQuarter)}>
        <div>
          {data.topPositions.slice(0, 12).map((position) => (
            <Row key={position.cik} onClick={() => nav.company(position.cik)} label={<span className="desk-ticker">{position.ticker}</span>}
              sub={`${position.name} · since ${quarterLabel(position.heldSince)}`}
              value={<><span className="desk-num">{fmtPct(position.weight, 1, false)}</span>{position.flow !== 0 && <span style={{ fontSize: 12 }}>{money(position.flow)}</span>}</>} />
          ))}
        </div>
      </Section>
      {data.alike.length > 0 && (
        <Section title="Books most like this one" note="overlap of positions">
          <div>{data.alike.map((other) => <Row key={other.cik} onClick={() => nav.fund(other.cik)} label={other.name} value={<span className="desk-num desk-ink-2">{fmtPct(other.overlap, 0, false)}</span>} />)}</div>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function CompanyPanel({ cik, quarter, nav, palette }: { cik: number; quarter: string; nav: FlowNav; palette: ChartPalette }) {
  const company = useFlowsCompany(cik);
  if (company.isLoading) return <Shimmer height={360} />;
  if (company.error) return <div className="desk-empty">{company.error.message}</div>;
  const data = company.data;
  if (!data) return <div className="desk-empty">No flow record for this company.</div>;
  const at = data.series.find((point) => point.quarter === quarter) ?? data.series.at(-1)!;
  const trades = data.quarters.find((entry) => entry.quarter === at.quarter);
  const after = (pick: (net: number) => boolean) => {
    const values = data.series.filter((point) => pick(point.net) && point.next1 !== null).map((point) => point.next1!);
    return values.length ? { mean: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length } : null;
  };
  const afterBuying = after((net) => net > 0);
  const afterSelling = after((net) => net < 0);
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <div className="desk-muted" style={{ fontSize: 12.5 }}>{data.sector}</div>
        <h2 style={{ margin: "2px 0 0", fontSize: 21, fontWeight: 650, letterSpacing: "-0.01em" }}>{data.name} <span className="desk-muted" style={{ fontWeight: 500, fontSize: 15 }}>{data.ticker}</span></h2>
      </div>
      <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
        <div className="desk-stat"><span>Net flow, {quarterLabel(at.quarter)}</span><strong>{money(at.net)}</strong></div>
        <div className="desk-stat"><span>Funds buying / selling</span><strong>{at.buyers} / {at.sellers}</strong></div>
        <div className="desk-stat"><span>New positions / sold out</span><strong>{at.opened} / {at.closed}</strong></div>
        <div className="desk-stat"><span>Held by the tracked funds</span><strong>{fmtCap(at.held)} · {at.holders} funds</strong></div>
      </div>
      <Section title="Net buying and selling, by quarter">
        <SignedBars items={data.series.map((point) => ({ quarter: point.quarter, value: point.net }))} format={(value) => signedCap(value)} palette={palette} label={`Net flow of the tracked funds in ${data.ticker}, by quarter`} />
        {(afterBuying || afterSelling) && (
          <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>
            In the quarter after net buying the stock returned {afterBuying ? `${fmtPct(afterBuying.mean, 1)} on average (${afterBuying.count} quarters)` : "—"}; after net selling {afterSelling ? `${fmtPct(afterSelling.mean, 1)} (${afterSelling.count})` : "—"}. One company's history, not a test.
          </p>
        )}
      </Section>
      {trades && (trades.buyers.length > 0 || trades.sellers.length > 0) && (
        <>
          <Section title={`Who bought, ${quarterLabel(trades.quarter)}`}>
            <div>{trades.buyers.map((fund) => <Row key={fund.cik} onClick={() => nav.fund(fund.cik)} label={fund.name} sub={fund.kind === "new" ? "new position" : undefined} value={money(fund.usd)} />)}</div>
          </Section>
          <Section title={`Who sold, ${quarterLabel(trades.quarter)}`}>
            <div>{trades.sellers.map((fund) => <Row key={fund.cik} onClick={() => nav.fund(fund.cik)} label={fund.name} sub={fund.kind === "exit" ? "sold out" : undefined} value={money(fund.usd)} />)}</div>
          </Section>
        </>
      )}
      <Section title="Largest holders" note="share of the fund's covered book">
        <div>{data.holders.slice(0, 10).map((fund) => <Row key={fund.cik} onClick={() => nav.fund(fund.cik)} label={fund.name} sub={fund.weight === undefined ? undefined : `${fmtPct(fund.weight, 1, false)} of its book`} value={<span className="desk-num">{fmtCap(fund.usd)}</span>} />)}</div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
const CATEGORIES: (FundCategory | "all")[] = ["all", "index", "manager", "hedge", "quant", "pension", "bank"];

export function CatalogPanel({ overview, nav }: { overview: FundFlowsOverview; nav: FlowNav }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FundCategory | "all">("all");
  const q = query.trim().toUpperCase();
  const funds = overview.funds.filter((fund) => (category === "all" || fund.category === category) && (!q || fund.name.toUpperCase().includes(q))).slice(0, 60);
  const companies = q ? overview.companies.filter((company) => company.ticker.startsWith(q) || company.name.toUpperCase().includes(q)).slice(0, 6) : [];
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <input className="desk-input" type="search" placeholder="Find a fund or a company" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a fund or a company" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {CATEGORIES.map((entry) => (
          <button key={entry} type="button" className="desk-badge" aria-pressed={category === entry} onClick={() => setCategory(entry)} style={{ cursor: "pointer", borderColor: category === entry ? "var(--d-accent)" : undefined, background: category === entry ? "var(--d-accent-wash)" : undefined }}>
            {entry === "all" ? "All" : FUND_CATEGORY_LABEL[entry]}
          </button>
        ))}
      </div>
      {companies.length > 0 && (
        <Section title="Companies">
          <div>{companies.map((company) => <Row key={company.cik} onClick={() => nav.company(company.cik)} label={<span className="desk-ticker">{company.ticker}</span>} sub={company.name} value={money(company.net)} />)}</div>
        </Section>
      )}
      <Section title="Funds" note={`${funds.length}${funds.length === 60 ? "+" : ""} shown, largest first`}>
        <div>
          {funds.map((fund) => (
            <Row key={fund.cik} onClick={() => nav.fund(fund.cik)} label={fund.name}
              sub={[fmtCap(fund.tracked), ...(fund.latestQuarter === overview.latestQuarter ? fund.tags.slice(0, 2) : [`last report ${quarterLabel(fund.latestQuarter)}`])].join(" · ")}
              value={fund.growth !== null && fund.growthAllFunds !== null ? <Delta value={fund.growth / fund.growthAllFunds - 1} digits={0} /> : <span className="desk-muted">—</span>} />
          ))}
        </div>
        <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>The figure on the right: growth of a dollar in the fund's reported books against all tracked funds over the same quarters.</p>
      </Section>
    </div>
  );
}
