/**
 * /lab — Sentiment Lab (Stage 2.2): calibration and validation console for
 * the cloud LLM scoring.
 *
 * Three zones:
 *  1) COVERAGE — live counters from sentiment.labStats: how many rows/
 *     companies/documents each (model × prompt) pair has scored and how many
 *     tokens were billed in total (tokens are the site owner's real money,
 *     so they are shown separately and honestly).
 *  2) VALIDATION PROTOCOL — the fixed predictiveness-check protocol (frozen
 *     before the sample grows): target metric, thresholds, quality gates.
 *     The protocol is set BEFORE data collection — data-snooping protection.
 *  3) ACADEMIC GROUNDING — which papers the rubric design stands on; a short
 *     memo so future prompt edits are checked against the literature.
 *
 * The validation report on plugin data (AR vs SPY, consensus, transcripts)
 * is prepared separately in an analysis session; the page shows the CURRENT
 * sample readiness (n documents vs the minimum threshold), not ρ itself.
 */
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { Link } from "react-router";
import { FlaskConical, ExternalLink } from "lucide-react";

/**
 * Minimum sample size for a meaningful Spearman ρ under the user's
 * "aggregate-only" rule: below n = 30 a rank correlation is statistically
 * unstable (SE ~ 1/sqrt(n-1) ≈ 0.19 — larger than the target effect itself).
 * Not a "literature recommendation" but project discipline: do not compute ρ
 * on a calibration sample of single-digit documents.
 */
const MIN_DOCS_FOR_RHO = 30;

/** Target Spearman ρ corridor (aggregate score → AR vs SPY, filed+1..+3d).
 *  Set by the user in the Stage 2 discussion: a weak but persistent signal. */
const RHO_TARGET = "0.15–0.25";

/** Data-quality gates that must all pass BEFORE any ρ is interpreted. */
const QUALITY_GATES = [
  { key: "verbatim", label: "Evidence verbatim rate", target: "≥ 90%", note: "machine substring check; failure = paraphrase / quote from the wrong section" },
  { key: "tone", label: "tone_delta presence (pairwise)", target: "100%", note: "missing tone_delta in v1 was a prompt defect, fixed in v2" },
  { key: "coverage", label: "Companies with ≥2 scored periods", target: "≥ 20", note: "otherwise pairwise dynamics (Stage 3 FFT) cannot be built" },
] as const;

