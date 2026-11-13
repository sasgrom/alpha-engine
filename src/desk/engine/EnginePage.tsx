/**
 * Engine: what prediction engine v1 does, step by step, for one company and one of its decisions. The raw filed figures
 * and prices; the readings computed from them; every factor's rank, regression and forecast; their track record (e+,
 * e−); the Bayes combination into a probability; the trading rule; and the results against benchmarks. Everything
 * shown comes from a traced run of the engine (the lab's tools/flow/build-flow.mts); Run replays the company's
 * decisions in time order. Each step carries its write-up: hypothesis, process, why, what to expect, formulas with a
 * worked example from the chosen decision, what can be done better, and other ideas. Everything chosen lives in the
 * address, so a view can be linked. Owner only.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { trpc } from "@/providers/trpc";
import type { EngineDecision, EngineFlowCompany, EngineFlowIndex } from "@contracts/engine-flow";
import { Notice, Segmented, Shimmer } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { fmtDate } from "../format";
import { decodeFactor, type FactorView, type Rule } from "./model";
import { NOTES, STEP_TITLES } from "./notes";
import { AlgorithmExample, AlgorithmStep, DecisionStep, ErrorsExample, ErrorsStep, Example, ProbabilityExample, ProbabilityStep, RawStep, ReadingsExample, ReadingsStep, ResultsExample, ResultsStep, pct, points, signedNum, signedPct } from "./steps";

const LONG = { staleTime: 30 * 60_000, refetchOnWindowFocus: false, retry: 1 } as const;
type Kind = "release" | "filing";
const SPEEDS = { slow: 2200, normal: 1100, fast: 400 } as const;

export default function EnginePage() {
  useDocumentTitle("Engine");
  const { isAdmin, audienceReady } = useDesk();
  const index = trpc.desk.engineIndex.useQuery(undefined, { ...LONG, enabled: isAdmin });
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | null>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace: true });

  const data = index.data;
  const ticker = params.get("ticker") ?? "AAPL";
  const entry = data?.companies.find((c) => c.ticker === ticker) ?? data?.companies[0] ?? null;
  const company = trpc.desk.engineCompany.useQuery({ cik: entry?.cik ?? 1 }, { ...LONG, enabled: isAdmin && Boolean(entry) });

  if (!audienceReady) return <Shimmer height={420} />;
  if (!isAdmin) return <Notice title="The engine view is for the owner">It shows the research engine's working; ask the owner for access.</Notice>;
  if (index.isLoading) return <Shimmer height={520} />;
  if (index.error || !data) {
    return (
      <Notice title={index.error ? "The engine-flow files cannot be read" : "The engine-flow files are not built yet"}>
        {index.error?.message ?? "No index found."} They are built on the home machine from a traced engine run: step 3 with TRACE=1, step 2 with INPUTS=1, then the lab's tools/flow/build-flow.mts.
      </Notice>
    );
  }
  return <EngineView index={data} entry={entry} company={company.data ?? null} loading={company.isLoading} error={company.error?.message ?? null} params={params} set={set} />;
}

/** How many decisions of each kind the company has, and why a quarter can have no release decision. */
function Coverage({ company }: { company: EngineFlowCompany }) {
  const releases = company.decisions.filter((d) => d.kind === "release").length;
  const filings = company.decisions.filter((d) => d.kind === "filing");
  const sameDay = filings.filter((d) => d.sameDay).length;
  return (
    <p className="eng-small desk-muted eng-coverage">
      {company.ticker}: {releases} release decisions and {filings.length} 10-Q/10-K decisions.
      {sameDay > 0 && ` In ${sameDay} quarters the 10-Q/10-K came out the same day as the earnings release, before the next session, so the engine made one decision only, listed after the 10-Q/10-K.`}
    </p>
  );
}

