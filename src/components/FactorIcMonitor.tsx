/**
 * FactorIcMonitor (6a) — cross-sectional factor IC by quarter for the owner.
 * Per factor: mean Spearman rho over quarters, per-quarter sparkline of r/rho.
 * n is always shown (tiny samples are marked). Evaluation layer, not a signal.
 */
import { trpc } from "@/providers/trpc";

export function FactorIcMonitor() {
  const q = trpc.admin.factorIc.useQuery(undefined, { retry: false, refetchInterval: 300000 });
  if (q.isError) return null;
  const rows = (q.data ?? []).filter((r) => r.horizon === 63);
  if (rows.length === 0) return null;

  const byFactor = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byFactor.has(r.factor)) byFactor.set(r.factor, []);
    byFactor.get(r.factor)!.push(r);
  }
  const factors = [...byFactor.entries()].map(([factor, rs]) => {
    const sorted = [...rs].sort((a, b) => a.quarter.localeCompare(b.quarter));
    const usable = sorted.filter((r) => r.n >= 3 && r.spearman !== null);
    const mean = usable.length ? usable.reduce((a, r) => a + (r.spearman ?? 0), 0) / usable.length : null;
    const lastQ = sorted[sorted.length - 1]?.quarter;
    return { factor, sorted, mean, lastQ, nQ: usable.length };
  }).sort((a, b) => (b.mean ?? -2) - (a.mean ?? -2));

  return (
    <div className="panel p-4 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="t-mono text-[12px] font-semibold">Factor IC monitor — cross-section, forward 1Q returns</span>
        <span className="t-mono text-[10px] text-muted-foreground ml-auto">mean Spearman ρ by quarter · evaluation layer</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        Per quarter: rank of the factor across companies vs rank of the next-63-trading-day return. Mean over quarters. Quarters with n&lt;3 companies are excluded from the mean.
      </p>
      <table className="w-full border-collapse t-mono text-[12px]">
        <thead>
          <tr>
            <th className="border border-border/60 bg-muted/40 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">factor</th>
            <th className="border border-border/60 bg-muted/40 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">mean ρ</th>
            <th className="border border-border/60 bg-muted/40 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">quarters</th>
            <th className="border border-border/60 bg-muted/40 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">last quarter</th>
            <th className="border border-border/60 bg-muted/40 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">per-quarter ρ (oldest → latest)</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((f) => (
            <tr key={f.factor}>
              <td className="border border-border/40 px-3 py-1.5">{f.factor}</td>
              <td className={`border border-border/40 px-3 py-1.5 font-semibold ${f.mean !== null && f.mean >= 0 ? "text-emerald-400" : "text-crit-red"}`}>
                {f.mean === null ? "—" : f.mean.toFixed(3)}
              </td>
              <td className="border border-border/40 px-3 py-1.5">{f.nQ}</td>
              <td className="border border-border/40 px-3 py-1.5 text-muted-foreground">{f.lastQ}</td>
              <td className="border border-border/40 px-3 py-1.5 text-muted-foreground text-[10px]">
                {f.sorted.slice(-8).map((r) => (
                  <span key={r.quarter} className={r.spearman === null ? "" : r.spearman >= 0 ? "text-emerald-400/80" : "text-crit-red/80"}>
                    {r.spearman?.toFixed(2) ?? "—"}{" "}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
