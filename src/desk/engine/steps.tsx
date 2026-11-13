/**
 * The seven steps of the Engine page, each showing the chosen decision's numbers, with small charts drawn here.
 * Every step also has a worked example of its formula computed from the same numbers (see EnginePage for the notes).
 */
import { useMemo, useState, type ReactNode } from "react";
import type { EngineDecision, EngineFlowCompany, EngineFlowIndex, EngineTrace } from "@contracts/engine-flow";
import { fmtDate } from "../format";
import { cellEvidence, combine, decide, errorRates, expit, factorLabel, FIGURE_FORMULAS, holding, LEVELS, levelOf, logit, percentileOf, scoreOf, shrink, tradeOf, usualRate, type FactorView, type Rule, type Score } from "./model";

// ---- formatting ---------------------------------------------------------------------------------------------------
export const num = (v: number | null | undefined, digits = 3) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits));
export const signedNum = (v: number | null | undefined, digits = 3) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`);
export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(100 * v).toFixed(digits)}%`);
export const signedPct = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(100 * v).toFixed(digits)}%`);
// small quantities (a variance, a family's spread, kept evidence) in significant digits: 0.0008421, not 0.0008
const significant = (v: number, digits: number) => (v === 0 ? "0" : Math.abs(v) >= 1000 ? Math.abs(v).toFixed(0) : Math.abs(v).toPrecision(digits));
export const sigNum = (v: number | null | undefined, digits = 4) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : ""}${significant(v, digits)}`);
export const sigSigned = (v: number | null | undefined, digits = 4) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${significant(v, digits)}`);
/** |z| with just enough digits that its place against the 0.43 and 0.97 edges reads as the engine's level. */
export const zSize = (z: number, level: number) => {
  const size = Math.abs(z);
  for (let digits = 2; digits <= 6; digits++) if (levelOf(Number(size.toFixed(digits))) === level) return size.toFixed(digits);
  return `${level < levelOf(size) ? "just under" : "just over"} ${size.toFixed(2)}`;
};
export const points = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(100 * v).toFixed(digits)} pts`);
const money = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const size = Math.abs(v), sign = v < 0 ? "−" : "";
  return size >= 1e9 ? `${sign}$${(size / 1e9).toFixed(2)}bn` : size >= 1e6 ? `${sign}$${(size / 1e6).toFixed(1)}m` : `${sign}$${size.toLocaleString("en-US")}`;
};

/** A worked example: the formula, the numbers put in, and the result (checked against the engine's own value where it has one). */
export function Example({ children }: { children: ReactNode }) {
  return <div className="eng-example">{children}</div>;
}
function Check({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`eng-check ${ok ? "ok" : "off"}`}>{ok ? "✓" : "≠"} {label}</span>;
}

// ---- step 1: raw fundamentals and prices --------------------------------------------------------------------------
const ITEMS: Record<string, string[]> = {
  Revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "SalesRevenueGoodsNet"],
  "Cost of revenue": ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  "Gross profit": ["GrossProfit"],
  "Operating income": ["OperatingIncomeLoss"],
  "Net income": ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  "R&D": ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  "SG&A": ["SellingGeneralAndAdministrativeExpense"],
  "Operating cash flow": ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  "Capital spending": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  Buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  Dividends: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  Assets: ["Assets"],
  Liabilities: ["Liabilities"],
  Equity: ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity"],
  Inventory: ["InventoryNet"],
  Receivables: ["AccountsReceivableNetCurrent"],
  "Deferred revenue": ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"],
  "Diluted shares": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
};
/** A filed figure's period in short: "3 mo to Mar 30, 2019" for a flow, "at Mar 30, 2019" for a balance. */
export const periodLabel = (start: string | null, end: string) => (start ? `${Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000 / 30.44)} mo to ${fmtDate(end)}` : `at ${fmtDate(end)}`);
const ITEM_OF = new Map(Object.entries(ITEMS).flatMap(([item, concepts]) => concepts.map((concept) => [concept, item] as const)));
const ITEM_ORDER = Object.keys(ITEMS);

/** The filing whose figures a decision reads: its own for a filing decision; for a release, the latest filed before it. */
export function filingOf(company: EngineFlowCompany, decision: EngineDecision): { accession: string; filed: string | null; form: string | null } | null {
  if (decision.kind === "filing") {
    const row = company.facts.rows.find((r) => r[5] === decision.accession);
    return { accession: decision.accession, filed: row?.[4] ?? null, form: row?.[6] ?? decision.form };
  }
  let best: { accession: string; filed: string; form: string } | null = null;
  for (const row of company.facts.rows) if (row[4] < decision.date && (!best || row[4] > best.filed)) best = { accession: row[5], filed: row[4], form: row[6] };
  return best;
}

