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

export interface FundEntry { cik: number; name: string; tier: string }
export function loadFundUniverse(): FundEntry[] {
  return JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "funds-13f.json"), "utf8"));
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

/** One filings-list row as we shape it from the submissions API. */
export interface Filing13F { accessionNo: string; form: string; filingDate: string; reportDate: string }

/** Keep only the LATEST filing per quarter (amendments supersede originals). */
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

/** Deterministic note for a position event (no LLM). */
export function eventNote(fundName: string, ev: PositionEvent, secClass = "COM"): string {
  const cls = secClass === "COM" ? "" : `${secClass} `;
  switch (ev.kind) {
    case "new": return `${fundName}: new ${cls}position ${sh(ev.shares)} sh${usd(ev.valueUsd)}`;
    case "exit": return `${fundName}: exited ${cls}position (was ${sh(ev.shares)} sh)`;
    case "change": return `${fundName}: ${cls}${ev.deltaPct > 0 ? "+" : ""}${ev.deltaPct}% to ${sh(ev.shares)} sh${usd(ev.valueUsd)}`;
  }
}

/**
 * Event → signals row shape (source "13f", signalType "position").
 * Options convention (documented, honest): a PUT position reads bearish and a
 * CALL bullish on the underlying, but at HALF weight — funds hedge, and a put
 * against a big long book is insurance, not a bet. Commons score full.
 */
export function buildPositionRow(fundCik: number, heldCik: number, filing: Filing13F, ev: PositionEvent, note: string, secClass = "COM") {
  const dir = ev.kind === "new" ? 1 : ev.kind === "exit" ? -1 : Math.max(-1, Math.min(1, ev.deltaPct / 100));
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
