/**
 * FactorCard (4j) — one factor's readable tile: value + signal chip
 * (▲ favorable / ▼ unfavorable / — neutral, per factor-meta.ts rules), the
 * reference line (literature threshold or the company's own robust band), and
 * a touch-friendly (i) popover (radix Popover — click/tap opens, works on
 * iPad/iPhone) with the short hint + a link to the full wiki entry.
 */
import { Link } from "react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import type { FactorMeta } from "../../api/services/factor-meta";

const fmt = (v: number | null, unit: "pct" | "x" | "num" = "num") =>
  v === null ? "—" : unit === "pct" ? (v * 100).toFixed(1) + "%" : v.toFixed(2);

export function SignalChip({ s }: { s: "up" | "down" | "neutral" | null }) {
  if (s === "up")
    return (
      <span className="inline-flex items-center gap-1 t-mono text-[9px] px-1.5 py-0.5 rounded border border-[hsl(var(--live)/0.5)] text-[hsl(var(--live))]">
        <ArrowUpRight size={10} /> FAVORABLE
      </span>
    );
  if (s === "down")
    return (
      <span className="inline-flex items-center gap-1 t-mono text-[9px] px-1.5 py-0.5 rounded border border-[hsl(var(--crit)/0.5)] text-[hsl(var(--crit))]">
        <ArrowDownRight size={10} /> ADVERSE
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 t-mono text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
      <Minus size={10} /> NEUTRAL
    </span>
  );
}

export function FactorCard({
  meta,
  value,
  unit = "num",
  band,
}: {
  meta: FactorMeta;
  value: number | null;
  unit?: "pct" | "x" | "num";
  band?: { median: number; q25: number; q75: number } | null;
}) {
  const sig = meta.signal(value, band?.median ?? null);
  const toneCls = sig === "up" ? "text-[hsl(var(--live))]" : sig === "down" ? "text-[hsl(var(--crit))]" : "text-foreground";
  return (
    <div className="t-panel px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="t-label !text-[9px]">{meta.name}</div>
        {/* touch-friendly: radix Popover opens on tap/click, not only hover */}
        <Popover>
          <PopoverTrigger className="text-muted-foreground/60 hover:text-[hsl(var(--live))] transition-colors" aria-label={`About ${meta.name}`}>
            <Info size={11} />
          </PopoverTrigger>
          <PopoverContent className="t-panel !bg-[hsl(var(--card))] w-72 p-3" sideOffset={6}>
            <div className="t-mono text-[10px] font-semibold text-[hsl(var(--live))] mb-1.5">{meta.name}</div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{meta.shortHint}</p>
            <div className="t-mono text-[9px] text-muted-foreground/70 mt-2 uppercase tracking-[0.06em]">{meta.formula}</div>
            <Link to={`/wiki#${meta.key}`} className="t-mono text-[10px] text-[hsl(var(--live))] hover:underline inline-block mt-2">
              OPEN FULL WIKI ENTRY →
            </Link>
          </PopoverContent>
        </Popover>
      </div>
      <div className={`t-mono text-[16px] font-semibold mt-1 ${toneCls}`}>{fmt(value, unit)}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <SignalChip s={sig} />
      </div>
      <div className="t-mono text-[8px] text-muted-foreground/70 mt-1.5 uppercase tracking-[0.05em] leading-relaxed">
        {band ? (
          <>own median {fmt(band.median, unit)} · band {fmt(band.q25, unit)}…{fmt(band.q75, unit)}</>
        ) : (
          <>ref: {meta.reference}</>
        )}
      </div>
    </div>
  );
}
