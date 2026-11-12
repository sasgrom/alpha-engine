/** Number and date formatting for the desk view. Dates in the snapshot are plain YYYY-MM-DD trading dates. */
const MINUS = "−";
const DASH = "—";

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 0.0123 → "+1.2%"; a true minus sign for negatives; zero after rounding carries no sign. */
export function fmtPct(value: number | null | undefined, digits = 1, signed = true): string {
  if (!finite(value)) return DASH;
  const text = Math.abs(value * 100).toFixed(digits);
  if (Number(text) === 0) return `${(0).toFixed(digits)}%`;
  return `${value < 0 ? MINUS : signed ? "+" : ""}${text}%`;
}

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (!finite(value)) return DASH;
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return value < 0 && Number(Math.abs(value).toFixed(digits)) !== 0 ? `${MINUS}${text}` : text;
}

export function fmtPrice(value: number | null | undefined): string {
  if (!finite(value)) return DASH;
  return `$${fmtNum(value, value < 1 ? 4 : 2)}`;
}

/** 5.1e12 → "$5.10T", 8.12e11 → "$812B", 9.4e9 → "$9.40B", 7.5e8 → "$750M". */
export function fmtCap(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return DASH;
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, unit] of units) {
    if (value >= size) {
      const scaled = value / size;
      return `$${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(2)}${unit}`;
    }
  }
  return `$${value.toFixed(0)}`;
}

/** 12_900 → "12.9K", 4_200_000 → "4.2M". */
export function fmtCompact(value: number | null | undefined): string {
  if (!finite(value)) return DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function asDate(date: string): Date {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`);
}

export function fmtDate(date: string | null | undefined, style: "short" | "medium" | "weekday" | "long" = "medium"): string {
  if (!date) return DASH;
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "short", day: "numeric", timeZone: "UTC" }
      : style === "weekday"
        ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }
        : style === "long"
          ? { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }
          : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return asDate(date).toLocaleDateString("en-US", options);
}

/** A full timestamp in the viewer's local time: "Nov 11, 4:20 PM". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return DASH;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Report text as a person reads it: no HTML from upstream error pages, timestamps in local time. */
export function readable(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g, (iso) => fmtDateTime(iso))
    .replace(/\s+/g, " ")
    .trim();
}

export function daysBetween(from: string, to: string): number {
  return Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago" relative to a reference trading date. */
export function relativeDay(date: string, reference: string): string {
  const days = daysBetween(reference, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** The viewer's calendar date as YYYY-MM-DD (relative labels count from today, not from the data's session). */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function titleWord(word: string): string {
  // initials and dotted abbreviations (T., N.A., L.P.) and vowel-less acronyms (FMR, LLC) keep their capitals
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (letters.length <= 1 || /^([A-Z]\.){2,}/.test(word) || !/[AEIOUY]/.test(letters)) return word;
  if (["PLC", "ETF", "USA", "UBS", "AXA", "BNY", "IBM", "AT&T"].includes(word.replace(/[,.;]$/, ""))) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * "STATE STREET CORP (STT, STT-PG) (CIK 0000093751)" → "State Street Corp". Mixed-case names are kept.
 * Stored names are cut at 128 characters, so a ticker list can end without its closing bracket; both patterns are
 * single character classes (linear time) — a nested quantifier here once froze on exactly such a name.
 */
export function entityName(raw: string | null | undefined): string {
  const name = (raw ?? "")
    .replace(/\s*\(CIK[\s\d]*\)?/gi, "")
    .replace(/\s*\([A-Z0-9.,\-/\s]*\)/g, "")
    .replace(/\s*\([A-Z0-9.,\-/\s]*$/, "")
    .replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || /[a-z]/.test(name)) return name;
  return name.split(" ").map(titleWord).join(" ");
}

const ENTITY_WORDS = /\b(LLC|L\.?P\.?|INC|CORP|CO|FUND|TRUST|CAPITAL|PARTNERS|HOLDINGS|GROUP|MANAGEMENT|ASSOCIATES|VENTURES|FOUNDATION|BANK|LTD|PLC|ADVISORS|INVESTMENTS)\b/i;
const NAME_SUFFIX = /^(JR|SR|II|III|IV)\.?$/i;

/**
 * Form 4 lists people as "Last First Middle"; shown as "First Middle Last" (a generational suffix stays last).
 * Names of entities, or anything that does not look like two to four plain name parts, are left as filed.
 */
export function personName(raw: string | null | undefined): string {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  const parts = name.split(" ");
  if (parts.length < 2 || parts.length > 4 || name.includes(",") || ENTITY_WORDS.test(name) || !parts.every((part) => /^[A-Za-z.'-]+$/.test(part))) return name;
  const cased = /[a-z]/.test(name) ? parts : parts.map((part) => part.charAt(0) + part.slice(1).toLowerCase());
  const suffix = NAME_SUFFIX.test(cased.at(-1)!) ? [cased.pop()!] : [];
  if (cased.length < 2) return name;
  const [last, ...rest] = cased;
  return [...rest, last, ...suffix].join(" ");
}

export type StatusKind = "ok" | "warning" | "error" | "critical" | "pending" | "unknown";

/** Operations states of the reports and job runs mapped onto the four reserved status levels. */
export function statusKind(value: string | null | undefined): StatusKind {
  const v = String(value ?? "").toLowerCase();
  if (v === "ok" || v === "done" || v === "online" || v === "healthy" || v === "complete") return "ok";
  if (v === "warning" || v === "stale" || v === "partial" || v === "degraded") return "warning";
  if (v === "critical") return "critical";
  if (v === "error" || v === "failed" || v === "offline") return "error";
  if (v === "pending" || v === "queued" || v === "running" || v === "scheduled") return "pending";
  return "unknown";
}

export type Tone = "up" | "down" | "flat";

export function tone(value: number | null | undefined): Tone {
  if (!finite(value) || Math.abs(value) < 0.00005) return "flat";
  return value > 0 ? "up" : "down";
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}
