/**
 * Human-readable job descriptions for the job queue (Jobs page) and the
 * admin log browser. A bare "bootstrap DONE" row says nothing about WHAT
 * ran — this helper unfolds jobs.params JSON into a one-line summary.
 *
 * Kept on the frontend (params travel as JSON text in the job row) so the
 * API payload stays unchanged.
 */

/** Safe params parse: jobs.params is JSON text, legacy rows may be null/garbage. */
function parseParams(params: string | null | undefined): Record<string, unknown> {
  if (!params) return {};
  try {
    const v = JSON.parse(params);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Compact scope label: explicit lists stay as-is, named scopes uppercase. */
function scopeLabel(p: Record<string, unknown>): string {
  const base = String(p.tickers ?? "universe");
  const excl = String(p.exclude ?? "").split(",").filter(Boolean).length;
  return excl > 0 ? `${base} (−${excl} excluded)` : base;
}

/**
 * One-line job summary, e.g.:
 *   bootstrap · scope sp500 (−2 excluded) · forms 10-K/10-Q/8-K · facts
 *   score · scope AAPL,PLD · maxDocs 3 · pairwise
 */
export function describeJob(type: string, params: string | null | undefined): string {
  const p = parseParams(params);
  switch (type) {
    case "bootstrap": {
      const forms = String(p.forms ?? "10-K,10-Q,8-K").replace(/,/g, "/");
      return `scope ${scopeLabel(p)} · forms ${forms}${p.withFacts === false ? "" : " · facts"}`;
    }
    case "filings":
      return `scope ${scopeLabel(p)} · forms ${String(p.forms ?? "10-K,10-Q,8-K").replace(/,/g, "/")}`;
    case "facts":
      return `scope ${scopeLabel(p)} · XBRL facts refresh`;
    case "harvest": {
      const n = p.maxFilingsPerForm ?? p.maxFilings;
      return `scope ${scopeLabel(p)} · forms ${String(p.forms ?? "10-K,10-Q,8-K").replace(/,/g, "/")}${n ? ` · ≤${n}/form` : ""}`;
    }
    case "stream":
      return `scope ${scopeLabel(p)} · ${p.cycles ?? 1} cycles @ ${p.intervalSec ?? 300}s`;
    case "series":
      return `scope ${scopeLabel(p)} · series build`;
    case "sections":
      return `scope ${scopeLabel(p)} · section parse`;
    case "score":
      return `scope ${scopeLabel(p)} · maxDocs ${p.maxDocs ?? 3}${p.pairwise === false ? " · single-period" : " · pairwise"}`;
    case "prices":
      return p.mode === "import"
        ? `bulk import · archive batch ${String(p.batch ?? "").slice(0, 8)}… · universe tickers only`
        : `scope ${scopeLabel(p)} · ${p.mode === "backfill" ? "full backfill" : "incremental"} daily bars`;
    // 4b/4c (D29/D30): log-record micro-jobs from universe membership actions
    case "universe-add":
      return `${String(p.ticker ?? `CIK ${p.cik ?? "?"}`)} · added to the user's universe (data untouched)`;
    case "universe-remove":
      return `${String(p.ticker ?? `CIK ${p.cik ?? "?"}`)} · removed from the user's universe (data untouched)`;
    case "universe-restore": // deprecated 4b type — legacy rows only
      return `${String(p.ticker ?? `CIK ${p.cik ?? "?"}`)} · restored to universe view (as inactive)`;
    default:
      return "";
  }
}
