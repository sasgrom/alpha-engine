/**
 * 13F pipeline — pure logic (unit-tested), no DB, no fetch side effects.
 * Holdings are DETERMINISTIC data: parsed from the filing's XML information
 * table, mapped CUSIP→company via the cached crosswalk, events derived by
 * quarter-over-quarter deltas. No LLM anywhere in this module.
 *
 * KNOWN LIMITATION (documented honestly): option positions (PUT/CALL rows in
 * the information table) carry OCC option CUSIPs that OpenFIGI does not
 * resolve to the underlying's ticker — they are currently dropped at mapping.
 * Capturing hedges needs OCC symbology (strike/expiry parsing) — future work.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface FundEntry { cik: number; name: string; tier: string; aumUsd?: number }

export interface CusipCacheState { cik: number | null; ticker: string | null }

/** Unknown CUSIPs always need FIGI. A cached negative result is retried only
 * in explicit repair mode and at most once per run; ticker-only rows are left
 * to the local companies-registry repair, not sent back to FIGI. */
export function shouldRequestCusip(cached: CusipCacheState | undefined, repair: boolean, alreadyRetried: boolean): boolean {
  if (!cached) return true;
  return repair && cached.cik === null && !cached.ticker && !alreadyRetried;
}

/** Tiers that generate position EVENTS; "institutional" is aggregates-only (5g). */
export const SIGNAL_TIERS = new Set(["activist", "quant", "fundamental"]);

export function loadFundUniverse(file = "funds-13f.json"): FundEntry[] {
  return JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8"));
}

export interface Holding13F {
  issuer: string;
  cusip: string;
  /** titleOfClass: COM (default), PUT, CALL, PRN… — options are signals too */
  secClass: string;
  valueUsd: number | null; // filed in thousands → ×1000
  shares: number | null;
}

/** Parse a 13F information-table XML (namespace-agnostic). */
export function parseInfoTable(xml: string): Holding13F[] {
  const out: Holding13F[] = [];
  const blocks = xml.split(/<\s*\w*:?infoTable\s*>/i).slice(1);
  for (const b of blocks) {
    const pick = (tag: string): string | null => {
      const m = b.match(new RegExp(`<\\s*\\w*:?${tag}\\s*>\\s*([^<]+?)\\s*<\\s*/\\s*\\w*:?${tag}\\s*>`, "i"));
      return m ? m[1].trim() : null;
    };
    const cusip = pick("cusip");
    if (!cusip) continue;
    const v = pick("value");
    const sh = pick("sshPrnamt");
    // class normalization (prod QA): only PUT/CALL are special; share-class
    // labels ("COM CL A", "CAP STK CL A"…) are COM for pairing and notes
    const rawCls = (pick("titleOfClass") ?? "COM").toUpperCase();
    out.push({
      issuer: pick("nameOfIssuer") ?? "",
      cusip,
      secClass: rawCls === "PUT" || rawCls === "CALL" ? rawCls : "COM",
      valueUsd: v !== null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) : null,
      shares: sh !== null && Number.isFinite(Number(sh)) ? Number(sh) : null,
    });
  }
  return out;
}

/**
 * Scale auto-calibration (proven on Point72 2026-08-14): the 13F spec says
 * value is in THOUSANDS of USD, but some filers report actual DOLLARS. Detect
 * per FILING: median implied price (value/shares) over the book; a median
 * above $5,000 is impossible for a broad equity book (S&P 500 prices run
 * $1–$1,000; even BRK.A can't dominate a median) → the filing was dollars,
 * values are divided by 1000. Deterministic, logged by the caller.
 */
