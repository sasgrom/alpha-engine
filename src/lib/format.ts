/**
 * Shared display formatters. Raw machine values stay in the DB untouched —
 * formatting happens at render time only.
 */

const FY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** fiscalYearEnd is stored as raw SEC MMDD ("1231", "0630") — render "Dec 31". */
export function fmtFyEnd(v: string | null | undefined): string {
  if (!v || !/^\d{4}$/.test(v)) return v ?? "—";
  const m = Number(v.slice(0, 2));
  const d = Number(v.slice(2));
  if (m < 1 || m > 12 || d < 1 || d > 31) return v;
  return `${FY_MONTHS[m - 1]} ${d}`;
}