export function RawStep({ company, decision, decisions }: { company: EngineFlowCompany; decision: EngineDecision; decisions: EngineDecision[] }) {
  const [scope, setScope] = useState<"filing" | "known">("filing");
  const filing = filingOf(company, decision);
  const rows = useMemo(() => {
    const list = company.facts.rows.filter((r) => (scope === "filing" ? filing && r[5] === filing.accession : r[4] <= decision.date));
    return list
      .map((r) => ({ item: ITEM_OF.get(company.facts.concepts[r[0]]) ?? company.facts.concepts[r[0]], concept: company.facts.concepts[r[0]], start: r[1], end: r[2], value: r[3], filed: r[4], accn: r[5], form: r[6] }))
      .sort((a, b) => ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item) || b.end.localeCompare(a.end) || (a.start ?? "").localeCompare(b.start ?? ""))
      .slice(0, scope === "filing" ? 400 : 300);
  }, [company, decision.date, filing, scope]);
  return (
    <div className="eng-grid">
      <div className="eng-facts">
        <dl className="eng-dl">
          <dt>Decision</dt><dd>{decision.kind === "release" ? "after the earnings release" : `after the ${decision.form}`} · close of {fmtDate(decision.date)}</dd>
          <dt>Quarter</dt><dd>ending {fmtDate(decision.periodEnd)}</dd>
          <dt>Published</dt><dd>{decision.published?.replace("T", " ")} ET (first publication){decision.release ? "" : " · no earnings release found"}</dd>
          <dt>{decision.form} filed</dt><dd>{decision.filed?.replace("T", " ")} ET · {decision.accession}</dd>
          <dt>Usual moves</dt><dd>stock {pct(decision.sigma.r, 2)} a day · against its sector {pct(decision.sigma.c, 2)} a day (126 sessions before)</dd>
        </dl>
        <PriceChart company={company} decisions={decisions} selected={decision} />
      </div>
      <div>
        <div className="eng-toolbar">
          <span className="desk-muted">Filed figures</span>
          <button type="button" className="eng-chip" aria-pressed={scope === "filing"} onClick={() => setScope("filing")}>{decision.kind === "filing" ? "in this filing" : "in the latest filing before"}</button>
          <button type="button" className="eng-chip" aria-pressed={scope === "known"} onClick={() => setScope("known")}>everything filed by the decision day</button>
        </div>
        {filing ? <p className="desk-muted eng-small">{filing.form} {filing.accession}{filing.filed ? `, filed ${fmtDate(filing.filed)}` : ""}. {rows.length} values{scope === "known" && rows.length >= 300 ? " (the first 300)" : ""}.</p> : <p className="desk-muted eng-small">No filed figures on record before this decision.</p>}
        <div className="eng-table-wrap tall">
          <table className="eng-table">
            <thead><tr><th>Item and XBRL concept</th><th>Period</th><th className="num">Value</th><th>Filed</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.concept}|${r.start}|${r.end}|${r.accn}|${i}`}>
                  <td>{r.item}<span className="eng-concept">{r.concept}</span></td>
                  <td title={r.start ? `${r.start} to ${r.end}` : `on ${r.end}`}>{periodLabel(r.start, r.end)}</td>
                  <td className="num">{r.concept.includes("Shares") ? `${(r.value / 1e6).toFixed(1)}m sh` : money(r.value)}</td>
                  <td className="eng-mono">{r.filed} {r.form}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Weekly prices of the stock, its sector fund and the market, each from 100 at the start; ticks mark the decisions. */
export function PriceChart({ company, decisions, selected }: { company: EngineFlowCompany; decisions: EngineDecision[]; selected: EngineDecision }) {
  const [around, setAround] = useState(true);
  const { dates } = company.prices;
  const from = around ? shiftYears(selected.date, -2) : dates[0];
  const to = around ? shiftYears(selected.date, 1) : dates[dates.length - 1];
  const a = Math.max(0, dates.findIndex((d) => d >= from)), bRaw = dates.findIndex((d) => d > to), b = bRaw < 0 ? dates.length - 1 : bRaw;
  const W = 520, H = 190, pad = 28;
  const series = [
    { name: company.ticker, values: company.prices.stock, cls: "s1" },
    { name: company.sectorFund ?? "sector fund", values: company.prices.fund, cls: "s2" },
    { name: "SPY", values: company.prices.market, cls: "s3" },
  ].map((s) => {
    if (!s.values) return { ...s, points: [] as [number, number][] };
    let start: number | null = null;
    const points: [number, number][] = [];
    for (let i = a; i <= b; i++) {
      const v = s.values[i];
      if (v === null) continue;
      if (start === null) start = v;
      points.push([i, 100 * Math.exp(v - start)]);
    }
    return { ...s, points };
  });
  const all = series.flatMap((s) => s.points.map((p) => p[1]));
  const low = Math.min(...all, 100), high = Math.max(...all, 100);
  const x = (i: number) => pad + ((i - a) / Math.max(1, b - a)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - low) / Math.max(1e-9, high - low)) * (H - 2 * pad);
  const at = (date: string) => { const i = dates.findIndex((d) => d >= date); return i < 0 ? null : i; };
  return (
    <figure className="eng-figure">
      <div className="eng-toolbar">
        <span className="desk-muted">Prices, from 100</span>
        <button type="button" className="eng-chip" aria-pressed={around} onClick={() => setAround(true)}>around the decision</button>
        <button type="button" className="eng-chip" aria-pressed={!around} onClick={() => setAround(false)}>since 2005</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="eng-svg" role="img" aria-label={`Prices of ${company.ticker}, its sector fund and the market`}>
        <line x1={pad} x2={W - pad} y1={y(100)} y2={y(100)} className="eng-axis" />
        {decisions.filter((d) => d.date >= dates[a] && d.date <= dates[b]).map((d) => {
          const i = at(d.date);
          return i === null ? null : <line key={d.id} x1={x(i)} x2={x(i)} y1={pad} y2={H - pad} className={d.id === selected.id ? "eng-mark on" : "eng-mark"} />;
        })}
        {series.map((s) => (
          <polyline key={s.name} className={`eng-line ${s.cls}`} points={s.points.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
        ))}
        <text x={pad} y={14} className="eng-svg-text">{fmtDate(dates[a])}</text>
        <text x={W - pad} y={14} textAnchor="end" className="eng-svg-text">{fmtDate(dates[b])}</text>
        <text x={4} y={y(high) + 4} className="eng-svg-text">{high.toFixed(0)}</text>
        <text x={4} y={y(low) + 4} className="eng-svg-text">{low.toFixed(0)}</text>
      </svg>
      <figcaption className="eng-legend">
        {series.map((s) => <span key={s.name}><i className={`eng-swatch ${s.cls}`} aria-hidden="true" />{s.name}</span>)}
        <span><i className="eng-swatch mark" aria-hidden="true" />decisions (the chosen one darker)</span>
      </figcaption>
    </figure>
  );
}
const shiftYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

// ---- step 2: readings ---------------------------------------------------------------------------------------------
const PRICE_ROWS: { key: string; meaning: string; raw: (x: number, d: EngineDecision) => string }[] = [
  { key: "reaction", meaning: "the stock against its sector fund on the first session after the first publication", raw: (x, d) => `${signedPct(x * d.sigma.c)} against the sector that session` },
  { key: "drift", meaning: "against the sector from that session to the decision (filing decisions after the release)", raw: (x) => `${signedNum(x, 2)} usual moves` },
  { key: "mom12", meaning: "against the sector over the 12 months ending a month before the publication", raw: (x, d) => `${signedPct(x * d.sigma.c * Math.sqrt(231))} over 231 sessions` },
  { key: "mom6", meaning: "against the sector over the 6 months ending a month before", raw: (x, d) => `${signedPct(x * d.sigma.c * Math.sqrt(105))} over 105 sessions` },
  { key: "runUp", meaning: "against the sector over the 21 sessions before the publication", raw: (x, d) => `${signedPct(x * d.sigma.c * Math.sqrt(21))} over 21 sessions` },
  { key: "volRatio", meaning: "the stock's volatility over the last 21 sessions against the last 126 (log ratio)", raw: (x) => `${Math.exp(x).toFixed(2)} × the usual volatility` },
  { key: "high52", meaning: "distance below the highest close of the last 52 weeks (log)", raw: (x) => `${pct(1 - Math.exp(x))} below the high` },
];

export function ReadingsStep({ decision, figureDecision }: { decision: EngineDecision; figureDecision: EngineDecision | null }) {
  const figures = decision.figures;
  const inputs = decision.inputs;
  const pairs = inputs?.pairs ?? {};
  return (
    <div className="eng-stack">
      <div className="eng-table-wrap">
        <table className="eng-table">
          <caption>Price readings, in usual moves (σc = {pct(decision.sigma.c, 2)} a day)</caption>
          <thead><tr><th>Reading</th><th className="num">Value</th><th>In plain terms</th><th>What it measures</th></tr></thead>
          <tbody>
            {PRICE_ROWS.map((row) => {
              const x = decision.px[row.key];
              return (
                <tr key={row.key}>
                  <td>{factorLabel(row.key)}</td>
                  <td className="num">{signedNum(x, 2)}</td>
                  <td>{x === null || x === undefined ? "—" : row.raw(x, decision)}</td>
                  <td className="desk-muted">{row.meaning}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {figures ? (
        <div className="eng-table-wrap tall">
          <table className="eng-table">
            <caption>
              Filed-figure readings{decision.kind === "release" ? ` (from the ${figureDecision ? `${figureDecision.form} of the quarter ending ${fmtDate(figureDecision.periodEnd)}, filed later; not used at a release decision)` : "latest filing; not used at a release decision"}` : ""}, with what each was computed from
            </caption>
            <thead><tr><th>Reading</th><th>Formula</th><th>Inputs: now / a year ago</th><th className="num">As is</th><th className="num">.trend</th><th className="num">.peer</th></tr></thead>
            <tbody>
              {Object.keys(FIGURE_FORMULAS).map((name) => {
                const f = FIGURE_FORMULAS[name];
                const value = figures[name] ?? null;
                const trend = figures[`${name}.trend`] ?? null, peer = figures[`${name}.peer`] ?? null;
                const tBasis = inputs?.trend?.[name] ?? null, pBasis = inputs?.peer?.[name] ?? null;
                return (
                  <tr key={name}>
                    <td>{factorLabel(name)}</td>
                    <td className="desk-muted">{f.formula}</td>
                    <td className="eng-mono">{f.uses.map((u) => `${u}: ${pairs[u] ? `${money(pairs[u]![0])} / ${money(pairs[u]![1])}` : "—"}`).join(" · ")}</td>
                    <td className="num">{signedNum(value, 4)}</td>
                    <td className="num" title={tBasis ? `(${num(value, 4)} − mean ${num(tBasis[0], 4)}) / sd ${num(tBasis[1], 4)} over ${tBasis[2]} values` : undefined}>{signedNum(trend, 2)}</td>
                    <td className="num" title={pBasis ? `${num(value, 4)} − peers' median ${num(pBasis[0], 4)} (${pBasis[1]} peers)` : undefined}>{signedNum(peer, 4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="desk-muted">No filed-figure readings for this quarter (no figures on record, or the company does not report these items).</p>
      )}
    </div>
  );
}