export function autoScale13F(holdings: Holding13F[]): { scale: number; medianImplied: number | null } {
  const implied = holdings
    .filter((h) => h.valueUsd !== null && h.shares !== null && h.shares > 0)
    .map((h) => (h.valueUsd as number) / (h.shares as number))
    .sort((a, b) => a - b);
  if (implied.length < 5) return { scale: 1, medianImplied: implied.length ? implied[Math.floor(implied.length / 2)] : null };
  const medianImplied = implied[Math.floor(implied.length / 2)];
  if (medianImplied > 5000) {
    for (const h of holdings) if (h.valueUsd !== null) h.valueUsd = Math.round(h.valueUsd / 1000);
    return { scale: 0.001, medianImplied };
  }
  return { scale: 1, medianImplied };
}

/** One filings-list row as we shape it from the submissions API. */
export interface Filing13F { accessionNo: string; form: string; filingDate: string; reportDate: string }

export type AmendmentKind = "ORIGINAL" | "RESTATEMENT" | "NEW HOLDINGS" | "UNKNOWN";
export interface QuarterFilingPart {
  accessionNo: string;
  filingDate: string;
  form: string;
  amendment: AmendmentKind;
  holdings: Holding13F[];
}
export interface ResolvedHolding extends Holding13F { sourceAccessionNo: string }

/** Read amendment semantics, not just the form suffix. Unknown amendments must
 * fail closed: treating one as a full book can erase 99% of a quarter. */
export function amendmentKindFromPrimary(primaryXml: string, form: string): AmendmentKind {
  if (form === "13F-HR") return "ORIGINAL";
  const m = primaryXml.match(/<(?:\w+:)?amendmentType>\s*([^<]+?)\s*<\/(?:\w+:)?amendmentType>/i);
  const kind = m?.[1]?.trim().toUpperCase();
  return kind === "RESTATEMENT" || kind === "NEW HOLDINGS" ? kind : "UNKNOWN";
}

/** Merge one quarter chronologically: a restatement replaces the current book;
 * NEW HOLDINGS adds rows to it. Duplicate cusip:class keys use the latest row. */
export function mergeQuarterFilings(parts: QuarterFilingPart[]): {
  holdings: ResolvedHolding[];
  latestAccessionNo: string;
  latestFilingDate: string;
} {
  const ordered = [...parts].sort((a, b) =>
    a.filingDate.localeCompare(b.filingDate) ||
    Number(a.form.endsWith("/A")) - Number(b.form.endsWith("/A")) ||
    a.accessionNo.localeCompare(b.accessionNo)
  );
  const book = new Map<string, ResolvedHolding>();
  for (const part of ordered) {
    if (part.amendment === "UNKNOWN") throw new Error(`Unknown 13F amendment type: ${part.accessionNo}`);
    if (part.amendment === "RESTATEMENT") book.clear();
    for (const h of part.holdings) book.set(`${h.cusip}:${h.secClass}`, { ...h, sourceAccessionNo: part.accessionNo });
  }
  return {
    holdings: [...book.values()],
    latestAccessionNo: ordered.at(-1)?.accessionNo ?? "",
    latestFilingDate: ordered.at(-1)?.filingDate ?? "",
  };
}

/** Legacy single-filing selector for callers that explicitly need one accession.
 * Do NOT use it to reconstruct a book: NEW HOLDINGS amendments are partial and
 * must be merged with mergeQuarterFilings instead. */
export function latestPerQuarter(filings: Filing13F[]): Filing13F[] {
  const byQ = new Map<string, Filing13F>();
  for (const f of filings) {
    const q = f.reportDate || f.filingDate;
    const cur = byQ.get(q);
    if (!cur || f.filingDate > cur.filingDate) byQ.set(q, f);
  }
  return [...byQ.values()].sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1));
}

export type PositionEvent =
  | { kind: "new" | "exit"; shares: number | null; valueUsd: number | null }
  | { kind: "change"; deltaPct: number; shares: number | null; valueUsd: number | null };

/**
 * Quarter-over-quarter event for one fund+company. Events only when notable:
 * new position, exit, or |Δshares| ≥ 30% (noise floor for quants' churn).
 */
