import { useMemo, useState } from "react";
import { latestEvidence, optionHypotheses, type OptionEvidenceKind, type OptionHypothesis, type OptionHypothesisCategory } from "@/data/option-hypotheses";

const statusMeta: Record<OptionEvidenceKind, { label: string; color: string }> = {
  qa: { label: "QA only", color: "hsl(var(--live))" },
  computed: { label: "Computed · unproven", color: "hsl(var(--warn))" },
  blocked: { label: "Awaiting history", color: "hsl(var(--muted-foreground))" },
  gate: { label: "Filter / gate", color: "hsl(217 91% 72%)" },
  supported: { label: "Supported", color: "hsl(var(--ok))" },
  refuted: { label: "Refuted", color: "hsl(var(--crit))" },
};
const categories: ("all" | OptionHypothesisCategory)[] = ["all", "Volatility", "Events", "Positioning", "Liquidity", "Probability engine", "Macro"];
const statuses: ("all" | OptionEvidenceKind)[] = ["all", "qa", "computed", "blocked", "gate", "supported", "refuted"];

function StatusBadge({ kind }: { kind: OptionEvidenceKind }) {
  const meta = statusMeta[kind];
  return <span className="inline-flex w-fit rounded-full border px-2 py-1 t-mono text-[10px] whitespace-nowrap" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>;
}

function Evidence({ hypothesis, mobile = false }: { hypothesis: OptionHypothesis; mobile?: boolean }) {
  const entries = [...hypothesis.evidence].reverse();
  return (
    <div className={mobile ? "mt-3" : "space-y-3"}>
      {entries.map((item, index) => (
        <div key={`${item.date}-${index}`} className={index > 0 ? "mt-3 pt-3 border-t border-[hsl(var(--border)/0.45)]" : ""}>
          {!mobile && index === 0 && <div className="mb-2"><StatusBadge kind={item.kind} /></div>}
          <div className="t-mono text-[10px] text-muted-foreground">{item.date}{index === 0 ? " · latest" : " · prior"}</div>
          <p className="text-[12px] leading-relaxed text-foreground/85 mt-1">{item.summary}</p>
        </div>
      ))}
    </div>
  );
}

function Formula({ hypothesis }: { hypothesis: OptionHypothesis }) {
  return <div className="t-mono text-[11px] leading-relaxed text-foreground/90 break-words">{hypothesis.formula.map((line) => <div key={line}>{line}</div>)}</div>;
}

