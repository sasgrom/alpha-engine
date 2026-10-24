/**
 * ValuePanel (4i, D41; 4j: readable signals + wiki popovers) — the company
 * page's Value tab: the factor library snapshot with per-factor signal chips
 * (▲/▼/—), reference bands (literature thresholds or the company's own
 * robust median+IQR), touch-friendly (i) popovers, and full wiki entries at
 * /wiki. Honesty: computed in-house; nulls render "—"; ranges, never points.
 */
import { trpc } from "@/providers/trpc";
import { Link } from "react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BookOpen, Info } from "lucide-react";
import { FactorCard, SignalChip } from "@/components/FactorCard";
import { factorMeta } from "../../api/services/factor-meta";

const pct = (v: number | null, d = 1) => (v === null ? "—" : (v * 100).toFixed(d) + "%");
const money = (v: number | null) => {
  if (v === null) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M";
  return "$" + v.toFixed(0);
};

/** Inline (i) popover for the intrinsic-value cells (4j, touch-friendly). */
function InfoPop({ metaKey }: { metaKey: string }) {
  const m = factorMeta(metaKey);
  if (!m) return null;
  return (
    <Popover>
      <PopoverTrigger className="text-muted-foreground/60 hover:text-[hsl(var(--live))] transition-colors align-middle ml-1" aria-label={`About ${m.name}`}>
        <Info size={10} />
      </PopoverTrigger>
      <PopoverContent className="t-panel !bg-[hsl(var(--card))] w-72 p-3" sideOffset={6}>
        <div className="t-mono text-[10px] font-semibold text-[hsl(var(--live))] mb-1.5">{m.name}</div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{m.shortHint}</p>
        <div className="t-mono text-[9px] text-muted-foreground/70 mt-2 uppercase tracking-[0.06em]">{m.formula}</div>
        <Link to={`/wiki#${m.key}`} className="t-mono text-[10px] text-[hsl(var(--live))] hover:underline inline-block mt-2">
          OPEN FULL WIKI ENTRY →
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** A labeled intrinsic-value cell with wiki popover + signal chip. */
function ValueCell({ metaKey, children, chip }: { metaKey: string; children: React.ReactNode; chip?: "up" | "down" | "neutral" | null }) {
  const m = factorMeta(metaKey);
  return (
    <div>
      <div className="t-label !text-[9px]">
        {m?.name ?? metaKey}
        <InfoPop metaKey={metaKey} />
      </div>
      <div className="t-mono text-[14px] font-semibold mt-0.5">{children}</div>
      {chip !== undefined && <div className="mt-1"><SignalChip s={chip} /></div>}
    </div>
  );
}

export default function ValuePanel({ cik }: { cik: number }) {
  const f = trpc.company.factors.useQuery({ cik });
  const v = trpc.company.value.useQuery({ cik });

  if (f.isLoading || v.isLoading) return <div className="t-mono text-[11px] text-muted-foreground">computing factors…</div>;
  if (!f.data || !v.data) return <div className="t-mono text-[11px] text-muted-foreground">NO FACTOR DATA — RUN series + prices JOBS FIRST</div>;
  const fac = f.data;
  const val = v.data;

  const beneishFlag = fac.beneishM !== null && fac.beneishM > -1.78;
  return (
    <div className="space-y-4">
      {/* intrinsic value */}
      <div className="t-panel px-5 py-4">
        <div className="t-label mb-3 flex items-center justify-between">
          <span>Intrinsic value — expectations read (ranges, not point estimates)</span>
          <Link to="/wiki" className="t-mono text-[9px] text-[hsl(var(--live))] hover:underline inline-flex items-center gap-1 normal-case">
            <BookOpen size={10} /> FACTOR WIKI
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3">
          <ValueCell metaKey="impliedGrowth" chip={factorMeta("impliedGrowth")?.signal(
            val.impliedGrowthPct !== null && val.fcfCagrPct !== null ? val.impliedGrowthPct / 100 : null,
            val.fcfCagrPct !== null ? val.fcfCagrPct / 100 : null
          )}>
            {val.impliedGrowthPct === null ? "—" : `${val.impliedGrowthPct.toFixed(1)}%`}
          </ValueCell>
          <div>
            <div className="t-label !text-[9px]" title="Historical FCF CAGR from our quarterly series">FCF CAGR (our data)</div>
            <div className="t-mono text-[18px] font-semibold mt-0.5">{val.fcfCagrPct === null ? "—" : `${val.fcfCagrPct.toFixed(1)}%`}</div>
          </div>
          <div>
            <div className="t-label !text-[9px]">WACC used</div>
            <div className="t-mono text-[18px] mt-0.5">{pct(val.wacc)}</div>
          </div>
          <div>
            <div className="t-label !text-[9px]" title="Residual income (EBO/Ohlson), bear/base/bull vs market cap">Residual income range</div>
            <div className="t-mono text-[12px] mt-0.5">
              {val.rim ? `${money(val.rim.bear)} · ${money(val.rim.base)} · ${money(val.rim.bull)}` : "—"}
            </div>
            <div className="t-mono text-[9px] text-muted-foreground">vs market cap {money(val.marketCap)}</div>
          </div>
          <div>
            <div className="t-label !text-[9px]" title="Greenwald earnings power value — zero-growth floor">EPV floor</div>
            <div className="t-mono text-[12px] mt-0.5">{money(val.epv)}</div>
          </div>
          <ValueCell metaKey="vpRatio" chip={factorMeta("vpRatio")?.signal(val.vpRatio, null)}>
            {val.vpRatio === null ? "—" : val.vpRatio.toFixed(2)}
            <span className="text-muted-foreground"> · </span>
            <span title="P/E z-score vs own 5Y history">{val.peZ === null ? "—" : (val.peZ >= 0 ? "+" : "") + val.peZ.toFixed(2)}</span>
            <InfoPop metaKey="peZ" />
          </ValueCell>
        </div>
        {val.impliedGrowthPct !== null && val.fcfCagrPct !== null && (
          <div className="t-mono text-[10px] mt-3 pt-2 border-t border-[hsl(var(--border)/0.5)]">
            {val.impliedGrowthPct > val.fcfCagrPct
              ? <span className="text-[hsl(var(--crit))]">MARKET PRICES MORE GROWTH THAN HISTORY DELIVERS ({val.impliedGrowthPct.toFixed(1)}% implied vs {val.fcfCagrPct.toFixed(1)}% historical)</span>
              : <span className="text-[hsl(var(--live))]">MARKET PRICES LESS GROWTH THAN HISTORY DELIVERS ({val.impliedGrowthPct.toFixed(1)}% implied vs {val.fcfCagrPct.toFixed(1)}% historical)</span>}
          </div>
        )}
      </div>

      {/* factor cards — 4j: signal chips + own-history bands + (i) popovers */}
      <div className="t-panel px-5 py-4">
        <div className="t-label mb-3">Factor library (D41) · as of {fac.asOfQuarter ?? "—"} · {f.data.fresh ? "fresh" : "cached"}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["accruals", "grossProfitability", "assetGrowth", "buybackYield", "momentum122", "high52", "sue"] as const).map((k) => {
            const m = factorMeta(k)!;
            // 4l hotfix: `detail` arrived in 4j — a pre-4j cached payload lacks
            // it; never crash the tree on a stale cache (the server also
            // rebuilds stale keys, this is the belt to its suspenders)
            const d = fac.detail?.[k];
            return (
              <FactorCard
                key={k}
                meta={m}
                value={d?.value ?? null}
                unit={k === "accruals" || k === "grossProfitability" || k === "assetGrowth" || k === "buybackYield" || k === "momentum122" ? "pct" : "num"}
                band={d?.band ?? null}
              />
            );
          })}
          <FactorCard meta={factorMeta("altmanZ")!} value={fac.altmanZ} unit="num" />
        </div>
      </div>

      {/* F-score + Beneish — threshold-referenced by literature */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="t-panel px-5 py-4">
          <div className="t-label mb-1 flex items-center justify-between">
            <span>Piotroski F-score — {fac.fScore.score}/9</span>
            <span className="flex items-center gap-2">
              <SignalChip s={factorMeta("fScore")?.signal(fac.fScore.score, null) ?? null} />
              <InfoPop metaKey="fScore" />
            </span>
          </div>
          <div className="t-mono text-[9px] text-muted-foreground/70 mb-3 uppercase tracking-[0.05em]">ref: ≥7 strong · 3–6 middling · ≤2 weak</div>
          <div className="space-y-1.5">
            {fac.fScore.signals.map((s) => (
              <div key={s.key} className="flex items-center gap-2 t-mono text-[11px]">
                <span className={`led ${s.pass === true ? "led-ok" : s.pass === false ? "led-crit" : "led-off"}`} />
                <span className={s.pass === null ? "text-muted-foreground/50" : ""}>{s.key}</span>
                {s.pass === null && <span className="t-mono text-[9px] text-muted-foreground/50 ml-auto">n/a</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="t-panel px-5 py-4">
          <div className="t-label mb-1 flex items-center justify-between">
            <span>Beneish M-score — {fac.beneishM === null ? "—" : fac.beneishM.toFixed(2)}</span>
            <span className="flex items-center gap-2">
              <SignalChip s={factorMeta("beneishM")?.signal(fac.beneishM, null) ?? null} />
              <InfoPop metaKey="beneishM" />
            </span>
          </div>
          <div className="t-mono text-[9px] text-muted-foreground/70 mb-3 uppercase tracking-[0.05em]">ref: −1.78 is the published flag line</div>
          <div className={`t-mono text-[12px] ${beneishFlag ? "text-[hsl(var(--crit))]" : "text-[hsl(var(--ok))]"}`}>
            {fac.beneishM === null ? "not computable from our data" : beneishFlag ? "M > −1.78 — manipulation-risk zone; pairs with our revision metrics" : "M ≤ −1.78 — no manipulation signal"}
          </div>
          <div className="t-mono text-[9px] text-muted-foreground mt-3 leading-relaxed uppercase tracking-[0.06em]">
            All factors computed in-house from our series + prices (D22). Sector medians arrive with the full registry — finals-phase TODO.
          </div>
        </div>
      </div>

      <FactorIcCard cik={cik} />
    </div>
  );
}

/** 6a — factor IC vs forward 1Q/2Q returns. The factor-evaluation layer:
 *  NOT a trading signal (no cost model yet), and n is shown always. */
function FactorIcCard({ cik }: { cik: number }) {
  const q = trpc.company.factorIc.useQuery({ cik });
  if (q.isLoading) return <div className="t-mono text-[11px] text-muted-foreground">computing factor IC…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  const oneQ = rows.filter((r) => r.horizon === 63 && r.n >= 5);
  const twoQ = rows.filter((r) => r.horizon === 126 && r.n >= 5);
  if (oneQ.length === 0 && twoQ.length === 0) return null;
  return (
    <div className="t-panel px-5 py-4">
      <div className="t-label mb-1 flex items-center justify-between">
        <span>Factor IC vs forward returns (sourceFiled-anchored)</span>
        <span className="t-mono text-[9px] text-muted-foreground/70">evaluation layer — not a trading signal</span>
      </div>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
        {oneQ.map((r) => (
          <div key={r.factor} className="flex items-center gap-3 t-mono text-[11px]">
            <span className="flex-1 truncate">{r.factor}</span>
            <span className="text-muted-foreground">n={r.n}</span>
            <span className={r.spearman !== null && r.spearman >= 0 ? "text-emerald-400" : "text-crit-red"}>
              1Q r {r.pearson?.toFixed(2) ?? "—"} / rho {r.spearman?.toFixed(2) ?? "—"}
            </span>
            {twoQ.find((t) => t.factor === r.factor) && (
              <span className="text-muted-foreground">
                2Q rho {twoQ.find((t) => t.factor === r.factor)!.spearman?.toFixed(2) ?? "—"}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="t-mono text-[9px] text-muted-foreground/70 mt-3 uppercase tracking-[0.06em]">
        IC = correlation of factor value at filing time with forward 63/126-day return. Costs & turnover not modeled yet.
      </div>
    </div>
  );
}