export function ReadingsExample({ decision }: { decision: EngineDecision }) {
  const pairs = decision.inputs?.pairs ?? null;
  const value = decision.figures?.revenueGrowth ?? null;
  const basis = decision.inputs?.trend?.revenueGrowth ?? null, peer = decision.inputs?.peer?.revenueGrowth ?? null;
  const recomputed = pairs ? FIGURE_FORMULAS.revenueGrowth.compute(pairs) : null;
  // the bases are computed from the exact reading (the stored one is rounded to six decimals, which a tiny spread magnifies)
  const exact = recomputed ?? value;
  const trend = decision.figures?.["revenueGrowth.trend"] ?? null, peerValue = decision.figures?.["revenueGrowth.peer"] ?? null;
  const againstRecord = basis && exact !== null ? (exact - basis[0]) / basis[1] : null;
  const reaction = decision.px.reaction;
  return (
    <Example>
      {reaction !== null && reaction !== undefined && (
        <p>First-session reaction: {signedNum(reaction, 2)} usual moves × σc {pct(decision.sigma.c, 2)} = {signedPct(reaction * decision.sigma.c)} against the sector on that session.</p>
      )}
      {pairs?.revenue ? (
        <>
          <p>Revenue growth = {money(pairs.revenue[0])} / {money(pairs.revenue[1])} − 1 = {signedNum(recomputed, 4)} {value !== null && recomputed !== null && <Check ok={Math.abs(recomputed - value) < 1e-5} label={`the engine's ${signedNum(value, 4)}`} />}</p>
          {basis && exact !== null && againstRecord !== null && (
            <p>
              Against its own record: ({signedNum(exact, 6)} − {signedNum(basis[0], 6)}) / {num(basis[1], 6)} = {signedNum(againstRecord, 4)} (mean of its last 4 values, spread of its last {basis[2]}){" "}
              {trend !== null && <Check ok={Math.abs(againstRecord - trend) < 1e-3} label={`the engine's ${signedNum(trend, 4)}`} />}
            </p>
          )}
          {peer && exact !== null && (
            <p>
              Against peers: {signedNum(exact, 6)} − {signedNum(peer[0], 6)} = {signedNum(exact - peer[0], 6)} (median of {peer[1]} peers that filed within 100 days){" "}
              {peerValue !== null && <Check ok={Math.abs(exact - peer[0] - peerValue) < 1e-5} label={`the engine's ${signedNum(peerValue, 6)}`} />}
            </p>
          )}
        </>
      ) : (
        <p className="desk-muted">This quarter has no revenue pair on file, so the revenue example is not shown.</p>
      )}
    </Example>
  );
}

