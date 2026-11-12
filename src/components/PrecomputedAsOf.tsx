interface PrecomputedAsOfProps {
  asOf: string | null;
  stale: boolean;
  dataMode: "precomputed" | "on_request";
  label?: string;
}

export default function PrecomputedAsOf({ asOf, stale, dataMode, label = "data" }: PrecomputedAsOfProps) {
  if (dataMode !== "precomputed" || !asOf) return null;
  return (
    <span className={`t-mono text-[9px] font-normal normal-case ${stale ? "text-amber-400" : "text-muted-foreground"}`} title={asOf}>
      {label} as of {asOf.replace("T", " ").slice(0, 16)}Z{stale ? " · stale" : ""}
    </span>
  );
}