export function positionEvent(prevShares: number | null, curShares: number | null, curValueUsd: number | null): PositionEvent | null {
  const prev = prevShares ?? 0, cur = curShares ?? 0;
  if (prev === 0 && cur > 0) return { kind: "new", shares: curShares, valueUsd: curValueUsd };
  if (prev > 0 && cur === 0) return { kind: "exit", shares: prevShares, valueUsd: null };
  if (prev > 0 && cur > 0) {
    const deltaPct = Math.round(((cur - prev) / prev) * 1000) / 10;
    if (Math.abs(deltaPct) >= 30) return { kind: "change", deltaPct, shares: curShares, valueUsd: curValueUsd };
  }
  return null;
}

const usd = (v: number | null) =>
  v === null ? "" : v >= 1e9 ? ` ($${(v / 1e9).toFixed(1)}B)` : v >= 1e6 ? ` ($${(v / 1e6).toFixed(0)}M)` : "";
const sh = (v: number | null) => (v === null ? "?" : v.toLocaleString("en-US"));

/** Enrichment context for a richer (still deterministic) event note. */
export interface NoteCtx {
  valueUsd?: number | null;   // current quarter value (exit: previous quarter)
  pctFund?: number | null;    // position value / fund quarter total, %
  pctCo?: number | null;      // position shares / shares outstanding, %
  holders?: number | null;    // tracked funds holding this name that quarter
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? null : v > 0 && v < 0.05 ? "<0.1%" : `${Math.round(v * 10) / 10}%`;

/** Deterministic note for a position event (no LLM). */
export function eventNote(fundName: string, ev: PositionEvent, secClass = "COM", ctx: NoteCtx = {}): string {
  const cls = secClass === "COM" ? "" : `${secClass} `;
  const valueUsd = ctx.valueUsd ?? (ev.kind === "change" || ev.kind === "new" ? ev.valueUsd : null);
  const parts: string[] = [];
  if (valueUsd) parts.push(usd(valueUsd).replace(/^ \((.*)\)$/, "$1"));
  const pf = pct(ctx.pctFund); if (pf) parts.push(`${pf} of fund`);
  const pc = pct(ctx.pctCo); if (pc) parts.push(`${pc} of co`);
  if (ctx.holders) parts.push(`held by ${ctx.holders} funds`);
  const tail = parts.length ? ` (${parts.join(" · ")})` : "";
  switch (ev.kind) {
    case "new": return `${fundName}: new ${cls}position ${sh(ev.shares)} sh${tail}`;
    case "exit": return `${fundName}: exited ${cls}position (was ${sh(ev.shares)} sh${parts.length ? ", " + parts.join(" · ") : ""})`;
    case "change": return `${fundName}: ${cls}${ev.deltaPct > 0 ? "+" : ""}${ev.deltaPct}% to ${sh(ev.shares)} sh${tail}`;
  }
}

/**
 * Event → signals row shape (source "13f", signalType "position").
 * Options convention (documented, honest): a PUT position reads bearish and a
 * CALL bullish on the underlying, but at HALF weight — funds hedge, and a put
 * against a big long book is insurance, not a bet. Commons score full.
 */
export function buildPositionRow(fundCik: number, heldCik: number, filing: Filing13F, ev: PositionEvent, note: string, secClass = "COM") {
  const dir = ev.kind === "change" ? Math.max(-1, Math.min(1, ev.deltaPct / 100)) : ev.kind === "new" ? 1 : -1;
  const clsSign = secClass === "PUT" ? -1 : 1;
  const weight = secClass === "COM" ? 1 : 0.5;
  const score = Math.round(dir * clsSign * weight * 1000) / 1000;
  const magnitude = ev.kind === "change" ? Math.abs(ev.deltaPct) : null;
  return {
    cik: heldCik,
    source: "13f" as const,
    signalType: "position" as const,
    eventTs: `${filing.filingDate} 00:00:00`,
    score,
    magnitude,
    note,
    payloadKey: `13f:pos:${fundCik}:${heldCik}:${secClass}:${filing.accessionNo}`,
    src: "backfill" as const,
  };
}