export default function OptionHypothesisLedger() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | OptionHypothesisCategory>("all");
  const [status, setStatus] = useState<"all" | OptionEvidenceKind>("all");
  const filtered = useMemo(() => optionHypotheses.filter((hypothesis) => {
    const latest = latestEvidence(hypothesis);
    const text = `${hypothesis.parameter} ${hypothesis.formula.join(" ")} ${hypothesis.hypothesis} ${hypothesis.target} ${latest.summary}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (category === "all" || hypothesis.category === category) && (status === "all" || latest.kind === status);
  }), [query, category, status]);
  const reset = () => { setQuery(""); setCategory("all"); setStatus("all"); };
  const hasFilters = query !== "" || category !== "all" || status !== "all";

  return (
    <section className="t-panel px-5 py-4" aria-labelledby="option-hypothesis-title">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <div className="t-label">Option research ledger</div>
          <h2 id="option-hypothesis-title" className="t-mono text-[18px] font-semibold tracking-[0.04em] text-foreground mt-1">Hypotheses before signals</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground mt-2 max-w-3xl">Every row separates the formula, the falsifiable claim and the evidence. QA and computed values are not production alpha.</p>
        </div>
        <div className="t-mono text-[11px] text-muted-foreground">{filtered.length} of {optionHypotheses.length} hypotheses</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_220px_220px_auto] gap-2 mb-4">
        <input aria-label="Search option hypotheses" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search parameter, formula or hypothesis" className="min-h-11 px-3 rounded border border-border bg-transparent text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" />
        <select aria-label="Filter hypotheses by category" value={category} onChange={(event) => setCategory(event.target.value as "all" | OptionHypothesisCategory)} className="min-h-11 px-3 rounded border border-border bg-transparent text-[13px] text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
          {categories.map((item) => <option key={item} value={item}>{item === "all" ? "All categories" : item}</option>)}
        </select>
        <select aria-label="Filter hypotheses by evidence status" value={status} onChange={(event) => setStatus(event.target.value as "all" | OptionEvidenceKind)} className="min-h-11 px-3 rounded border border-border bg-transparent text-[13px] text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
          {statuses.map((item) => <option key={item} value={item}>{item === "all" ? "All evidence states" : statusMeta[item].label}</option>)}
        </select>
        <button type="button" onClick={reset} disabled={!hasFilters} className="min-h-11 px-4 rounded border border-border t-mono text-[11px] text-foreground cursor-pointer transition-colors hover:border-[hsl(var(--live))] hover:text-[hsl(var(--live))] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">Reset filters</button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center border-y border-border">
          <p className="text-[13px] text-muted-foreground">No hypotheses match these filters.</p>
          <button type="button" onClick={reset} className="mt-3 min-h-11 px-4 t-mono text-[11px] text-[hsl(var(--live))] underline underline-offset-4 cursor-pointer">Clear filters</button>
        </div>
      ) : (
        <>
          <div className="hidden xl:block overflow-x-auto">
            <table className="w-full table-fixed border-collapse" data-testid="option-hypothesis-table">
              <thead>
                <tr className="border-y border-border text-left t-mono text-[10px] tracking-[0.08em] text-muted-foreground">
                  <th className="w-[18%] py-3 pr-4">PARAMETER</th><th className="w-[23%] py-3 pr-4">FORMULA</th><th className="w-[34%] py-3 pr-4">FALSIFIABLE HYPOTHESIS</th><th className="w-[25%] py-3">EVIDENCE / RESULT</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((hypothesis) => (
                  <tr key={hypothesis.id} className="border-b border-[hsl(var(--border)/0.55)] align-top">
                    <td className="py-4 pr-4"><div className="t-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">{hypothesis.category}</div><div className="text-[13px] leading-snug font-medium text-foreground mt-1">{hypothesis.parameter}</div></td>
                    <td className="py-4 pr-4"><Formula hypothesis={hypothesis} /></td>
                    <td className="py-4 pr-4"><p className="text-[12px] leading-relaxed text-foreground/85">{hypothesis.hypothesis}</p><p className="t-mono text-[10px] leading-relaxed text-muted-foreground mt-2">Target: {hypothesis.target}</p></td>
                    <td className="py-4"><Evidence hypothesis={hypothesis} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="xl:hidden divide-y divide-[hsl(var(--border)/0.55)]">
            {filtered.map((hypothesis) => (
              <article key={hypothesis.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="t-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">{hypothesis.category}</div><h3 className="text-[14px] font-medium text-foreground mt-1">{hypothesis.parameter}</h3></div>
                  <StatusBadge kind={latestEvidence(hypothesis).kind} />
                </div>
                <div className="mt-3"><Formula hypothesis={hypothesis} /></div>
                <p className="text-[13px] leading-relaxed text-foreground/85 mt-3">{hypothesis.hypothesis}</p>
                <p className="t-mono text-[10px] text-muted-foreground mt-2">Target: {hypothesis.target}</p>
                <Evidence hypothesis={hypothesis} mobile />
              </article>
            ))}
          </div>
        </>
      )}
      <p className="t-mono text-[10px] leading-relaxed text-muted-foreground mt-4 pt-3 border-t border-border">Protocol: availability anchor → no lookahead → forward excess return vs SPY and/or forward RV → sector-neutral and independent universes. Supported or refuted states require walk-forward evidence.</p>
    </section>
  );
}
