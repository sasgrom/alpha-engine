/**
 * Project toast helper (iteration 3d): every notification lives 8 seconds
 * and carries a Mac-style circular countdown ring that visually depletes.
 * The ring is pure CSS (stroke-dashoffset animation); sonner pauses its
 * dismiss timer on hover and the ring pauses with it (see index.css:
 * `[data-sonner-toast]:hover .job-toast-ring-fg`).
 *
 * Use jobToast(...) everywhere instead of toast.success/error/warning so
 * the duration + ring stay consistent across the app.
 */
import { toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";

export const TOAST_DURATION_MS = 8000;

type ToastKind = "success" | "error" | "warning" | "info";

// Ring geometry: r=9 in a 22px box, circumference drives the dash animation.
const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

const KIND_STYLE: Record<
  ToastKind,
  { color: string; Icon: typeof CheckCircle2 }
> = {
  success: { color: "hsl(var(--live))", Icon: CheckCircle2 },
  error: { color: "hsl(var(--destructive))", Icon: XCircle },
  warning: { color: "hsl(var(--warn))", Icon: AlertTriangle },
  info: { color: "hsl(var(--muted-foreground))", Icon: Info },
};

function RingToast({
  kind,
  title,
  description,
}: {
  kind: ToastKind;
  title: string;
  description?: ReactNode;
}) {
  const { color, Icon } = KIND_STYLE[kind];
  return (
    <div className="t-panel flex items-center gap-3 rounded-md border border-border px-3.5 py-3 shadow-lg w-[340px]">
      {/* countdown ring: foreground arc drains over TOAST_DURATION_MS */}
      <span className="relative shrink-0 inline-flex items-center justify-center" style={{ width: 22, height: 22 }}>
        <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90 absolute inset-0">
          <circle cx="11" cy="11" r={RING_R} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="2" />
          <circle
            cx="11"
            cy="11"
            r={RING_R}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            className="job-toast-ring-fg"
          />
        </svg>
        <Icon size={10} style={{ color }} strokeWidth={2.25} />
      </span>
      <span className="min-w-0">
        <span className="block t-mono text-[11px] uppercase tracking-[0.12em] text-foreground truncate">
          {title}
        </span>
        {description ? (
          <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug break-words">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Fires a custom toast with the 8s depleting ring. */
export function jobToast(kind: ToastKind, title: string, description?: ReactNode) {
  toast.custom(() => <RingToast kind={kind} title={title} description={description} />, {
    duration: TOAST_DURATION_MS,
  });
}