export default function Lab() {
  const stats = trpc.sentiment.labStats.useQuery();
  const scored = trpc.sentiment.tickersWithScores.useQuery();

  const totals = stats.data?.totals ?? [];
  const tokens = stats.data?.tokens ?? 0;
  // total unique documents across all versions — the sample-readiness measure
  const totalDocs = totals.reduce((s, t) => s + Number(t.docs ?? 0), 0);
  const ready = totalDocs >= MIN_DOCS_FOR_RHO;

  return (
    <AppLayout title="Sentiment Lab">
      <div className="space-y-4">
        {/* ── COVERAGE ─────────────────────────────────────────────────── */}
        <div className="t-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-baseline gap-3">
            <span className="t-label">Scoring coverage</span>
            <span className="t-mono text-[10px] text-muted-foreground ml-auto">
              billed tokens (all runs): <span className="text-[hsl(var(--warn))]">{tokens.toLocaleString()}</span>
            </span>
          </div>
          {totals.length === 0 ? (
            <div className="px-4 py-8 text-center t-mono text-[11px] text-muted-foreground">
              NO SCORES YET — RUN A «score» JOB
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["llm version", "prompt", "rows", "verbatim", "companies", "docs"].map((h) => (
                    <th key={h} className="t-label !text-[9px] text-left px-4 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => {
                  const rows = Number(t.rows ?? 0);
                  const verified = Number(t.verified ?? 0);
                  const rate = rows > 0 ? verified / rows : 0;
                  return (
                    <tr key={`${t.llmVersion}|${t.promptVersion}`} className="border-b border-[hsl(var(--border)/0.5)]">
                      <td className="px-4 py-2 t-mono text-[11px]">{t.llmVersion}</td>
                      <td className="px-4 py-2 t-mono text-[11px]">{t.promptVersion}</td>
                      <td className="px-4 py-2 t-mono text-[11px]">{rows}</td>
                      {/* verbatim rate highlighted against the 90% gate */}
                      <td className={`px-4 py-2 t-mono text-[11px] ${rate >= 0.9 ? "text-[hsl(var(--live))]" : "text-[hsl(var(--warn))]"}`}>
                        {(rate * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-2 t-mono text-[11px]">{Number(t.companies ?? 0)}</td>
                      <td className="px-4 py-2 t-mono text-[11px]">{Number(t.docs ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {/* tickers with scores — quick jump to the sentiment tab */}
          {(scored.data ?? []).length > 0 && (
            <div className="px-4 py-3 flex flex-wrap gap-2 border-t border-border">
              {(scored.data ?? []).map((c) => (
                <Link
                  key={c.cik}
                  to={`/company/${c.ticker ?? c.cik}`}
                  className="t-mono text-[10px] px-2 py-1 rounded border border-[hsl(var(--live)/0.4)] text-[hsl(var(--live))] hover:bg-[hsl(var(--live)/0.08)]"
                >
                  {c.ticker ?? c.cik} →
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── VALIDATION PROTOCOL ──────────────────────────────────────── */}
        <div className="t-panel px-4 py-3">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="t-label">Validation protocol (pre-registered)</span>
            {/* sample-readiness traffic light */}
            <span className={`t-mono text-[10px] ml-auto flex items-center gap-1.5 ${ready ? "text-[hsl(var(--live))]" : "text-[hsl(var(--warn))]"}`}>
              <span className={`led ${ready ? "led-live" : "led-warn"}`} />
              {ready ? "SAMPLE READY" : `SAMPLE n=${totalDocs} < ${MIN_DOCS_FOR_RHO} — ρ NOT COMPUTABLE YET`}
            </span>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <div className="t-label !text-[9px] mb-1">Hypothesis</div>
              <div className="t-mono text-[10px] text-muted-foreground leading-relaxed">
                Aggregate MD&A aspect score (mean of 8 aspects, pairwise-weighted)
                predicts abnormal return vs SPY over filed+1..+3 trading days.
              </div>
            </div>
            <div>
              <div className="t-label !text-[9px] mb-1">Target metric</div>
              <div className="t-mono text-[10px] text-muted-foreground leading-relaxed">
                Spearman ρ (aggregate-only, no per-aspect fishing):{" "}
                <span className="text-[hsl(var(--live))]">{RHO_TARGET}</span>.
                Below 0.10 → rubric redesign; above 0.30 → suspect leakage.
              </div>
            </div>
            <div>
              <div className="t-label !text-[9px] mb-1">Sample discipline</div>
              <div className="t-mono text-[10px] text-muted-foreground leading-relaxed">
                Min {MIN_DOCS_FOR_RHO} filings across ≥20 companies; returns via
                yahoo_finance plugin (AR = R(ticker) − R(SPY)); one filing =
                one observation, amendments excluded.
              </div>
            </div>
          </div>
          {/* quality gates: all must pass before any ρ is interpreted */}
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border)/0.5)] grid md:grid-cols-3 gap-4">
            {QUALITY_GATES.map((g) => (
              <div key={g.key}>
                <div className="t-mono text-[10px]">
                  {g.label} <span className="text-[hsl(var(--live))]">{g.target}</span>
                </div>
                <div className="t-mono text-[9px] text-muted-foreground mt-0.5">{g.note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── ACADEMIC GROUNDING ───────────────────────────────────────── */}
        <div className="t-panel px-4 py-3">
          <div className="t-label mb-2">Academic grounding</div>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                title: "Loughran–McDonald (2011)",
                body: "Generic (Harvard) word lists misclassify financial tone; 10-K-specific dictionaries. → Our rubric scores analyst-style aspects instead of raw word counts, but LM-negative word share is the fallback baseline for comparison.",
              },
              {
                title: "Lazy Prices (Cohen–Malloy–Nguyen, 2020)",
                body: "Year-over-year textual CHANGES in 10-Ks predict future returns; similarity/diff metrics beat levels. → Direct motivation for pairwise tone_delta: we score the delta explicitly instead of diffing texts mechanically.",
              },
              {
                title: "Attentive Options Traders (JFQA, 2025)",
                body: "The lazy-prices effect is driven mainly by OPTIONABLE stocks: informed traders exploit 10-K textual changes via OTM puts, and equity prices adjust slowly. → Direct link to our 20% speculative options engine: text-derived signals may be better monetized through options than equity.",
              },
              {
                title: "FinBERT (Araci, 2019)",
                body: "Finance-domain language model beats generic sentiment on financial texts. → Reference point for local worker: Qwen2.5-14B + rubric should beat FinBERT-level baselines on the same validation set.",
              },
            ].map((a) => (
              <div key={a.title}>
                <div className="t-mono text-[10px] text-[hsl(var(--live))] flex items-center gap-1.5">
                  <FlaskConical size={11} /> {a.title}
                </div>
                <div className="t-mono text-[9px] text-muted-foreground mt-1 leading-relaxed">{a.body}</div>
              </div>
            ))}
          </div>
          <div className="t-mono text-[9px] text-muted-foreground mt-3 pt-2 border-t border-[hsl(var(--border)/0.5)]">
            Note: LLM scoring and this page's stats are cloud-prototype (billed to site owner); production scoring runs on the local worker (temp=0, GBNF grammar).
            <ExternalLink size={9} className="inline ml-1" />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