function EngineView({ index, entry, company, loading, error, params, set }: {
  index: EngineFlowIndex;
  entry: EngineFlowIndex["companies"][number] | null;
  company: EngineFlowCompany | null;
  loading: boolean;
  error: string | null;
  params: URLSearchParams;
  set: (changes: Record<string, string | null>) => void;
}) {
  const kind: Kind = params.get("kind") === "filing" ? "filing" : "release";
  const h = index.horizons.includes(params.get("h") ?? "") ? params.get("h")! : "10";
  const lean = Math.max(0.005, Math.min(0.5, Number(params.get("lean") ?? "5") / 100 || 0.05));
  const cost = Math.max(0, Math.min(0.05, Number(params.get("cost") ?? "0.1") / 100 || 0));
  const rule: Rule = { lean, cost };
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>("normal");
  const [chosenFactor, setChosenFactor] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [closed, setClosed] = useState<Set<number>>(new Set());

  const decisions = useMemo(() => (company ? company.decisions.filter((d) => d.kind === kind && d.trace[h]) : []), [company, kind, h]);
  const at = params.get("at");
  const position = Math.max(0, decisions.findIndex((d) => d.date === at));
  const current = decisions.length ? (at && decisions.some((d) => d.date === at) ? decisions[position] : decisions[decisions.length - 1]) : null;
  const currentIndex = current ? decisions.indexOf(current) : -1;
  const go = (i: number) => { if (decisions[i]) set({ at: decisions[i].date }); };

  // Run: replay the decisions in time order from the chosen one
  useEffect(() => {
    if (!playing) return;
    if (currentIndex >= decisions.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => go(currentIndex + 1), SPEEDS[speed]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentIndex, decisions, speed]);

  const names = index.factors[kind] ?? [], families = index.factors.families?.[kind] ?? [];
  const trace = current?.trace[h] ?? null;
  const factors: FactorView[] = useMemo(() => (trace ? trace.f.map((row) => decodeFactor(row, names, families)).sort((a, b) => a.status - b.status || Math.abs((b.kept ?? 0) / (b.k ?? 1)) - Math.abs((a.kept ?? 0) / (a.k ?? 1))) : []), [trace, names, families]);
  const pick = factors.find((f) => f.name === chosenFactor) ?? factors.find((f) => f.status === 0) ?? factors.find((f) => f.table) ?? null;
  const figureDecision = current && company ? company.decisions.find((d) => d.id === current.id.replace("|release", "|filing")) ?? null : null;
  const matches = query.trim()
    ? index.companies.filter((c) => c.ticker.toLowerCase().startsWith(query.trim().toLowerCase()) || c.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12)
    : [];

  const summary = (n: number): ReactNode => {
    if (!current || !trace) return null;
    const voting = factors.filter((f) => f.status === 0).length;
    switch (n) {
      case 0: return `${current.form} for the quarter ending ${fmtDate(current.periodEnd)} · decision at the close of ${fmtDate(current.date)}`;
      case 1: return `reaction ${current.px.reaction === null || current.px.reaction === undefined ? "—" : current.px.reaction.toFixed(2)} usual moves${current.figures?.revenueGrowth !== undefined && current.figures?.revenueGrowth !== null ? ` · revenue growth ${signedPct(current.figures.revenueGrowth, 1)}` : ""}`;
      case 2: return `${factors.length} factors with a reading · ${voting} vote`;
      case 3: return pick ? `${pick.name}: ${pick.why}` : "no factor has a record";
      case 4: return `usual rate ${pct(trace.prior, 2)} → engine ${pct(trace.p.graded, 2)}`;
      case 5: return `lean ${points(trace.p.graded - trace.prior, 2)} → ${Math.abs(trace.p.graded - trace.prior) >= rule.lean ? (trace.p.graded > trace.prior ? "buy against the fund" : "sell against the fund") : "no trade"}`;
      case 6: return `${signedNum(index.overall.find((o) => o.kind === kind && o.h === h)?.gain ?? null, 2)} per 1000 over all companies at ${h} sessions`;
      default: return null;
    }
  };

  const body = (n: number): { data: ReactNode; example: ReactNode } | null => {
    if (!company || !current || !trace) return null;
    switch (n) {
      case 0: return { data: <RawStep company={company} decision={current} decisions={decisions} />, example: <RawExample company={company} decision={current} /> };
      case 1: return { data: <ReadingsStep decision={current.kind === "filing" ? current : { ...current, figures: figureDecision?.figures ?? null, inputs: figureDecision?.inputs ?? null }} figureDecision={figureDecision} />, example: <ReadingsExample decision={current.kind === "filing" || !figureDecision ? current : { ...current, figures: figureDecision.figures, inputs: figureDecision.inputs }} /> };
      case 2: return { data: <AlgorithmStep factors={factors} chosen={pick?.name ?? null} onChoose={setChosenFactor} trace={trace} />, example: <AlgorithmExample factor={pick} /> };
      case 3: return { data: <ErrorsStep factors={factors} chosen={pick?.name ?? null} onChoose={setChosenFactor} />, example: <ErrorsExample factor={pick} /> };
      case 4: return { data: <ProbabilityStep factors={factors} trace={trace} />, example: <ProbabilityExample factors={factors} trace={trace} /> };
      case 5: return { data: <DecisionStep decision={current} h={h} rule={rule} fund={company.sectorFund ?? "the sector fund"} ticker={company.ticker} sealedFrom={index.run.scored[1]} />, example: <DecisionExample decision={current} h={h} rule={rule} /> };
      case 6: return { data: <ResultsStep company={company} index={index} kind={kind} h={h} rule={rule} until={playing || at ? current.date : null} />, example: <ResultsExample company={company} kind={kind} h={h} rule={rule} index={index} /> };
      default: return null;
    }
  };

  const shown = focus === null ? STEP_TITLES.map((_, i) => i) : [focus];
  return (
    <div className="eng">
      <div className="desk-page-head">
        <div>
          <h1>Engine</h1>
          <p>
            What prediction engine v1 does, step by step, at every decision of one company: {index.run.name}. Scored {index.run.scored[0].slice(0, 4)} to mid-{index.run.scored[1].slice(0, 4)}; built {fmtDate(index.generatedAt.slice(0, 10))}. A description of the method and its record, not advice.
          </p>
        </div>
      </div>

      <div className="eng-controls">
        <div className="eng-control eng-search">
          <label htmlFor="eng-company">Company</label>
          <input id="eng-company" className="desk-input" placeholder={entry ? `${entry.ticker} · ${entry.name}` : "Ticker or name"} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
          {matches.length > 0 && (
            <ul className="eng-results" role="listbox" aria-label="Companies">
              {matches.map((c) => (
                <li key={c.cik}>
                  <button type="button" onClick={() => { setQuery(""); setPlaying(false); setChosenFactor(null); set({ ticker: c.ticker, at: null }); }}>
                    <strong>{c.ticker}</strong> {c.name} <span className="desk-muted">{c.sector}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="eng-control">
          <span>Decision</span>
          <Segmented<Kind> label="Decision" value={kind} onChange={(next) => { setPlaying(false); setChosenFactor(null); set({ kind: next === "release" ? null : next, at: null }); }} options={[{ value: "release", label: "After the release" }, { value: "filing", label: "After the 10-Q/10-K" }]} />
        </div>
        <div className="eng-control">
          <span>Horizon (sessions)</span>
          <Segmented<string> label="Horizon in sessions" value={h} onChange={(next) => set({ h: next === "10" ? null : next })} options={index.horizons.map((value) => ({ value, label: value }))} />
        </div>
        <div className="eng-control">
          <label htmlFor="eng-lean">Trade at lean ≥ (pts)</label>
          <input id="eng-lean" className="desk-input eng-narrow" type="number" min={0.5} max={50} step={0.5} value={+(100 * lean).toFixed(1)} onChange={(event) => set({ lean: event.target.value })} />
        </div>
        <div className="eng-control">
          <label htmlFor="eng-cost">Cost per trade (%)</label>
          <input id="eng-cost" className="desk-input eng-narrow" type="number" min={0} max={5} step={0.05} value={+(100 * cost).toFixed(2)} onChange={(event) => set({ cost: event.target.value })} />
        </div>
      </div>
      {company && <Coverage company={company} />}

      <div className="eng-run">
        <button type="button" className="desk-icon-button" onClick={() => go(0)} aria-label="First decision" title="First decision"><SkipBack size={16} aria-hidden="true" /></button>
        <button type="button" className="desk-icon-button" onClick={() => go(currentIndex - 1)} aria-label="Previous decision" title="Previous decision"><ChevronLeft size={16} aria-hidden="true" /></button>
        <button type="button" className="eng-play" onClick={() => { if (!playing && currentIndex >= decisions.length - 1) go(0); setPlaying((on) => !on); }} disabled={!decisions.length}>
          {playing ? <><Pause size={15} aria-hidden="true" /> Pause</> : <><Play size={15} aria-hidden="true" /> Run</>}
        </button>
        <button type="button" className="desk-icon-button" onClick={() => go(currentIndex + 1)} aria-label="Next decision" title="Next decision"><ChevronRight size={16} aria-hidden="true" /></button>
        <button type="button" className="desk-icon-button" onClick={() => go(decisions.length - 1)} aria-label="Last decision" title="Last decision"><SkipForward size={16} aria-hidden="true" /></button>
        <Segmented<keyof typeof SPEEDS> label="Speed" value={speed} onChange={setSpeed} options={[{ value: "slow", label: "Slow" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }]} />
        <div className="eng-timeline" role="group" aria-label="Decisions in time">
          {decisions.map((d, i) => {
            const t = d.trace[h];
            const leanOf = t ? t.p.graded - t.prior : 0;
            return (
              <button
                key={d.id}
                type="button"
                className={`eng-tick${i === currentIndex ? " on" : ""}${Math.abs(leanOf) >= lean ? (leanOf > 0 ? " up" : " down") : ""}`}
                style={{ height: `${8 + Math.min(26, Math.abs(leanOf) * 400)}px` }}
                onClick={() => { setPlaying(false); go(i); }}
                title={`${fmtDate(d.date)} · engine ${t ? pct(t.p.graded, 1) : "—"}, lean ${points(leanOf, 1)}`}
                aria-label={`Decision of ${fmtDate(d.date)}`}
              />
            );
          })}
        </div>
        <span className="eng-small desk-muted">{current ? `${currentIndex + 1} of ${decisions.length} · ${fmtDate(current.date)}` : loading ? "Loading the company…" : error ? "The company's file cannot be read" : "No traced decisions"}</span>
      </div>

      <div className="eng-layout">
        <nav className="eng-rail" aria-label="Steps">
          {STEP_TITLES.map((title, i) => (
            <button key={title} type="button" className={focus === i ? "on" : undefined} onClick={() => { if (focus !== null) setFocus(i); else document.getElementById(`eng-step-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
              <span className="eng-num">{i + 1}</span>{title}
            </button>
          ))}
          {focus !== null && <button type="button" className="eng-all" onClick={() => setFocus(null)}>Show all steps</button>}
        </nav>
        <div className="eng-steps">
          {!company || !current || !trace ? (
            loading ? <Shimmer height={480} /> : error ? <Notice title="The company's file cannot be read">{error}</Notice> : <Notice title="No traced decisions for this choice">Choose another company, decision or horizon.</Notice>
          ) : (
            shown.map((n) => (
              <StepCard
                key={n}
                n={n}
                summary={summary(n)}
                open={focus === n || !closed.has(n)}
                focused={focus === n}
                onToggle={() => setClosed((set) => { const next = new Set(set); if (next.has(n)) next.delete(n); else next.add(n); return next; })}
                onFocus={() => setFocus(focus === n ? null : n)}
                content={body(n)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StepCard({ n, summary, open, focused, onToggle, onFocus, content }: { n: number; summary: ReactNode; open: boolean; focused: boolean; onToggle: () => void; onFocus: () => void; content: { data: ReactNode; example: ReactNode } | null }) {
  const [tab, setTab] = useState<"data" | "notes">("data");
  const notes = NOTES[n];
  return (
    <section className={`eng-card${focused ? " focused" : ""}`} id={`eng-step-${n}`} aria-labelledby={`eng-step-title-${n}`}>
      <header className="eng-card-head">
        <button type="button" className="eng-card-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="eng-num">{n + 1}</span>
          <span className="eng-card-title" id={`eng-step-title-${n}`}>{STEP_TITLES[n]}</span>
          <span className="eng-card-summary">{summary}</span>
        </button>
        <div className="eng-card-tools">
          <Segmented<"data" | "notes"> label="Show" value={tab} onChange={setTab} options={[{ value: "data", label: "Data" }, { value: "notes", label: "Notes" }]} />
          <button type="button" className="desk-icon-button" onClick={onFocus} aria-label={focused ? "Back to all steps" : "Zoom into this step"} title={focused ? "Back to all steps" : "Zoom into this step"}>
            {focused ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          </button>
        </div>
      </header>
      {open && content && (
        <div className="eng-card-body">
          {tab === "data" ? (
            <>
              {content.data}
              <details className="eng-details" open={focused}>
                <summary>Worked example with this decision's numbers</summary>
                {content.example}
              </details>
            </>
          ) : (
            <div className="eng-notes">
              <section><h3>Hypothesis</h3><p>{notes.hypothesis}</p></section>
              <section><h3>Process used</h3><ol>{notes.process.map((line) => <li key={line}>{line}</li>)}</ol></section>
              <section><h3>Why this choice</h3><p>{notes.why}</p></section>
              <section><h3>What to expect</h3><p>{notes.expected}</p></section>
              <section><h3>Formulas and principles</h3><ul className="eng-formulas">{notes.formulas.map((line) => <li key={line}>{line}</li>)}</ul></section>
              <section><h3>Worked example</h3>{content.example}</section>
              <section><h3>What can be done better</h3><ul>{notes.better.map((line) => <li key={line}>{line}</li>)}</ul></section>
              <section><h3>Other ideas, outside the box</h3><ul>{notes.ideas.map((line) => <li key={line}>{line}</li>)}</ul></section>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RawExample({ company, decision }: { company: EngineFlowCompany; decision: EngineDecision }) {
  const filing = company.decisions.find((d) => d.id === decision.id.replace("|release", "|filing"));
  const revenue = filing?.inputs?.pairs?.revenue ?? null;
  const known = company.facts.rows.filter((r) => r[4] <= decision.date).length;
  const later = company.facts.rows.filter((r) => r[4] > decision.date).length;
  return (
    <Example>
      <p>Point in time: on {fmtDate(decision.date)}, {known.toLocaleString("en-US")} of this company's filed values were on record; {later.toLocaleString("en-US")} were filed later and are invisible to this decision.</p>
      {revenue ? (
        <p>Revenue for the quarter ending {fmtDate(decision.periodEnd)}: ${(revenue[0] / 1e9).toFixed(2)}bn; the same quarter a year earlier: ${(revenue[1] / 1e9).toFixed(2)}bn{decision.kind === "release" ? ", both as filed in the 10-Q/10-K that came after this release (so the release decision does not use them)" : ", both as printed in this filing"}.</p>
      ) : (
        <p className="desk-muted">No revenue pair on file for this quarter.</p>
      )}
    </Example>
  );
}

function DecisionExample({ decision, h, rule }: { decision: EngineDecision; h: string; rule: Rule }) {
  const trace = decision.trace[h], out = decision.out[h];
  if (!trace) return null;
  const lean = trace.p.graded - trace.prior;
  return (
    <Example>
      <p>lean = {pct(trace.p.graded, 2)} − {pct(trace.prior, 2)} = {points(lean, 2)}; the threshold is {(100 * rule.lean).toFixed(1)} pts, so {Math.abs(lean) >= rule.lean ? (lean > 0 ? "buy the company and sell its fund" : "sell the company and buy its fund") : "no trade"}.</p>
      {out && (
        <p>Had it traded long: ({signedPct(out.r)} − {signedPct(out.s)}) − {pct(rule.cost, 2)} = {signedPct(out.r - out.s - rule.cost)}; short: {signedPct(-(out.r - out.s) - rule.cost)}.</p>
      )}
      {decision.sealed && <p className="desk-muted">The outcome of this decision is sealed until the final test, so the trade's result is not worked out here.</p>}
    </Example>
  );
}