// ---- step 3: the algorithm ------------------------------------------------------------------------------------------
export function AlgorithmStep({ factors, chosen, onChoose, trace }: { factors: FactorView[]; chosen: string | null; onChoose: (name: string) => void; trace: EngineTrace }) {
  const pick = factors.find((f) => f.name === chosen) ?? factors.find((f) => f.status === 0) ?? factors[0] ?? null;
  return (
    <div className="eng-grid wide-left">
      <div className="eng-table-wrap tall">
        <table className="eng-table clickable">
          <thead><tr><th>Factor</th><th className="num">Reading</th><th className="num">z</th><th className="num">Above</th><th className="num">n</th><th className="num">b (slope)</th><th className="num">Forecast y</th><th>Side</th><th>Strength</th><th>Status</th></tr></thead>
          <tbody>
            {factors.map((f) => {
              const y = f.slope !== null && f.intercept !== null && f.z !== null ? f.intercept + f.slope * f.z : null;
              return (
                <tr key={f.name} className={pick?.name === f.name ? "on" : undefined} onClick={() => onChoose(f.name)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onChoose(f.name); }}>
                  <td title={f.name}>{factorLabel(f.name)}<span className="eng-family">{f.family}</span></td>
                  <td className="num">{signedNum(f.raw, 3)}</td>
                  <td className="num">{signedNum(f.z, 2)}</td>
                  <td className="num">{f.z === null ? "—" : `${pct(percentileOf(f.z), 0)} of ${f.earlier.toLocaleString("en-US")}`}</td>
                  <td className="num">{f.n === null ? "—" : Math.round(f.n).toLocaleString("en-US")}</td>
                  <td className="num">{signedNum(f.slope, 4)}</td>
                  <td className="num">{signedNum(y, 4)}</td>
                  <td>{f.side === null ? "—" : f.side ? "rise" : "fall"}</td>
                  <td>{f.level === null ? "—" : LEVELS[f.level]}</td>
                  <td className={f.status === 0 ? "eng-ok" : "desk-muted"}>{f.why}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        {pick && <RegressionChart factor={pick} />}
        <dl className="eng-dl">
          <dt>Engine (graded)</dt><dd>{pct(trace.p.graded, 2)}</dd>
          <dt>Table variant</dt><dd>{pct(trace.p.table, 2)}</dd>
          <dt>Soft variant</dt><dd>{pct(trace.p.soft, 2)}</dd>
          <dt>Joint logistic model</dt><dd>{pct(trace.p.joint, 2)} (one penalised regression on all readings, as a reference)</dd>
          <dt>Usual rate</dt><dd>{pct(trace.prior, 2)}</dd>
        </dl>
      </div>
    </div>
  );
}

/** The factor's regression line over the range of z, with today's reading marked. */
export function RegressionChart({ factor }: { factor: FactorView }) {
  const W = 360, H = 200, pad = 30;
  const a = factor.intercept ?? 0, b = factor.slope ?? 0;
  const ys = [-3, 3].map((z) => a + b * z);
  const span = Math.max(0.05, ...ys.map(Math.abs)) * 1.15;
  const x = (z: number) => pad + ((z + 3) / 6) * (W - 2 * pad);
  const y = (v: number) => H / 2 - (v / span) * (H / 2 - pad);
  const z = factor.z;
  return (
    <figure className="eng-figure">
      <figcaption className="eng-figtitle">{factorLabel(factor.name)}: y = {signedNum(a, 4)} {b < 0 ? "−" : "+"} {Math.abs(b).toFixed(4)} · z</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="eng-svg" role="img" aria-label="Regression line of the later move on the reading">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="eng-axis" />
        <line x1={x(0)} x2={x(0)} y1={pad / 2} y2={H - pad / 2} className="eng-axis" />
        {factor.slope !== null && <line x1={x(-3)} x2={x(3)} y1={y(ys[0])} y2={y(ys[1])} className="eng-line s1" />}
        {z !== null && factor.slope !== null && <circle cx={x(z)} cy={y(a + b * z)} r={5} className="eng-dot" />}
        {[-0.97, -0.43, 0.43, 0.97].map((edge) => <line key={edge} x1={x(edge)} x2={x(edge)} y1={H - pad} y2={H - pad + 6} className="eng-axis" />)}
        <text x={pad} y={H - 6} className="eng-svg-text">z = −3</text>
        <text x={W - pad} y={H - 6} textAnchor="end" className="eng-svg-text">+3</text>
        <text x={4} y={y(span * 0.9) + 4} className="eng-svg-text">{`+${(span * 0.9).toFixed(3)}`}</text>
        <text x={4} y={y(-span * 0.9) + 4} className="eng-svg-text">{`−${(span * 0.9).toFixed(3)}`}</text>
      </svg>
      <p className="desk-muted eng-small">y: the move against the sector over the horizon, in usual moves. Ticks at |z| = 0.43 and 0.97 mark weak, medium and strong. {factor.n ? `Fitted on ${Math.round(factor.n).toLocaleString("en-US")} finished outcomes.` : ""}</p>
    </figure>
  );
}

export function AlgorithmExample({ factor }: { factor: FactorView | null }) {
  if (!factor || factor.z === null || factor.slope === null || factor.intercept === null) return <Example><p className="desk-muted">Choose a factor with a regression to see its example.</p></Example>;
  const y = factor.intercept + factor.slope * factor.z;
  return (
    <Example>
      <p>{factorLabel(factor.name)}: reading {signedNum(factor.raw, 4)} sits above {pct(percentileOf(factor.z), 1)} of the {factor.earlier.toLocaleString("en-US")} earlier readings, so z = Φ⁻¹({num(percentileOf(factor.z), 3)}) = {signedNum(factor.z, 2)}.</p>
      <p>Regression on {Math.round(factor.n ?? 0).toLocaleString("en-US")} finished outcomes: y = {signedNum(factor.intercept, 4)} + ({signedNum(factor.slope, 4)}) × {signedNum(factor.z, 2)} = {signedNum(y, 4)} usual moves.</p>
      <p>b × z = {signedNum(factor.slope * factor.z, 4)} {factor.slope * factor.z > 0 ? "> 0, so the forecast is rise" : "< 0, so the forecast is fall"}; |z| = {zSize(factor.z, factor.level ?? levelOf(factor.z))} is {LEVELS[factor.level ?? 0]}.</p>
    </Example>
  );
}

// ---- step 4: track record ---------------------------------------------------------------------------------------------
export function ErrorsStep({ factors, chosen, onChoose }: { factors: FactorView[]; chosen: string | null; onChoose: (name: string) => void }) {
  const withTable = factors.filter((f) => f.table);
  const pick = withTable.find((f) => f.name === chosen) ?? withTable.find((f) => f.status === 0) ?? withTable[0] ?? null;
  return (
    <div className="eng-grid">
      <div>
        {pick && pick.table ? <CellTable factor={pick} /> : <p className="desk-muted">No factor has a track record at this decision.</p>}
      </div>
      <div className="eng-table-wrap tall">
        <table className="eng-table clickable">
          <thead><tr><th>Factor</th><th>Today</th><th className="num">e+</th><th className="num">e−</th><th className="num">Forecasts</th><th className="num">Evidence</th></tr></thead>
          <tbody>
            {withTable.map((f) => {
              const rates = errorRates(f.table!);
              return (
                <tr key={f.name} className={pick?.name === f.name ? "on" : undefined} onClick={() => onChoose(f.name)}>
                  <td>{factorLabel(f.name)}</td>
                  <td>{f.side === null ? "—" : `${f.side ? "rise" : "fall"}, ${LEVELS[f.level ?? 0]}`}</td>
                  <td className="num">{pct(rates.ePlus, 1)}</td>
                  <td className="num">{pct(rates.eMinus, 1)}</td>
                  <td className="num">{(rates.rises + rates.falls).toLocaleString("en-US")}</td>
                  <td className="num">{f.status === 0 ? signedNum(f.evidence, 4) : <span className="desk-muted">{f.why}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellTable({ factor }: { factor: FactorView }) {
  const table = factor.table!;
  const rates = errorRates(table);
  const today = factor.side !== null && factor.level !== null ? factor.side * 3 + factor.level : -1;
  return (
    <div>
      <p className="eng-figtitle">{factorLabel(factor.name)}: its earlier forecasts and what followed (falls / rises)</p>
      <div className="eng-table-wrap">
        <table className="eng-table cells">
          <thead><tr><th>It said</th>{LEVELS.map((l) => <th key={l} className="num">{l}</th>)}<th className="num">all</th></tr></thead>
          <tbody>
            {[0, 1].map((side) => (
              <tr key={side}>
                <th>{side ? "rise" : "fall"}</th>
                {[0, 1, 2].map((level) => {
                  const [falls, rises] = table[side * 3 + level];
                  return <td key={level} className={`num${side * 3 + level === today ? " today" : ""}`}>{Math.round(falls).toLocaleString("en-US")} / {Math.round(rises).toLocaleString("en-US")}</td>;
                })}
                <td className="num">{Math.round(table.slice(side * 3, side * 3 + 3).reduce((s, c) => s + c[0], 0)).toLocaleString("en-US")} / {Math.round(table.slice(side * 3, side * 3 + 3).reduce((s, c) => s + c[1], 0)).toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="eng-dl">
        <dt>e+ (said rise, then fell)</dt><dd>{pct(rates.ePlus, 1)} of {Math.round(rates.falls).toLocaleString("en-US")} falls</dd>
        <dt>e− (said fall, then rose)</dt><dd>{pct(rates.eMinus, 1)} of {Math.round(rates.rises).toLocaleString("en-US")} rises</dd>
        <dt>When it said rise</dt><dd>it rose {pct(rates.hitRise, 1)} of {Math.round(rates.saidRise).toLocaleString("en-US")} times</dd>
        <dt>When it said fall</dt><dd>it fell {pct(rates.hitFall, 1)} of {Math.round(rates.saidFall).toLocaleString("en-US")} times</dd>
      </dl>
    </div>
  );
}

export function ErrorsExample({ factor }: { factor: FactorView | null }) {
  if (!factor || !factor.table || factor.side === null || factor.level === null) return <Example><p className="desk-muted">Choose a factor with a forecast and a track record.</p></Example>;
  const cell = factor.side * 3 + factor.level;
  const c = cellEvidence(factor.table, cell);
  const rates = errorRates(factor.table);
  return (
    <Example>
      <p>e+ = {Math.round(rates.falls * (rates.ePlus ?? 0)).toLocaleString("en-US")} / {Math.round(rates.falls).toLocaleString("en-US")} = {pct(rates.ePlus, 1)};  e− = {Math.round(rates.rises * (rates.eMinus ?? 0)).toLocaleString("en-US")} / {Math.round(rates.rises).toLocaleString("en-US")} = {pct(rates.eMinus, 1)}.</p>
      <p>Today's cell ({factor.side ? "rise" : "fall"}, {LEVELS[factor.level]}): a = {Math.round(c.a)} rises, b = {Math.round(c.b)} falls; U = {Math.round(c.up)}, D = {Math.round(c.down)}.</p>
      <p>e = ln( ({Math.round(c.a)} + ½) / ({Math.round(c.up)} + 3) ÷ ({Math.round(c.b)} + ½) / ({Math.round(c.down)} + 3) ) = {sigSigned(c.e)}, variance v = {sigNum(c.v)} {factor.evidence !== null && <Check ok={Math.abs(c.e - factor.evidence) < 2e-3} label={`the engine's ${sigSigned(factor.evidence)}`} />}</p>
      <p>As a likelihood ratio: this forecast came {num(Math.exp(c.e), 3)} times as often before a rise as before a fall.</p>
    </Example>
  );
}

// ---- step 5: probabilities ---------------------------------------------------------------------------------------------
export function ProbabilityStep({ factors, trace }: { factors: FactorView[]; trace: EngineTrace }) {
  const voting = factors.filter((f) => f.status === 0);
  const combined = combine(trace.prior, voting);
  const parts = voting.map((f, i) => ({ f, term: combined.terms[i] ?? 0 })).sort((a, b) => Math.abs(b.term) - Math.abs(a.term));
  return (
    <div className="eng-grid wide-left">
      <div className="eng-table-wrap tall">
        <table className="eng-table">
          <thead><tr><th>Factor (voting)</th><th className="num">Evidence e</th><th className="num">v</th><th className="num">Family S</th><th className="num">Kept</th><th className="num">k</th><th className="num">Kept / k</th></tr></thead>
          <tbody>
            {parts.map(({ f, term }) => (
              <tr key={f.name}>
                <td>{factorLabel(f.name)}<span className="eng-family">{f.family}</span></td>
                <td className="num">{sigSigned(f.evidence)}</td>
                <td className="num">{sigNum(f.variance)}</td>
                <td className="num">{sigNum(f.spread)}</td>
                <td className="num">{sigSigned(f.kept)}</td>
                <td className="num">{num(f.k, 3)}</td>
                <td className="num">{sigSigned(term)}</td>
              </tr>
            ))}
            {!parts.length && <tr><td colSpan={7} className="desk-muted">No factor votes at this decision: the probability is the usual rate.</td></tr>}
          </tbody>
        </table>
      </div>
      <Waterfall prior={trace.prior} parts={parts.map((p) => ({ name: factorLabel(p.f.name), value: p.term }))} final={trace.p.graded} />
    </div>
  );
}

/** Log-odds from the usual rate, factor by factor, to the engine's probability. */
function Waterfall({ prior, parts, final }: { prior: number; parts: { name: string; value: number }[]; final: number }) {
  const shown = parts.slice(0, 12);
  const rest = parts.slice(12).reduce((a, p) => a + p.value, 0);
  const bars = [...shown, ...(parts.length > 12 ? [{ name: `${parts.length - 12} more`, value: rest }] : [])];
  let run = logit(prior);
  const steps = bars.map((bar) => { const from = run; run += bar.value; return { ...bar, from, to: run }; });
  const ends = [logit(prior), run, ...steps.flatMap((s) => [s.from, s.to])];
  const low = Math.min(...ends), high = Math.max(...ends), span = Math.max(0.02, high - low);
  const W = 360, row = 20, H = (steps.length + 2) * row + 20, left = 130;
  const x = (v: number) => left + ((v - low) / span) * (W - left - 20);
  return (
    <figure className="eng-figure">
      <figcaption className="eng-figtitle">From the usual rate {pct(prior, 2)} to {pct(final, 2)}, in log-odds</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="eng-svg" role="img" aria-label="Waterfall of the factors' evidence in log-odds">
        <text x={4} y={row} className="eng-svg-text">usual rate</text>
        <line x1={x(logit(prior))} x2={x(logit(prior))} y1={row - 12} y2={H - 10} className="eng-axis" />
        {steps.map((s, i) => (
          <g key={s.name}>
            <text x={4} y={(i + 2) * row} className="eng-svg-text">{s.name.length > 22 ? `${s.name.slice(0, 21)}…` : s.name}</text>
            <rect x={Math.min(x(s.from), x(s.to))} y={(i + 2) * row - 11} width={Math.max(1, Math.abs(x(s.to) - x(s.from)))} height={12} className={s.value >= 0 ? "eng-bar up" : "eng-bar down"} />
          </g>
        ))}
        <text x={4} y={(steps.length + 2) * row} className="eng-svg-text">engine</text>
        <circle cx={x(run)} cy={(steps.length + 2) * row - 5} r={5} className="eng-dot" />
      </svg>
    </figure>
  );
}

export function ProbabilityExample({ factors, trace }: { factors: FactorView[]; trace: EngineTrace }) {
  const voting = factors.filter((f) => f.status === 0);
  const combined = combine(trace.prior, voting);
  const strongest = [...voting].sort((a, b) => Math.abs((b.kept ?? 0) / (b.k ?? 1)) - Math.abs((a.kept ?? 0) / (a.k ?? 1)))[0];
  return (
    <Example>
      <p>Usual rate = ({trace.base[1].toLocaleString("en-US")} rises + 1) / ({(trace.base[0] + trace.base[1]).toLocaleString("en-US")} outcomes + 2) = {pct(usualRate(trace.base), 2)}; logit = {signedNum(logit(trace.prior), 4)}.</p>
      {strongest && strongest.evidence !== null && strongest.variance !== null && strongest.spread !== null && (() => {
        const kept = shrink(strongest.evidence, strongest.variance, strongest.spread);
        return (
          <p>
            Strongest vote, {factorLabel(strongest.name)}: kept = {sigSigned(strongest.evidence)} × {sigNum(strongest.spread)} / ({sigNum(strongest.spread)} + {sigNum(strongest.variance)}) = {sigSigned(kept)} {strongest.kept !== null && <Check ok={Math.abs(kept - strongest.kept) <= 1e-3 * Math.max(1e-3, Math.abs(strongest.kept))} label={`the engine's ${sigSigned(strongest.kept)}`} />}; divided by k = {num(strongest.k, 3)}: {sigSigned(kept / (strongest.k ?? 1))}.
          </p>
        );
      })()}
      <p>logit(p) = {signedNum(logit(trace.prior), 4)} + ({combined.terms.map((t) => sigSigned(t, 3)).join(" ") || "0"}) = {signedNum(combined.logOdds, 4)}; p = 1 / (1 + e^−logit) = {pct(expit(combined.logOdds), 2)} <Check ok={Math.abs(combined.p - trace.p.graded) < 6e-4} label={`the engine's ${pct(trace.p.graded, 2)}`} /></p>
    </Example>
  );
}

// ---- step 6: decision tree ---------------------------------------------------------------------------------------------
export function DecisionStep({ decision, h, rule, fund, ticker, sealedFrom }: { decision: EngineDecision; h: string; rule: Rule; fund: string; ticker: string; sealedFrom: string }) {
  const trace = decision.trace[h];
  if (!trace) return <p className="desk-muted">No traced forecast at this horizon.</p>;
  const choice = decide(trace, rule);
  const trade = tradeOf(decision, h, rule);
  const out = decision.out[h];
  const node = (active: boolean, children: ReactNode) => <div className={`eng-node${active ? " on" : ""}`}>{children}</div>;
  return (
    <div className="eng-grid">
      <div className="eng-tree" role="group" aria-label="Decision tree">
        {node(true, <>Engine {pct(trace.p.graded, 2)} − usual rate {pct(trace.prior, 2)} = lean <strong>{points(choice.lean, 2)}</strong></>)}
        <div className="eng-branches">
          {node(choice.action === "long", <>lean ≥ +{(100 * rule.lean).toFixed(1)} pts<br /><strong>buy {ticker}, sell {fund}</strong><br />for {h} sessions</>)}
          {node(choice.action === "none", <>|lean| &lt; {(100 * rule.lean).toFixed(1)} pts<br /><strong>no trade</strong></>)}
          {node(choice.action === "short", <>lean ≤ −{(100 * rule.lean).toFixed(1)} pts<br /><strong>sell {ticker}, buy {fund}</strong><br />for {h} sessions</>)}
        </div>
      </div>
      <dl className="eng-dl">
        <dt>Entry</dt><dd>close of {fmtDate(decision.date)}</dd>
        <dt>Exit</dt><dd>{out ? `close of ${fmtDate(out.exit)} (${out.days} sessions)` : "—"}</dd>
        <dt>{ticker}</dt><dd>{out ? signedPct(out.r) : "—"}</dd>
        <dt>{fund}</dt><dd>{out ? signedPct(out.s) : "—"}</dd>
        <dt>{ticker} against {fund}</dt><dd>{out ? signedPct(out.r - out.s) : "—"} ({trace.out ? (trace.out[0] ? "beat its sector" : "lagged its sector") : decision.sealed ? "sealed" : "not finished"})</dd>
        <dt>The trade</dt><dd>{trade ? <>gross {signedPct(trade.gross)}, net of {pct(rule.cost, 2)} cost {signedPct(trade.net)} — {trade.won ? "won" : "lost"}</> : decision.sealed && choice.action !== "none" ? "taken; its result is sealed" : "none taken"}</dd>
      </dl>
      {decision.sealed && <p className="eng-small desk-muted">Decisions from {fmtDate(sealedFrom)} on are sealed: the forecast is shown, the outcome is kept back for the one final test of a frozen design.</p>}
    </div>
  );
}

// ---- step 7: results and benchmarks -------------------------------------------------------------------------------------
export function ResultsStep({ company, index, kind, h, rule, until }: { company: EngineFlowCompany; index: EngineFlowIndex; kind: string; h: string; rule: Rule; until: string | null }) {
  const [from, to] = index.run.scored;
  const scored = scoreOf(company, kind, h, rule, from, to);
  const soFar = until ? scoreOf(company, kind, h, rule, "0000", until) : null;
  const held = holding(company, from, to);
  const overall = index.overall.filter((o) => o.kind === kind);
  return (
    <div className="eng-stack">
      <div className="eng-kpis">
        <Kpi label={`${company.ticker}, scored ${from.slice(0, 4)}–mid ${to.slice(0, 4)}`} value={`${scored.decisions} decisions`} note={`${scored.upShare === null ? "—" : pct(scored.upShare, 0)} beat the sector`} />
        <Kpi label="Gain over the usual rate" value={scored.gainPer1000 === null ? "—" : `${signedNum(scored.gainPer1000, 1)} per 1000`} note={`Brier ${num(scored.brierEngine, 4)} vs usual ${num(scored.brierUsual, 4)}`} />
        <Kpi label={`Trades at ≥ ${(100 * rule.lean).toFixed(1)} pts`} value={`${scored.trades}`} note={scored.trades ? `${pct(scored.won, 0)} won · ${signedPct(scored.meanNet)} net each` : "the engine did not lean that far"} />
        <Kpi label={`Always long ${company.ticker} vs ${company.sectorFund ?? "fund"}`} value={signedPct(scored.alwaysLong)} note="average per decision" />
        <Kpi label="Holding over the scored years" value={`${company.ticker} ${signedPct(held.stock, 0)}`} note={`${company.sectorFund ?? "fund"} ${signedPct(held.fund, 0)} · SPY ${signedPct(held.market, 0)}`} />
      </div>
      {soFar && <p className="eng-small">Before the chosen decision ({fmtDate(until)}), as Run replays them: {soFar.decisions} decisions scored, gain {signedNum(soFar.gainPer1000, 1)} per 1000, {soFar.trades} trades, net {signedPct(soFar.totalNet)} in all.</p>}
      <EquityChart score={scored} ticker={company.ticker} fund={company.sectorFund ?? "fund"} />
      <div className="eng-table-wrap">
        <table className="eng-table">
          <caption>The engine over all companies ({kind} decisions, company against its sector, {from.slice(0, 4)} to mid-{to.slice(0, 4)}): gain in log score per 1000 decisions over the usual rate, 90% interval from resampling quarters</caption>
          <thead><tr><th>Horizon</th><th className="num">Decisions</th><th className="num">Beat the sector</th><th className="num">Gain per 1000</th><th className="num">90% interval</th><th className="num">Leaned ≥ 5 pts</th><th className="num">Went its way</th></tr></thead>
          <tbody>
            {overall.map((o) => (
              <tr key={o.h} className={o.h === h ? "on" : undefined}>
                <td>{o.h} sessions</td>
                <td className="num">{o.decisions.toLocaleString("en-US")}</td>
                <td className="num">{pct(o.upShare ?? null, 1)}</td>
                <td className="num">{signedNum(o.gain, 2)}</td>
                <td className="num">[{signedNum(o.low, 2)}, {signedNum(o.high, 2)}]</td>
                <td className="num">{o.leaned.toLocaleString("en-US")}</td>
                <td className="num">{pct(o.won, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="eng-kpi">
      <div className="eng-kpi-label">{label}</div>
      <div className="eng-kpi-value">{value}</div>
      {note && <div className="eng-kpi-note">{note}</div>}
    </div>
  );
}

/** Running totals of the rule's trades and of always holding the company against its fund, by exit date. */
function EquityChart({ score, ticker, fund }: { score: Score; ticker: string; fund: string }) {
  const points = score.curve;
  if (points.length < 2) return <p className="desk-muted">Too few finished decisions for a curve.</p>;
  const W = 640, H = 200, pad = 32;
  const values = points.flatMap((p) => [p.rule, p.always, 0]);
  const low = Math.min(...values), high = Math.max(...values), span = Math.max(1e-6, high - low);
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - low) / span) * (H - 2 * pad);
  const line = (key: "rule" | "always") => points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  return (
    <figure className="eng-figure">
      <figcaption className="eng-figtitle">Sum of returns, decision by decision (scored years): the rule's trades against always holding {ticker} against {fund}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="eng-svg" role="img" aria-label="Running totals of the rule's trades and of always holding">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="eng-axis" />
        <polyline points={line("always")} className="eng-line s2" />
        <polyline points={line("rule")} className="eng-line s1" />
        <text x={pad} y={H - 8} className="eng-svg-text">{fmtDate(points[0].date)}</text>
        <text x={W - pad} y={H - 8} textAnchor="end" className="eng-svg-text">{fmtDate(points[points.length - 1].date)}</text>
        <text x={4} y={y(high) + 4} className="eng-svg-text">{signedPct(high, 0)}</text>
        <text x={4} y={y(low) + 4} className="eng-svg-text">{signedPct(low, 0)}</text>
      </svg>
      <figcaption className="eng-legend">
        <span><i className="eng-swatch s1" aria-hidden="true" />the rule's trades, net</span>
        <span><i className="eng-swatch s2" aria-hidden="true" />always long {ticker} against {fund}</span>
      </figcaption>
    </figure>
  );
}

export function ResultsExample({ company, kind, h, rule, index }: { company: EngineFlowCompany; kind: string; h: string; rule: Rule; index: EngineFlowIndex }) {
  const [from, to] = index.run.scored;
  const score = scoreOf(company, kind, h, rule, from, to);
  return (
    <Example>
      <p>Over {score.decisions} scored decisions, the mean of ln(p of what happened / usual rate of what happened) × 1000 = {signedNum(score.gainPer1000, 2)}. Above zero would mean the engine's probabilities beat the usual rate for this company.</p>
      <p>Brier: engine {num(score.brierEngine, 4)} against the usual rate's {num(score.brierUsual, 4)} ({score.brierEngine !== null && score.brierUsual !== null ? (score.brierEngine < score.brierUsual ? "lower is better: the engine" : "the usual rate is as good or better") : "—"}).</p>
      <p>One company's record is short: with {score.decisions} decisions, ±{score.decisions ? (1000 * 1.64 * 0.69 / Math.sqrt(score.decisions)).toFixed(0) : "—"} per 1000 is roughly the noise. The table below, over all companies, is what counts.</p>
    </Example>
  );
}
