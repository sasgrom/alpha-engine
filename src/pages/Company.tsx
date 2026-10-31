/**
 * /company/:ticker — per-company statistical assembly.
 * Tabs (decluttered in iteration 3c):
 *   Overview      — price quote header + daily chart + computed stats (3f)
 *                   on top; company card, corpus counters, data-health rollup
 *                   and flagged series below (the former "health" tab)
 *   Fundamentals  — Stage 1.6 canonical series explorer
 *   Documents     — Stage 1.5 filings & document corpus
 *   Sentiment     — Stage 2.2 LLM scores; the tab is CONDITIONAL and renders
 *                   only when the company actually has scored sections
 *   later: Signals (Stage 4-6)
 */
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Eye, FileText, AlertTriangle, Info } from "lucide-react";
import { fmtFyEnd } from "@/lib/format";
import Statements from "@/components/Statements";
import PriceOverview from "@/components/PriceOverview";
import ValuePanel from "@/components/ValuePanel";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot, ReferenceLine } from "recharts";

/** Compact formatter for large financial magnitudes (1.2B, 340M, …). */
function compact(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}

function pct(x: number | null | undefined) {
  return x === null || x === undefined ? "—" : (x * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// Overview section
// ---------------------------------------------------------------------------
function Overview({ ticker }: { ticker: string }) {
  const ov = trpc.company.overview.useQuery({ ticker });
  if (!ov.data) return <div className="t-mono text-[11px] text-muted-foreground">loading…</div>;
  const { company, counts, health } = ov.data;
  return (
    <div className="space-y-4">
      <div className="t-panel px-5 py-4">
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="t-mono text-[20px] font-semibold text-[hsl(var(--live))]">{company.ticker}</span>
          <span className="text-[14px]">{company.name}</span>
          <span className="t-mono text-[10px] text-muted-foreground ml-auto">CIK {company.cik}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2 mt-3">
          {[
            ["Exchange", company.exchange],
            ["Sector (SIC)", company.sicDescription ? `${company.sicDescription} (${company.sic})` : null],
            ["Fiscal year end", fmtFyEnd(company.fiscalYearEnd)],
            ["In universe", company.inUniverse ? "yes" : "no"],
          ].map(([k, v]) => (
            <div key={k as string}>
              <div className="t-label !text-[9px]">{k}</div>
              <div className="t-mono text-[12px] mt-0.5">{v ?? "—"}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Filings indexed", counts.filings],
          ["Documents registered", counts.documents],
          ["Documents in cloud", counts.documentsFetched],
          ["Canonical series", counts.series],
        ].map(([k, v]) => (
          <div key={k as string} className="t-panel px-4 py-3">
            <div className="t-label">{k}</div>
            <div className="t-mono text-[22px] font-semibold mt-1">{(v as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {health && (
        <div className="t-panel px-5 py-4">
          <div className="t-label mb-3">Data integrity rollup (Stage 4 features)</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-2">
            <div><div className="t-label !text-[9px]">Grid coverage</div><div className="t-mono text-[14px]">{pct(health.avgGridCoverage)}</div></div>
            <div><div className="t-label !text-[9px]">Revision rate</div><div className="t-mono text-[14px]">{pct(health.avgRevisionRate)}</div></div>
            <div><div className="t-label !text-[9px]">Revision magnitude (median)</div><div className="t-mono text-[14px]">{pct(health.avgRevisionMagnitude)}</div></div>
            <div><div className="t-label !text-[9px]">Revision lag</div><div className="t-mono text-[14px]">{health.avgRevisionLagDays?.toFixed(0) ?? "—"} days</div></div>
            <div><div className="t-label !text-[9px]">Amendments (/A)</div><div className="t-mono text-[14px]">{health.amendmentCount}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fundamentals section — canonical series explorer
// ---------------------------------------------------------------------------
function Fundamentals({ cik }: { cik: number }) {
  // the selected series is keyed by a concept|kind pair — the same XBRL
  // concept can exist both as a flow (over a period) and as a stock (point
  // in time), so the concept name alone does not identify a series
  const [concept, setConcept] = useState<string>("");
  const [kind, setKind] = useState<"flow" | "stock">("flow");
  // vintage "first" = data as originally reported (backtest-safe, no
  // look-ahead), "latest" = including all subsequent restatements
  const [vintage, setVintage] = useState<"first" | "latest">("latest");
  const concepts = trpc.series.concepts.useQuery({ cik });
  const points = trpc.series.points.useQuery(
    { cik, concept, kind, vintage },
    { enabled: !!concept }
  );

  // aliasedFrom is stored in the DB as a JSON string — unpacked here for the
  // concept-rename footnote (e.g. Revenues → RevenueFromContractWithCustomer…)
  const selected = (concepts.data ?? []).find((c) => c.concept === concept && c.kind === kind);
  const aliasedFrom: string[] = useMemo(
    () => (selected?.aliasedFrom ? JSON.parse(selected.aliasedFrom) : []),
    [selected]
  );

  // recharts cannot draw null values in a Line — dropped before render;
  // derivation rides in the payload so Q4=FY−9M points can be marked
  const chartData = useMemo(
    () =>
      (points.data ?? [])
        .filter((p): p is typeof p & { val: number } => p.val !== null)
        .map((p) => ({ periodEnd: p.periodEnd, val: p.val, derivation: p.derivation })),
    [points.data]
  );

  // --- two-way hover sync "table <-> chart" -------------------------------
  // hoverPeriod = the periodEnd under the cursor regardless of the source
  // (table row or the chart itself); it drives the ReferenceDot on the chart
  // and the row highlight in the table
  const [hoverPeriod, setHoverPeriod] = useState<string | null>(null);
  const hoverPoint = useMemo(
    () => chartData.find((d) => d.periodEnd === hoverPeriod) ?? null,
    [chartData, hoverPeriod]
  );
  // when hovering the CHART, the highlighted table row may be outside the
  // scroll viewport — pull it into view (block:nearest so there is no jump
  // when the row is already visible)
  useEffect(() => {
    if (hoverPeriod) document.getElementById(`qp-${hoverPeriod}`)?.scrollIntoView({ block: "nearest" });
  }, [hoverPeriod]);

  return (
    <div className="space-y-3">
      {/* Curated statements viewer (3e) on top; the raw single-series
          explorer below stays as the full-concept fallback browser. */}
      <Statements cik={cik} />
      <div className="t-label !text-[10px] pt-2 border-t border-border">Series explorer — all concepts</div>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={concept ? `${concept}|${kind}` : ""}
          onValueChange={(v) => {
            const [c, k] = v.split("|");
            setConcept(c);
            setKind(k as "flow" | "stock");
          }}
        >
          <SelectTrigger className="h-8 w-full sm:w-[420px] t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]">
            <SelectValue placeholder={`select series (${concepts.data?.length ?? 0} built)`} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {(concepts.data ?? []).map((c) => (
              <SelectItem key={`${c.concept}|${c.kind}`} value={`${c.concept}|${c.kind}`} className="t-mono text-[11px]">
                {c.concept} <span className="text-muted-foreground">[{c.kind}]</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={vintage} onValueChange={(v) => setVintage(v as typeof vintage)}>
          <SelectTrigger className="h-8 w-56 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">latest (restated truth)</SelectItem>
            <SelectItem value="first">first (as originally reported)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {aliasedFrom.length > 0 && (
        <div className="t-panel-inset px-3 py-2 flex items-start gap-2">
          <Info size={13} className="text-[hsl(var(--live))] mt-0.5 shrink-0" />
          <span className="t-mono text-[10px] text-muted-foreground">
            Concept renamed by the filer — spliced under the newest name. Formerly: {aliasedFrom.join(", ")}.
          </span>
        </div>
      )}

      {concept ? (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="t-panel lg:col-span-2 p-4">
            <div className="t-label mb-3">{concept} · {kind} · vintage={vintage}</div>
            <ResponsiveContainer width="100%" height={340}>
              {/* onMouseMove lifts activeLabel (the periodEnd under the cursor)
                  into the shared hoverPeriod — the table highlights the same
                  point; leaving the chart clears the highlight */}
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                onMouseMove={(s: { activeLabel?: string | number }) => {
                  const l = s?.activeLabel;
                  if (typeof l === "string") setHoverPeriod((prev) => (prev === l ? prev : l));
                }}
                onMouseLeave={() => setHoverPeriod(null)}
              >
                <CartesianGrid stroke="hsl(223 42% 14%)" strokeDasharray="2 4" />
                <XAxis dataKey="periodEnd" tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(d: string) => d.slice(0, 7)} />
                <YAxis tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }} tickFormatter={(v: number) => compact(v)} width={70} />
                <Tooltip
                  contentStyle={{ background: "hsl(219 43% 12%)", border: "1px solid hsl(223 42% 18%)", borderRadius: 6, fontFamily: "JetBrains Mono", fontSize: 11 }}
                  formatter={(v: number, _n: string, item: any) => [`${compact(v)}${item?.payload?.derivation === "derived_q4" ? " (Q4 = FY − 9M)" : ""}`, concept]}
                />
                {/* custom dot rendering: regular quarters get no marker (r=0),
                    a derived Q4 (FY − 9M YTD) gets an amber ring so computed
                    values are visually distinct from reported ones */}
                <Line type="monotone" dataKey="val" stroke="hsl(187 86% 53%)" strokeWidth={1.75}
                  dot={(p: any) => (
                    <circle key={p.key} cx={p.cx} cy={p.cy} r={p.payload.derivation === "derived_q4" ? 3 : 0}
                      fill="none" stroke="hsl(43 96% 56%)" strokeWidth={1.5} />
                  )}
                  activeDot={{ r: 3, fill: "hsl(187 86% 53%)" }} />
                {/* sync marker: when the hover came from the table, the chart
                    draws the same point + a guide line — the equivalent of
                    "dragging a cursor over the chart".
                    IMPORTANT (empirical, regression test Company.hover.test):
                    recharts 2.15 LOSES ReferenceDot/ReferenceLine when they are
                    wrapped in a React fragment inside the chart children — only
                    direct conditional siblings, as below, render reliably. */}
                {hoverPoint && (
                  <ReferenceLine x={hoverPoint.periodEnd} stroke="hsl(187 86% 53% / 0.35)" strokeDasharray="3 3" />
                )}
                {hoverPoint && (
                  <ReferenceDot
                    x={hoverPoint.periodEnd}
                    y={hoverPoint.val}
                    r={5}
                    fill="hsl(187 86% 53%)"
                    stroke="hsl(224 52% 4%)"
                    strokeWidth={2}
                    label={{
                      value: compact(hoverPoint.val),
                      position: "top",
                      fill: "hsl(187 86% 53%)",
                      fontSize: 10,
                      fontFamily: "JetBrains Mono",
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
            <div className="t-mono text-[9px] text-muted-foreground mt-2">◦ amber ring = Q4 derived as FY − 9M YTD (no 10-Q exists for Q4)</div>
          </div>
          <div className="t-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-border t-label">Quarterly points</div>
            <div className="max-h-[340px] overflow-y-auto divide-y divide-[hsl(var(--border)/0.6)]">
              {[...chartData].reverse().map((r) => {
                // id qp-<periodEnd> — scroll anchor for chart-side hovers;
                // hovering the row highlights the point on the chart
                const active = hoverPeriod === r.periodEnd;
                return (
                <div
                  key={r.periodEnd}
                  id={`qp-${r.periodEnd}`}
                  onMouseEnter={() => setHoverPeriod(r.periodEnd)}
                  onMouseLeave={() => setHoverPeriod(null)}
                  className={`flex justify-between px-4 py-1.5 cursor-crosshair transition-colors ${
                    // --accent (223 42% 18%) is too close to the panel background
                    // and unreadable as a highlight on the dark theme — use a
                    // --live tint with a left light bar (mission-control style)
                    active ? "bg-[hsl(var(--live)/0.12)] shadow-[inset_2px_0_0_hsl(var(--live))]" : ""
                  }`}
                >
                  <span className={`t-mono text-[11px] ${active ? "text-[hsl(var(--live))]" : "text-muted-foreground"}`}>
                    {r.periodEnd}{r.derivation === "derived_q4" && <span className="text-[hsl(var(--warn))]"> ∆</span>}
                  </span>
                  <span className={`t-mono text-[11px] ${active ? "font-semibold" : ""}`}>{compact(r.val)}</span>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="t-panel-inset border-dashed px-4 py-16 text-center t-mono text-[11px] text-muted-foreground">
          SELECT A CANONICAL SERIES — RUN A "series" JOB FIRST IF NONE ARE BUILT
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filings & Documents section
// ---------------------------------------------------------------------------
function FilingsAndDocuments({ cik }: { cik: number }) {
  const [form, setForm] = useState("all");
  // which document is open in the viewer dialog; null = dialog closed
  const [viewing, setViewing] = useState<{ id: number; label: string } | null>(null);
  const scope = trpc.company.formScope.useQuery();
  const docs = trpc.documents.list.useQuery({
    cik, form: form === "all" ? undefined : form, page: 0, pageSize: 60,
  });
  // text and the raw-original URL are fetched only while the dialog is open
  // (enabled: !!viewing) — no pointless object-storage load; the presigned
  // URL is short-lived (~10 min), so it is requested on demand
  const text = trpc.documents.text.useQuery(
    { id: viewing?.id ?? 0 },
    { enabled: !!viewing }
  );
  const rawUrl = trpc.documents.rawUrl.useQuery(
    { id: viewing?.id ?? 0 },
    { enabled: !!viewing }
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select value={form} onValueChange={setForm}>
          <SelectTrigger className="h-8 w-36 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all forms</SelectItem>
            {(scope.data ?? []).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="t-mono text-[10px] text-muted-foreground ml-auto">{docs.data?.total ?? 0} documents registered</span>
      </div>

      <div className="t-panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {["Role", "Document", "Form", "Size", "Text", "Location", ""].map((h) => (
                <th key={h} className="t-label text-left px-4 py-2.5 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border)/0.6)]">
            {(docs.data?.rows ?? []).map((d) => (
              <tr key={d.id} className="hover:bg-[hsl(var(--accent)/0.15)]">
                <td className="px-4 py-2">
                  <span className={`t-mono text-[9px] px-1.5 py-0.5 border rounded-sm ${
                    d.role === "primary" ? "text-[hsl(var(--live))] border-[hsl(var(--live)/0.4)]"
                    : d.role === "exhibit" ? "text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.4)]"
                    : "text-muted-foreground border-border"}`}>
                    {d.role.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-2 t-mono text-[11px]">{d.docName}</td>
                <td className="px-4 py-2 t-mono text-[11px]">{d.form}</td>
                <td className="px-4 py-2 t-mono text-[10px] text-muted-foreground">{compact(d.sizeBytes)}B</td>
                <td className="px-4 py-2 t-mono text-[10px] text-muted-foreground">{d.textLength ? `${(d.textLength / 1000).toFixed(0)}k ch` : "—"}</td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className={`led ${d.fetchStatus === "fetched" ? "led-ok" : d.fetchStatus === "failed" ? "led-crit" : "led-off"}`} />
                    <span className="t-mono text-[9px] text-muted-foreground uppercase">{d.location}</span>
                  </span>
                </td>
                <td className="px-4 py-2">
                  {d.fetchStatus === "fetched" && (
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => setViewing({ id: d.id, label: `${d.ticker} ${d.form} — ${d.docName}` })}>
                      <Eye size={13} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {docs.data?.rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center t-mono text-[11px] text-muted-foreground">
                NO DOCUMENTS YET — RUN A "harvest" JOB
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-4xl t-panel !bg-[hsl(var(--card))]">
          <DialogHeader>
            <DialogTitle className="t-mono text-[12px] uppercase tracking-[0.14em] flex items-center gap-2">
              <FileText size={14} className="text-[hsl(var(--live))]" /> {viewing?.label}
            </DialogTitle>
          </DialogHeader>
          {rawUrl.data?.url && (
            <a href={rawUrl.data.url} target="_blank" rel="noreferrer"
              className="t-mono text-[10px] text-[hsl(var(--live))] hover:underline">
              OPEN RAW ORIGINAL ↗
            </a>
          )}
          <div className="console rounded-md max-h-[60vh] overflow-y-auto p-3">
            {text.isLoading && <div className="lv-ts">loading plaintext from storage…</div>}
            {text.error && <div className="lv-error">{String(text.error)}</div>}
            {text.data?.source === "sec" && (
              <div className="lv-info">
                Plaintext is not stored on this copy. The original document is public on SEC EDGAR:{" "}
                <a href={text.data.secUrl} target="_blank" rel="noreferrer" className="text-[hsl(var(--live))] underline underline-offset-2">
                  OPEN ON SEC EDGAR ↗
                </a>
              </div>
            )}
            {text.data && text.data.source !== "sec" && (
              <>
                <div className="lv-ts mb-2">{text.data.length.toLocaleString()} chars{text.data.truncated ? " (excerpt)" : ""}{text.data.source === "local-cache" ? " · local cache" : ""}</div>
                <div className="lv-info whitespace-pre-wrap">{text.data.excerpt}</div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data Health section — continuity flags + restatement metrics
// ---------------------------------------------------------------------------
function DataHealth({ cik }: { cik: number }) {
  // Only the flagged-series list is queried here: since iteration 3c this
  // block lives inside the Overview tab, which already renders the metric
  // rollup (the health panel) — no duplicated cards, no duplicated query.
  const flagged = trpc.series.flagged.useQuery({ cik });

  return (
    <div className="space-y-4">
      <div className="t-panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border t-label flex items-center gap-2">
          <AlertTriangle size={12} className="text-[hsl(var(--warn))]" /> Flagged series ({flagged.data?.length ?? 0})
        </div>
        <div className="divide-y divide-[hsl(var(--border)/0.6)] max-h-[480px] overflow-y-auto">
          {(flagged.data ?? []).map((s) => {
            // flags in the DB are a JSON array of "type:detail" strings
            // (gap:2015Q3..2016Q1, unit_change:USD→shares, sharp_revision:…)
            const flags: string[] = s.flags ? JSON.parse(s.flags) : [];
            return (
              <div key={s.id} className="px-4 py-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="t-mono text-[11px]">{s.concept}</span>
                  <span className="t-mono text-[9px] text-muted-foreground">[{s.kind}]</span>
                  <span className="t-mono text-[10px] text-muted-foreground ml-auto">
                    {s.pointsCount} pts · coverage {pct(s.gridCoverage)} · rev {pct(s.revisionRate)}
                  </span>
                </div>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {flags.map((f) => {
                    // the prefix before the colon picks the badge color:
                    // gap = amber (hole in the grid), sharp_revision = red
                    // (restatement >5%), the rest (unit_change etc.) — neutral
                    const [kind, rest] = f.split(":");
                    return (
                      <span key={f} className={`t-mono text-[9px] px-1.5 py-0.5 border rounded-sm ${
                        kind === "gap" ? "text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.4)]"
                        : kind === "sharp_revision" ? "text-[hsl(var(--crit))] border-[hsl(var(--crit)/0.4)]"
                        : "text-muted-foreground border-border"}`}
                        title={rest}>
                        {f.length > 60 ? f.slice(0, 60) + "…" : f}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {flagged.data?.length === 0 && (
            <div className="px-4 py-12 text-center t-mono text-[11px] text-muted-foreground">
              NO FLAGS — OR NO SERIES BUILT YET
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Sentiment section (Stage 2.2)
// ---------------------------------------------------------------------------
// The tab reads sentiment.byCompany: LLM section scores (by default only the
// latest llmVersion+promptVersion pair, so runs of different prompts never
// mix; older versions are reachable via the version chips).
// Score scale: continuous -1..+1 (anchors in rubric.ts); confidence 0..1;
// evidence is a verbatim quote from the source, machine-verified
// (evidenceOk=false = suspected paraphrase / quote from the wrong section).
// ---------------------------------------------------------------------------

/** Human-readable aspect labels; the set/order is pinned by contract.ts (ASPECTS). */
const ASPECT_LABELS: Record<string, string> = {
  outlook: "Outlook",
  demand: "Demand",
  margins: "Margins",
  liquidity: "Liquidity",
  capex: "Capex",
  capital_return: "Capital return",
  legal_reg: "Legal/Reg",
  accounting: "Accounting",
};

/**
 * Centered bar for a -1..+1 score: zero in the middle, the positive part
 * extends right (live/cyan), the negative — left (crit). Brightness is scaled
 * by confidence: a low-confidence score looks visibly "paler" so it does not
 * read as equal to a confident one.
 */
function ScoreBar({ score, confidence }: { score: number; confidence: number }) {
  const pctW = Math.min(100, Math.abs(score) * 100) / 2; // half width = the 0..1 range
  const pos = score >= 0;
  return (
    <div className="relative h-2 w-full rounded bg-[hsl(var(--accent)/0.5)] overflow-hidden">
      {/* zero axis */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[hsl(var(--border))]" />
      <div
        className={`absolute top-0 bottom-0 ${pos ? "bg-[hsl(var(--live))]" : "bg-[hsl(var(--crit))]"}`}
        style={{
          left: pos ? "50%" : `${50 - pctW}%`,
          width: `${pctW}%`,
          opacity: 0.35 + 0.65 * Math.min(1, Math.max(0, confidence)),
        }}
      />
    </div>
  );
}

/** One aspect row: label, bar, value, confidence, expandable evidence. */
function AspectRow({ r }: { r: {
  aspect: string; score: number | null; confidence: number | null;
  evidence: string | null; evidenceOk: boolean;
} }) {
  const score = r.score ?? 0;
  const conf = r.confidence ?? 0;
  return (
    <div className="py-1.5 border-b border-[hsl(var(--border)/0.4)] last:border-0">
      <div className="grid grid-cols-[130px_1fr_52px_44px] items-center gap-3">
        <span className="t-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {ASPECT_LABELS[r.aspect] ?? r.aspect}
        </span>
        <ScoreBar score={score} confidence={conf} />
        <span className={`t-mono text-[11px] text-right ${score >= 0 ? "text-[hsl(var(--live))]" : "text-[hsl(var(--crit))]"}`}>
          {score >= 0 ? "+" : ""}{score.toFixed(2)}
        </span>
        <span className="t-mono text-[10px] text-right text-muted-foreground" title="confidence">
          {(conf * 100).toFixed(0)}%
        </span>
      </div>
      {r.evidence && (
        <details className="mt-1 ml-[130px]">
          <summary className="t-mono text-[9px] text-muted-foreground cursor-pointer hover:text-foreground">
            evidence {!r.evidenceOk && <span className="text-[hsl(var(--warn))]">· NOT VERBATIM</span>}
          </summary>
          <div className={`t-mono text-[10px] mt-1 pl-2 border-l-2 ${r.evidenceOk ? "border-[hsl(var(--live)/0.4)]" : "border-[hsl(var(--warn))]"} text-muted-foreground whitespace-pre-wrap`}>
            «{r.evidence}»
          </div>
        </details>
      )}
    </div>
  );
}

function SentimentPanel({ cik }: { cik: number }) {
  // version switcher (prompt/model A/B): null = "latest pair" (backend default)
  const [version, setVersion] = useState<{ llmVersion: string; promptVersion: string } | null>(null);
  // audit mode: also show rows whose evidence failed verification (hidden by default)
  const [showUnverified, setShowUnverified] = useState(false);

  const q = trpc.sentiment.byCompany.useQuery({
    cik,
    llmVersion: version?.llmVersion,
    promptVersion: version?.promptVersion,
    includeUnverified: showUnverified,
  });

  if (q.isLoading) return <div className="t-mono text-[11px] text-muted-foreground">loading…</div>;
  const rows = q.data?.rows ?? [];
  const versions = q.data?.versions ?? [];

  if (rows.length === 0 && versions.length === 0) {
    return (
      <div className="t-panel px-4 py-8 text-center t-mono text-[11px] text-muted-foreground">
        NO SENTIMENT SCORES YET — RUN A «score» JOB (STAGE 2.2)
      </div>
    );
  }

  // group rows by (filing, section): backend order is already filingDate desc
  const groups: { key: string; header: (typeof rows)[number]; items: typeof rows }[] = [];
  for (const r of rows) {
    const key = `${r.accessionNo}/${r.sectionKey}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, header: r, items: [r] });
  }

  return (
    <div className="space-y-4">
      {/* scoring-version switcher: shown only when more than one run exists */}
      {versions.length > 1 && (
        <div className="t-panel px-4 py-2.5 flex flex-wrap items-center gap-2">
          <span className="t-label !text-[9px] mr-1">Model / prompt version</span>
          {versions.map((v) => {
            const active = version?.llmVersion === v.llmVersion && version?.promptVersion === v.promptVersion;
            return (
              <button
                key={`${v.llmVersion}|${v.promptVersion}`}
                onClick={() => setVersion({ llmVersion: v.llmVersion, promptVersion: v.promptVersion })}
                className={`t-mono text-[10px] px-2 py-1 rounded border transition-colors ${
                  active ? "border-[hsl(var(--live)/0.6)] text-[hsl(var(--live))] bg-[hsl(var(--live)/0.08)]"
                         : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.llmVersion} · {v.promptVersion} ({v.n})
              </button>
            );
          })}
        </div>
      )}

      {/* audit toggle: show rows whose evidence failed the verbatim check */}
      <label className="flex items-center gap-2 t-mono text-[10px] text-muted-foreground cursor-pointer select-none">
        <input type="checkbox" checked={showUnverified} onChange={(e) => setShowUnverified(e.target.checked)} />
        include unverified evidence (hallucination audit)
      </label>

      {rows.length === 0 ? (
        <div className="t-panel px-4 py-6 text-center t-mono text-[11px] text-muted-foreground">
          NO ROWS IN THIS VERSION — SWITCH VERSION OR ENABLE UNVERIFIED
        </div>
      ) : groups.map((g) => {
        const deltas = g.items.filter((r) => r.aspect === "tone_delta");
        const aspects = g.items.filter((r) => r.aspect !== "tone_delta");
        const verified = g.items.filter((r) => r.evidenceOk).length;
        return (
          <div key={g.key} className="t-panel px-4 py-3">
            {/* group header: form, dates, section, flags */}
            <div className="flex items-baseline gap-3 flex-wrap mb-2">
              <span className="t-mono text-[12px] text-[hsl(var(--live))]">{g.header.form}</span>
              <span className="t-mono text-[10px] text-muted-foreground">filed {g.header.filingDate ?? "?"}</span>
              {g.header.reportDate && <span className="t-mono text-[10px] text-muted-foreground">period {g.header.reportDate}</span>}
              <span className="t-mono text-[10px] uppercase text-muted-foreground">{g.header.sectionKey}</span>
              {g.header.pairwise && (
                <span className="t-mono text-[9px] px-1.5 py-0.5 rounded border border-[hsl(var(--live)/0.4)] text-[hsl(var(--live))]">PAIRWISE</span>
              )}
              <span className="t-mono text-[9px] text-muted-foreground ml-auto">
                evidence {verified}/{g.items.length} verbatim
              </span>
            </div>
            {/* tone_delta lives on its own row: it is a pairwise metric, not an aspect */}
            {deltas.map((r) => (
              <div key={r.id} className="py-1.5 border-b border-[hsl(var(--border)/0.4)]">
                <div className="grid grid-cols-[130px_1fr_52px_44px] items-center gap-3">
                  <span className="t-mono text-[10px] uppercase tracking-wider text-[hsl(var(--warn))]">Tone Δ vs prior</span>
                  <ScoreBar score={r.score ?? 0} confidence={r.confidence ?? 0} />
                  <span className={`t-mono text-[11px] text-right ${(r.score ?? 0) >= 0 ? "text-[hsl(var(--live))]" : "text-[hsl(var(--crit))]"}`}>
                    {(r.score ?? 0) >= 0 ? "+" : ""}{(r.score ?? 0).toFixed(2)}
                  </span>
                  <span className="t-mono text-[10px] text-right text-muted-foreground">{((r.confidence ?? 0) * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
            {aspects.map((r) => <AspectRow key={r.id} r={r} />)}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insider activity panel (4j, D42) — recent Form 4 transactions + the net
// open-market buying line for the last 90 days (P−S in $; grants/exercises/
// tax-withholding are NOT informative and excluded from the net line).
// ---------------------------------------------------------------------------
const INSIDER_CODE: Record<string, { label: string; cls: string }> = {
  P: { label: "BUY", cls: "text-[hsl(var(--live))] border-[hsl(var(--live)/0.4)]" },
  S: { label: "SELL", cls: "text-[hsl(var(--crit))] border-[hsl(var(--crit)/0.4)]" },
  A: { label: "GRANT", cls: "text-muted-foreground border-border" },
  M: { label: "EXERCISE", cls: "text-muted-foreground border-border" },
  F: { label: "TAX", cls: "text-muted-foreground border-border" },
  G: { label: "GIFT", cls: "text-muted-foreground border-border" },
};

function InsiderPanel({ cik }: { cik: number }) {
  const q = trpc.company.insiderTrades.useQuery({ cik });
  if (!q.data || q.data.length === 0) return null; // no Form 4 coverage — hide honestly
  const rows = q.data;
  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const net90 = rows
    .filter((r) => (r.tradeDate ?? "") >= cutoff && (r.code === "P" || r.code === "S") && r.price !== null && r.shares !== null)
    .reduce((s, r) => s + (r.code === "P" ? 1 : -1) * (r.shares as number) * (r.price as number), 0);
  return (
    <div className="t-panel px-5 py-4">
      <div className="t-label mb-3 flex items-center justify-between">
        <span>Insider activity (Form 4)</span>
        <span className={`t-mono text-[10px] ${net90 >= 0 ? "text-[hsl(var(--live))]" : "text-[hsl(var(--crit))]"}`}>
          NET 90d OPEN-MARKET: {net90 >= 0 ? "+" : ""}${(Math.abs(net90) / 1e6).toFixed(1)}M{net90 < 0 ? " SOLD" : " BOUGHT"}
        </span>
      </div>
      <div className="divide-y divide-[hsl(var(--border)/0.5)] max-h-64 overflow-y-auto">
        {rows.map((r) => {
          const c = INSIDER_CODE[r.code] ?? { label: r.code, cls: "text-muted-foreground border-border" };
          return (
            <div key={r.id} className="py-1.5 flex items-center gap-3 t-mono text-[10px]">
              <span className="text-muted-foreground w-20 shrink-0">{r.tradeDate}</span>
              <span className={`px-1.5 py-0.5 border rounded-sm text-[9px] ${c.cls}`}>{c.label}</span>
              <span className="truncate flex-1" title={r.insiderRole ?? ""}>
                {r.insiderName ?? "—"}
                {r.is10b5 ? <span className="text-muted-foreground/60"> ·10b5-1</span> : ""}
              </span>
              <span className="text-muted-foreground shrink-0">
                {r.shares !== null ? r.shares.toLocaleString("en-US") : "—"} sh{r.price !== null ? ` @ $${r.price.toFixed(2)}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Institutional panel (5g) — 13F aggregates: ownership, holders, QoQ flow,
// top holders. Aggregates are deterministic (no LLM).
// ---------------------------------------------------------------------------
function InstitutionalPanel({ cik }: { cik: number }) {
  const q = trpc.company.institutional.useQuery({ cik });
  if (q.isLoading) return <div className="t-mono text-[11px] text-muted-foreground">loading institutional…</div>;
  const d = q.data;
  if (!d?.quarterDate) return null;
  const money = (v: number | null) => v === null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
  const shr = (v: number | null) => v === null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString("en-US");
  return (
    <div className="t-panel px-5 py-4">
      <div className="t-label mb-2">Institutional ownership (13F) — quarter {d.quarterDate} · QoQ vs {d.previousQuarterDate ?? "n/a"}</div>
      {d.guard && (
        <div className="t-mono text-[10px] text-muted-foreground mb-2" title={d.guard.warnings.join("\n")}>
          stable funds {d.guard.stableFunds} · coverage {d.guard.curFunds}/{d.guard.expectedFunds} · excluded {d.guard.missingFunds + d.guard.suspectFunds}{d.guard.partial ? " · partial" : ""}
          {d.guard.warnings.length > 0 && <span className="text-amber-400"> — {d.guard.warnings[0]}</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-x-8 gap-y-2 t-mono text-[12px] mb-3">
        <span>holders: <b>{d.holders}</b></span>
        <span>held: <b>{shr(d.sharesHeld)} sh</b> ({money(d.valueUsd)})</span>
        <span>of shares out: <b>{d.ownershipPct === null ? "—" : `${d.ownershipPct}%`}</b></span>
        <span className={d.qoqSharesDeltaPct === null ? "text-muted-foreground" : d.qoqSharesDeltaPct >= 0 ? "text-emerald-400" : "text-crit-red"}>
          QoQ: {d.qoqSharesDeltaPct === null ? "—" : `${d.qoqSharesDeltaPct >= 0 ? "+" : ""}${d.qoqSharesDeltaPct}%`}
        </span>
      </div>
      <div className="divide-y divide-[hsl(var(--border)/0.5)]">
        {d.top.map((t) => (
          <div key={t.fundName} className="py-1 flex items-center gap-3 t-mono text-[11px]">
            <span className="flex-1 truncate">{t.fundName}</span>
            <span className="text-muted-foreground uppercase text-[9px]">{t.tier}</span>
            <span>{shr(t.shares)} sh</span>
            <span className="text-muted-foreground">{money(t.valueUsd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signals panel (4j/4k, D43) — the signals encyclopedia surface: 7-day
// aggregates per source (mean tone, total buzz) + the recent signal stream.
// Every row carries the no-lookahead pair (eventTs / ingestedAt).
// ---------------------------------------------------------------------------
function SignalsPanel({ cik, ticker }: { cik: number; ticker?: string }) {
  const q = trpc.company.signals.useQuery({ cik });
  // 5e: quarterly briefs (home-LLM, derived from this company's filing notes)
  const briefs = trpc.digests.byCompany.useQuery({ ticker: ticker ?? "" }, { enabled: !!ticker });
  if (q.isLoading) return <div className="t-mono text-[11px] text-muted-foreground">loading signals…</div>;
  const rows = q.data?.recent ?? [];
  const aggs = q.data?.aggregates ?? [];
  const briefList = briefs.data ?? [];
  return (
    <div className="space-y-4">
      {briefList.length > 0 && (
        <div className="t-panel px-5 py-4">
          <div className="t-label mb-3">Quarterly briefs — home LLM, derived from filing notes (verify against sources)</div>
          <div className="space-y-3">
            {briefList.map((b) => (
              <details key={b.id} className="group">
                <summary className="t-mono text-[11px] cursor-pointer text-[hsl(var(--live))] select-none">
                  quarter ending {b.forDate} <span className="text-muted-foreground group-open:hidden">— open</span>
                </summary>
                <div className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90 border-l-2 border-[hsl(var(--live)/0.3)] pl-3">
                  {b.body}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
      <div className="t-panel px-5 py-4">
        <div className="t-label mb-3">7-day aggregates by source</div>
        <div className="flex flex-wrap gap-2">
          {aggs.map((a: any) => (
            <span key={`${a.source}|${a.signalType}`} className="t-mono text-[10px] px-2 py-1 rounded border border-[hsl(var(--live)/0.3)]">
              {a.source} · {a.signalType}: {a.signalType === "tone" && a.avgScore !== null ? `tone ${(Number(a.avgScore) >= 0 ? "+" : "") + Number(a.avgScore).toFixed(2)} · ` : ""}n={Number(a.n)}{a.signalType === "buzz" ? ` · ${Number(a.totalMagnitude)} mentions` : ""}
            </span>
          ))}
          {aggs.length === 0 && <span className="t-mono text-[10px] text-muted-foreground">NO SIGNALS IN THE LAST 7 DAYS</span>}
        </div>
      </div>
      <div className="t-panel px-5 py-4">
        <div className="t-label mb-3">Signal stream</div>
        <div className="divide-y divide-[hsl(var(--border)/0.5)] max-h-96 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="py-1.5">
              <div className="flex items-center gap-3 t-mono text-[10px]">
                <span className="text-muted-foreground shrink-0">{String(r.eventTs).slice(0, 16).replace("T", " ")}</span>
                <span className="px-1.5 py-0.5 border rounded-sm text-[9px] border-[hsl(var(--live)/0.4)] text-[hsl(var(--live))] uppercase">{r.source}</span>
                <span className="text-muted-foreground uppercase">{r.signalType}</span>
                {r.score !== null && (
                  <span className={r.score >= 0 ? "text-[hsl(var(--live))]" : "text-[hsl(var(--crit))]"}>
                    {r.score >= 0 ? "+" : ""}{r.score.toFixed(2)}
                  </span>
                )}
                {r.magnitude !== null && r.signalType === "buzz" && <span className="text-muted-foreground">×{r.magnitude}</span>}
                {r.src === "backfill" && <span className="text-[9px] text-[hsl(var(--warn))]">BACKFILL</span>}
              </div>
              {r.note && <div className="mt-0.5 pl-1 text-[10px] text-muted-foreground">{r.note}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="t-mono text-[9px] text-muted-foreground/70 uppercase tracking-[0.08em]">
        collectors run on the home worker (Variant C) — GDELT tone + Stocktwits labels first · point-in-time by eventTs/ingestedAt
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Short interest panel (4m, D46) — settlement-dated SI: % of float, days-to-
// cover, Δ shares vs the prior settlement. Overlay factor (Boehmer–Huszar–
// Jordan 2010), never a standalone signal.
// ---------------------------------------------------------------------------
function ShortInterestPanel({ cik }: { cik: number }) {
  const q = trpc.company.shortInterest.useQuery({ cik });
  if (!q.data || !q.data.current) return null; // no SI coverage — hide honestly
  const { current, prior, deltaShares } = q.data;
  const pctFloat = current.shortPercentOfFloat !== null ? (current.shortPercentOfFloat * 100).toFixed(2) + "%" : "—";
  return (
    <div className="t-panel px-5 py-4">
      <div className="t-label mb-3">Short interest (settlement-dated)</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
        <div>
          <div className="t-label !text-[9px]">% of float</div>
          <div className="t-mono text-[14px] mt-0.5">{pctFloat}</div>
        </div>
        <div>
          <div className="t-label !text-[9px]">Days to cover</div>
          <div className="t-mono text-[14px] mt-0.5">{current.shortRatio !== null ? current.shortRatio.toFixed(2) : "—"}</div>
        </div>
        <div>
          <div className="t-label !text-[9px]">Δ vs prior settlement</div>
          <div className={`t-mono text-[14px] mt-0.5 ${deltaShares !== null && deltaShares > 0 ? "text-[hsl(var(--crit))]" : "text-[hsl(var(--live))]"}`}>
            {deltaShares === null ? "—" : `${deltaShares > 0 ? "+" : ""}${(deltaShares / 1e6).toFixed(1)}M sh`}
          </div>
        </div>
        <div>
          <div className="t-label !text-[9px]">As of</div>
          <div className="t-mono text-[12px] mt-0.5 text-muted-foreground">{current.settlementDate} · {current.source}</div>
        </div>
      </div>
      {prior && (
        <div className="t-mono text-[9px] text-muted-foreground/70 mt-2 uppercase tracking-[0.06em]">
          prior settlement {prior.settlementDate}: {prior.sharesShort !== null ? (prior.sharesShort / 1e6).toFixed(1) + "M short" : "—"} · biweekly by construction (FINRA cadence)
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function Company() {
  const { ticker = "" } = useParams<{ ticker: string }>();
  // the overview query resolves ticker → cik; every other section works by
  // cik (the stable SEC identifier, unlike changeable tickers), so they are
  // not rendered until cik is known
  const ov = trpc.company.overview.useQuery({ ticker });
  const cik = ov.data?.company.cik;
  // Declutter (3c): the Sentiment tab exists only when the company actually
  // has LLM scores — an always-visible empty tab is noise for the user.
  const hasScores = (ov.data?.counts.scores ?? 0) > 0;
  // 4j (D43): the Signals tab appears only with actual signal coverage
  const hasSignals = (ov.data?.counts.signals ?? 0) > 0;

  const tabs = ["overview", "fundamentals", "value", "documents"];
  if (hasScores) tabs.push("sentiment");
  if (hasSignals) tabs.push("signals");

  return (
    <AppLayout title={`Company · ${ticker.toUpperCase()}`}>
      <Tabs defaultValue="overview">
        <TabsList className="t-panel !bg-[hsl(var(--secondary)/0.4)] h-9 mb-4">
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t} className="t-mono text-[10px] uppercase tracking-[0.12em]">{t}</TabsTrigger>
          ))}
        </TabsList>
        {/* Layout (3f): price block (quote header + chart + stats grid) on
            TOP; our corpus statistics, the company card and the data-health
            rollup moved BELOW it (user directive — price view first).
            Company Health was merged into Overview (3c): the rollup panel is
            part of <Overview/>, the flagged-series list follows below it. */}
        <TabsContent value="overview">
          {cik && <PriceOverview cik={cik} />}
          <div className="mt-4">
            <Overview ticker={ticker.toUpperCase()} />
          </div>
          {cik && (
            <div className="mt-4">
              <DataHealth cik={cik} />
            </div>
          )}
          {cik && (
            <div className="mt-4">
              <InsiderPanel cik={cik} />
            </div>
          )}
          {cik && (
            <div className="mt-4 space-y-4">
              <InstitutionalPanel cik={cik} />
              <ShortInterestPanel cik={cik} />
            </div>
          )}
        </TabsContent>
        <TabsContent value="fundamentals">{cik ? <Fundamentals cik={cik} /> : null}</TabsContent>
        {/* 4i (D41): factor library + intrinsic value panel */}
        <TabsContent value="value">{cik ? <ValuePanel cik={cik} /> : null}</TabsContent>
        <TabsContent value="documents">{cik ? <FilingsAndDocuments cik={cik} /> : null}</TabsContent>
        {hasScores && <TabsContent value="sentiment">{cik ? <SentimentPanel cik={cik} /> : null}</TabsContent>}
        {hasSignals && <TabsContent value="signals">{cik ? <SignalsPanel cik={cik} ticker={ticker} /> : null}</TabsContent>}
      </Tabs>
    </AppLayout>
  );
}
