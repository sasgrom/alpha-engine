import type { ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import type { DeskCompany } from "@contracts/desk-snapshot";
import { fmtPct, fmtPrice, statusKind, tone, type StatusKind } from "./format";

export function Delta({ value, digits = 1, className = "" }: { value: number | null | undefined; digits?: number; className?: string }) {
  return <span className={`desk-num desk-${tone(value)} ${className}`}>{fmtPct(value, digits)}</span>;
}

export function Card({ title, subtitle, action, children, className = "", flush = false }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`desk-card ${flush ? "flush" : ""} ${className}`}>
      {(title || action) && (
        <div className="desk-card-head" style={flush ? { padding: "18px 20px 0" } : undefined}>
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, delta, note, children }: { label: string; value: ReactNode; delta?: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="desk-kpi">
      <span className="desk-kpi-label">{label}</span>
      <span className="desk-kpi-value">{value}</span>
      {delta && <span className="desk-kpi-delta">{delta}</span>}
      {note && <span className="desk-kpi-note">{note}</span>}
      {children && <div className="desk-kpi-foot">{children}</div>}
    </div>
  );
}

/** Where the latest close sits inside the 52-week closing range. */
export function RangeBar({ low, high, value }: { low: number | null; high: number | null; value: number }) {
  if (low === null || high === null || high <= low) return <span className="desk-muted">—</span>;
  const position = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return (
    <div className="desk-range" aria-label={`52-week range ${fmtPrice(low)} to ${fmtPrice(high)}, latest ${fmtPrice(value)}`}>
      <div className="desk-range-track">
        <span className="desk-range-fill" style={{ width: `${position * 100}%` }} />
        <span className="desk-range-dot" style={{ left: `${position * 100}%` }} />
      </div>
      <div className="desk-range-labels">
        <span>{fmtPrice(low)}</span>
        <span>{fmtPrice(high)}</span>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div className="desk-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

const STATUS: Record<StatusKind, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "Healthy", color: "var(--d-good)", Icon: CheckCircle2 },
  warning: { label: "Warning", color: "var(--d-warning)", Icon: AlertTriangle },
  error: { label: "Error", color: "var(--d-critical)", Icon: XCircle },
  critical: { label: "Critical", color: "var(--d-critical)", Icon: XCircle },
  pending: { label: "Pending", color: "var(--d-muted)", Icon: CircleDashed },
  unknown: { label: "Unknown", color: "var(--d-muted)", Icon: CircleDashed },
};

/** Status is never color alone: an icon and a word ride with it. */
export function StatusLabel({ status, label }: { status: string | null | undefined; label?: string }) {
  const kind = statusKind(status);
  const { color, Icon, label: fallback } = STATUS[kind];
  return (
    <span className="desk-status">
      <Icon size={15} color={color} aria-hidden="true" />
      <span>{label ?? fallback}</span>
    </span>
  );
}

export function TickerMark({ ticker, size = 32 }: { ticker: string; size?: number }) {
  return (
    <span className="desk-company-logo" style={{ width: size, height: size, borderRadius: size / 4, fontSize: Math.max(10, size / 3.4) }} aria-hidden="true">
      {ticker.replace(/[^A-Z]/gi, "").slice(0, 4)}
    </span>
  );
}

/** A company link that starts loading the price history on hover, so the company page opens ready. */
export function CompanyLink({ company, className, children, ...rest }: { company: Pick<DeskCompany, "ticker" | "cik">; className?: string; children: ReactNode; style?: React.CSSProperties; "aria-label"?: string }) {
  const utils = trpc.useUtils();
  return (
    <Link
      to={`/desk/company/${encodeURIComponent(company.ticker)}`}
      className={className}
      onMouseEnter={() => void utils.prices.history.prefetch({ cik: company.cik, range: "1Y" }, { staleTime: 5 * 60_000 })}
      onFocus={() => void utils.prices.history.prefetch({ cik: company.cik, range: "1Y" }, { staleTime: 5 * 60_000 })}
      {...rest}
    >
      {children}
    </Link>
  );
}

export function Shimmer({ height = 18, width = "100%", style }: { height?: number; width?: number | string; style?: React.CSSProperties }) {
  return <div className="desk-shimmer" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="desk-notice" role="status">
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
