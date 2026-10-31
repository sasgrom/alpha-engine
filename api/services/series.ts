/**
 * Stage 1.6 — Series Builder.
 *
 * Turns raw XBRL `facts` (every revision, mixed durations, deprecated concept
 * names) into homogeneous canonical quarterly series in `series_points`, plus
 * continuity / restatement health in `series_health` and a company-level
 * rollup in `company_data_health`.
 *
 * Normative rules (docs/ALPHA_ENGINE_MANUAL.md §4.3 — keep in sync):
 *
 *  VINTAGES (anti-lookahead):
 *    every quarterly point is stored twice — `first` (earliest `filed` for
 *    that period/duration, i.e. what was known when the number first became
 *    public) and `latest` (newest `filed`, post-restatement "truth").
 *    as_of(T) for backtests = latest row with sourceFiled <= T.
 *
 *  DURATION HOMOGENIZATION:
 *    flow concepts (income statement, cash flow) are normalized to 3-month
 *    points; a Q4 point is DERIVED as FY(12M) - 9M YTD because no 10-Q exists
 *    for Q4 (derivation='derived_q4'). stock concepts (balance sheet) are
 *    instant values taken as-is at period end.
 *
 *  CONCEPT ALIASES (two layers):
 *    1. curated static map — unambiguous global renames (ASC 606: Revenues ->
 *       RevenueFromContractWithCustomerExcludingAssessedTax etc.).
 *    2. per-company AUTO-ALIAS — the us-gaap taxonomy renamed many elements
 *       in 2018-2020 by adding/removing the "Current"/"Noncurrent" suffix
 *       (AccountsPayableCurrent <-> AccountsPayable). Each filer migrated at
 *       its own pace and in its own direction (Apple still files
 *       AccountsPayableCurrent in 2026), so the direction is resolved per
 *       company: canonical = the name still in use (latest periodEnd).
 *       Merges require hard evidence (see autoAliasConceptNames); near-misses
 *       surface as `alias_candidate:` continuity flags for human review.
 *    Original names are recorded in series_health.aliasedFrom.
 *
 *  CONTINUITY:
 *    each series is checked against the expected quarterly grid between its
 *    first and last point (gaps), plus unit changes and sharp revisions.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { facts, seriesPoints, seriesHealth, companyDataHealth, filings } from "@db/schema";

// ---------------------------------------------------------------------------
// Curated concept alias map: oldName -> canonicalName.
// Only true renames (identical economic meaning) belong here. Conservative by
// design — a wrong alias is far worse than a split series.
// ---------------------------------------------------------------------------
const CONCEPT_ALIASES: Record<string, string> = {
  Revenues: "RevenueFromContractWithCustomerExcludingAssessedTax",
  SalesRevenueNet: "RevenueFromContractWithCustomerExcludingAssessedTax",
  SalesRevenueGoodsNet: "RevenueFromContractWithCustomerExcludingAssessedTax",
  SalesRevenueServicesNet: "RevenueFromContractWithCustomerExcludingAssessedTax",
  CostOfRevenue: "CostOfGoodsAndServicesSold",
  CostOfGoodsSold: "CostOfGoodsAndServicesSold",
};

function canonicalConcept(name: string): { canonical: string; aliased: boolean } {
  const target = CONCEPT_ALIASES[name];
  return target ? { canonical: target, aliased: true } : { canonical: name, aliased: false };
}

// ---------------------------------------------------------------------------
// Duration classification (flow concepts only).
// Window lengths in days observed in practice: Q≈90, H1≈180, 9M≈270, FY≈365.
// ---------------------------------------------------------------------------
type DurationClass = "Q" | "H1" | "9M" | "FY" | "OTHER";

function classifyDuration(startDate: string | null, endDate: string | null): DurationClass {
  if (!startDate || !endDate) return "OTHER"; // instant values handled separately
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
  if (days >= 70 && days <= 105) return "Q";
  if (days >= 150 && days <= 220) return "H1";
  if (days >= 240 && days <= 315) return "9M";
  if (days >= 330 && days <= 385) return "FY";
  return "OTHER";
}

/**
 * Quarter index used for grid-continuity checks. Encoded as year*4 + (q-1)
 * with q in 1..4 (zero-based quarter) so that index arithmetic and label
 * decoding are exact inverses: qi = y*4 + (q-1)  <=>  y = floor(qi/4), q = qi%4+1.
 */
function quarterIndex(periodEnd: string): number {
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  return y * 4 + (Math.ceil(m / 3) - 1);
}

function quarterLabel(qi: number): string {
  return `${Math.floor(qi / 4)}Q${(qi % 4) + 1}`;
}

/** Median of a numeric array (robust central tendency, Stage 3 philosophy). */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Auto-alias support types and helpers.
// ---------------------------------------------------------------------------

/** Latest-filed value for one (periodEnd, durationClass) cell of a concept. */
interface CellVal { end: string; cls: string; val: number; }

/**
 * Collapse a concept's raw rows to one value per (periodEnd, durationClass)
 * cell, keeping the LATEST filing (vintage `latest`). The duration class is
 * part of the key so that e.g. a 9M-YTD value is never compared against a
 * quarterly value of the twin concept.
 */
function latestCellMap(rows: FactRow[]): Map<string, CellVal> {
  const m = new Map<string, CellVal & { filed: string }>();
  for (const r of rows) {
    if (r.val === null || !r.endDate) continue;
    const cls = r.startDate ? classifyDuration(r.startDate, r.endDate) : "I";
    if (cls === "OTHER") continue; // irregular windows carry no comparable value
    const key = `${r.endDate}|${cls}`;
    const prev = m.get(key);
    if (!prev || (r.filed ?? "") >= prev.filed) m.set(key, { end: r.endDate, cls, val: r.val, filed: r.filed ?? "" });
  }
  return m;
}

/** Chronology of a concept's dominant duration class (for boundary tests). */
function dominantTimeline(m: Map<string, CellVal>): CellVal[] {
  const byCls = new Map<string, CellVal[]>();
  for (const v of m.values()) {
    const arr = byCls.get(v.cls) ?? [];
    arr.push(v);
    byCls.set(v.cls, arr);
  }
  const dom = [...byCls.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return dom.sort((x, y) => x.end.localeCompare(y.end));
}

interface FactRow {
  concept: string;
  unit: string;
  startDate: string | null;
  endDate: string | null;
  val: number | null;
  filed: string | null;
  accn: string | null;
}

/**
 * Pick the `first` and `latest` vintage rows for one (periodEnd, durationClass)
 * bucket. `first` = earliest filed disclosure; `latest` = newest (restated).
 * Both are emitted; ties on `filed` are broken by accession number for
 * determinism.
 */
function pickVintages(rows: FactRow[]): { first: FactRow; latest: FactRow } {
  const sorted = [...rows].sort((a, b) =>
    (a.filed ?? "").localeCompare(b.filed ?? "") || (a.accn ?? "").localeCompare(b.accn ?? "")
  );
  return { first: sorted[0], latest: sorted[sorted.length - 1] };
}

export interface SeriesBuildResult {
  series: number;
  points: number;
  avgCoverage: number;
}

/**
 * 4f (D37): one quarter derived from complementary YTD windows sharing the
 * SAME fiscal-year start (same startDate): big − small. Pure + exported for
 * tests. Guards: both values present, same unit, the endDate gap covers ~one
 * quarter (60–120 days — fiscal calendars vary 12–13 weeks). Lineage rides
 * the BIG side (the later filing carries the YTD figure).
 */
export function deriveQuarterFromYtd(
  big: { startDate: string | null; endDate: string | null; val: number | null; unit: string; accn: string | null; filed: string | null },
  small: { startDate: string | null; endDate: string | null; val: number | null; unit: string; accn: string | null; filed: string | null }
): { val: number; unit: string; accn: string | null; filed: string | null } | null {
  if (big.val === null || small.val === null) return null;
  if (big.unit !== small.unit) return null;
  if (!big.startDate || !small.startDate || big.startDate !== small.startDate) return null;
  if (!big.endDate || !small.endDate) return null;
  const span = (Date.parse(big.endDate) - Date.parse(small.endDate)) / 86_400_000;
  if (span < 60 || span > 120) return null;
  return { val: big.val - small.val, unit: big.unit, accn: big.accn, filed: big.filed };
}

/**
 * Rebuild all canonical series for one company. Full-replace strategy:
 * the input (facts) is cumulative, so derived series are rebuilt from scratch
 * on each run — deterministic and idempotent.
 */
export async function buildCompanySeries(cik: number): Promise<SeriesBuildResult> {
  const db = getDb();
  const raw = await db
    .select({
      concept: facts.concept,
      unit: facts.unit,
      startDate: facts.startDate,
      endDate: facts.endDate,
      val: facts.val,
      filed: facts.filed,
      accn: facts.accn,
    })
    .from(facts)
    .where(eq(facts.cik, cik));

  // --- group raw facts by canonical concept ------------------------------
  const byConcept = new Map<string, { rows: FactRow[]; aliasedFrom: Set<string> }>();
  for (const r of raw) {
    if (r.val === null || !r.endDate) continue;
    const { canonical, aliased } = canonicalConcept(r.concept);
    let bucket = byConcept.get(canonical);
    if (!bucket) { bucket = { rows: [], aliasedFrom: new Set() }; byConcept.set(canonical, bucket); }
    if (aliased) bucket.aliasedFrom.add(r.concept);
    bucket.rows.push({ ...r, concept: canonical });
  }

  // --- per-company auto-alias --------------------------------------------
  // Candidate pairs differ ONLY by a trailing "Current"/"Noncurrent" suffix
  // (taxonomy rename family). A wrong merge is far worse than a split series,
  // so a pair is spliced only with hard evidence:
  //
  //  A. shared (periodEnd, durationClass) cells exist  ->  merge iff EVERY
  //     shared cell carries the same value (<=0.5% tol): the same fact was
  //     tagged under both names. Systematic mismatch = different aggregates
  //     sharing a word stem (Assets vs AssetsCurrent, LongTermDebt vs
  //     LongTermDebtNoncurrent) — never merged, not even flagged. A handful
  //     of mismatches = mixed usage worth a human look -> alias_candidate.
  //
  //  B. no shared cells  ->  merge iff the two names are STRICTLY successive
  //     in time AND boundary values (median of <=3 edge points) agree within
  //     a factor of 2. Interleaved ranges or a boundary jump -> flag only.
  //
  // Canonical within a merged group = the name still in use (latest
  // periodEnd), tie-broken by row count.
  const extraFlags = new Map<string, Set<string>>();
  const addExtraFlag = (concept: string, flag: string) => {
    const s = extraFlags.get(concept) ?? new Set<string>();
    s.add(flag);
    extraFlags.set(concept, s);
  };

  // union-find over bucket names (handles 3+ name rename chains)
  const parent = new Map<string, string>();
  const findRoot = (x: string): string => {
    let r = parent.get(x) ?? x;
    if (r !== x) { r = findRoot(r); parent.set(x, r); }
    return r;
  };

  const names = [...byConcept.keys()];
  const cellMaps = new Map(names.map((n) => [n, latestCellMap(byConcept.get(n)!.rows)]));
  const seenPair = new Set<string>();

  for (const n of names) {
    for (const suf of ["Current", "Noncurrent"] as const) {
      if (!n.endsWith(suf) || n.length <= suf.length) continue;
      const twin = n.slice(0, -suf.length);
      if (!byConcept.has(twin)) continue;
      const pairKey = [n, twin].sort().join("|");
      if (seenPair.has(pairKey)) continue;
      seenPair.add(pairKey);

      const A = cellMaps.get(n)!;
      const B = cellMaps.get(twin)!;
      const sharedKeys = [...A.keys()].filter((k) => B.has(k));
      let mismatch = 0;
      for (const k of sharedKeys) {
        const va = A.get(k)!.val;
        const vb = B.get(k)!.val;
        if (Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb), 1e-9) > 0.005) mismatch++;
      }

      if (sharedKeys.length > 0) {
        if (mismatch === 0) {
          parent.set(findRoot(n), findRoot(twin)); // case A: identical twin tagging
        } else if (mismatch <= 3) {
          const f = `value_mismatch(${mismatch}/${sharedKeys.length})`;
          addExtraFlag(n, `alias_candidate:${twin}:${f}`);
          addExtraFlag(twin, `alias_candidate:${n}:${f}`);
        }
        continue;
      }

      // case B: clean temporal succession required
      const eA = dominantTimeline(A);
      const eB = dominantTimeline(B);
      if (eA.length === 0 || eB.length === 0) continue;
      const [older, newer] = eA[eA.length - 1].end < eB[eB.length - 1].end ? [eA, eB] : [eB, eA];
      if (older[older.length - 1].end >= newer[0].end) {
        // ranges interleave without a single identical cell: tagging anomaly
        // (e.g. a one-off duplicate under the twin name) — human review
        addExtraFlag(n, `alias_candidate:${twin}:interleaved`);
        addExtraFlag(twin, `alias_candidate:${n}:interleaved`);
        continue;
      }
      const vOld = median(older.slice(-3).map((x) => x.val));
      const vNew = median(newer.slice(0, 3).map((x) => x.val));
      const ratio = vNew / (Math.abs(vOld) < 1e-9 ? 1e-9 : vOld);
      if (ratio >= 0.5 && ratio <= 2) {
        parent.set(findRoot(n), findRoot(twin)); // plausible hand-off
      } else {
        const f = `boundary_jump(${ratio.toFixed(2)})`;
        addExtraFlag(n, `alias_candidate:${twin}:${f}`);
        addExtraFlag(twin, `alias_candidate:${n}:${f}`);
      }
    }
  }

  // apply unions: splice every group member into the group's canonical name
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const root = findRoot(n);
    const g = groups.get(root) ?? [];
    g.push(n);
    groups.set(root, g);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const maxEndOf = (nm: string) => {
      let mx = "";
      for (const v of cellMaps.get(nm)!.values()) if (v.end > mx) mx = v.end;
      return mx;
    };
    const canon = [...members].sort(
      (a, b) => maxEndOf(b).localeCompare(maxEndOf(a)) || byConcept.get(b)!.rows.length - byConcept.get(a)!.rows.length
    )[0];
    const target = byConcept.get(canon)!;
    for (const m of members) {
      if (m === canon) continue;
      const src = byConcept.get(m)!;
      for (const r of src.rows) target.rows.push({ ...r, concept: canon }); // retag onto canonical
      target.aliasedFrom.add(m);
      for (const a of src.aliasedFrom) target.aliasedFrom.add(a);
      byConcept.delete(m);
    }
  }

  // Previous derived output is replaced only after the new output has been
  // fully computed, inside the same transaction as the inserts below.
  const outPoints: (typeof seriesPoints.$inferInsert)[] = [];
  const outHealth: (typeof seriesHealth.$inferInsert)[] = [];

  for (const [concept, { rows, aliasedFrom }] of byConcept) {
    // kind: flow if the majority of rows carry a duration window
    const durationRows = rows.filter((r) => r.startDate !== null);
    const kind: "flow" | "stock" = durationRows.length >= rows.length / 2 ? "flow" : "stock";

    // --- flow: bucket by (periodEnd, durationClass); stock: by periodEnd --
    interface Bucket { rows: FactRow[]; derivation: "reported" | "derived_ytd" }
    const buckets = new Map<string, Bucket>(); // key = periodEnd
    /** per-vintage derived values for this concept only (scoped to avoid cross-concept collisions) */
    const derivedQ4 = new Map<string, {
      vintage: "first" | "latest"; val: number; unit: string;
      accn: string | null; filed: string | null;
    }>();
    if (kind === "flow") {
      // 4f (D37): EVERY duration class is indexed by period end — direct-Q
      // rows double as first-quarter YTD (they start at the fiscal-year start).
      const byEnd = new Map<string, FactRow[]>();
      for (const r of rows) {
        const cls = classifyDuration(r.startDate, r.endDate);
        if (cls === "OTHER" || !r.endDate) continue;
        const arr = byEnd.get(r.endDate) ?? [];
        arr.push(r);
        byEnd.set(r.endDate, arr);
      }
      // reported quarterly points always win
      for (const [end, arr] of byEnd) {
        const qArr = arr.filter((r) => classifyDuration(r.startDate, r.endDate) === "Q");
        if (qArr.length > 0) buckets.set(end, { rows: qArr, derivation: "reported" });
      }
      // Derive a missing quarter from complementary YTD windows sharing the
      // SAME fiscal-year start: Q2 = 6M − 3M, Q3 = 9M − 6M, Q4 = FY − 9M.
      // (Pre-4f the code paired FY and 9M rows by END date — a key that never
      // matches — so the derivation never fired; prod carried 0 derived rows.)
      const allEnds = [...byEnd.keys()].sort();
      for (const end of allEnds) {
        if (buckets.has(end)) continue;
        // previous quarter boundary = the largest observed end within the
        // last 60–120 days. NOT calendar-quarter arithmetic: fiscal quarters
        // cross month boundaries (AAPL FY25 Q3 ends 2025-06-28, FY23 Q3 ends
        // 2023-07-01 — month-7 and month-9 both map to calendar Q3, so a
        // quarter-index adjacency test silently kills those derivations).
        let prevEnd: string | null = null;
        for (const e of allEnds) {
          if (e >= end) break;
          const gap = (Date.parse(end) - Date.parse(e)) / 86_400_000;
          if (gap >= 60 && gap <= 120) prevEnd = e;
        }
        if (!prevEnd) continue;
        // big candidates: cumulative (non-Q) rows ending at `end`, grouped by
        // their startDate (= fiscal-year start), longest window first
        const bigGroups = new Map<string, FactRow[]>();
        for (const r of byEnd.get(end) ?? []) {
          if (classifyDuration(r.startDate, r.endDate) === "Q") continue;
          const k = r.startDate ?? "";
          const arr = bigGroups.get(k) ?? [];
          arr.push(r);
          bigGroups.set(k, arr);
        }
        const smallGroups = new Map<string, FactRow[]>();
        for (const r of byEnd.get(prevEnd) ?? []) {
          const k = r.startDate ?? "";
          const arr = smallGroups.get(k) ?? [];
          arr.push(r);
          smallGroups.set(k, arr);
        }
        const bigsSorted = [...bigGroups.entries()].sort(
          (a, b) =>
            Date.parse(a[1][0].startDate ?? "") - Date.parse(b[1][0].startDate ?? "")
        );
        for (const [startKey, bigArr] of bigsSorted) {
          const smallArr = smallGroups.get(startKey);
          if (!smallArr) continue;
          let any = false;
          for (const vintage of ["first", "latest"] as const) {
            const d = deriveQuarterFromYtd(pickVintages(bigArr)[vintage], pickVintages(smallArr)[vintage]);
            if (!d) continue;
            derivedQ4.set(`${end}|${vintage}`, { vintage, ...d });
            any = true;
          }
          if (any) {
            buckets.set(end, { rows: [], derivation: "derived_ytd" }); // marker; values from derivedQ4
            break; // longest valid window wins; do not double-derive
          }
        }
      }
    } else {
      const inst = new Map<string, FactRow[]>();
      for (const r of rows) {
        if (r.startDate !== null || !r.endDate) continue;
        const arr = inst.get(r.endDate) ?? [];
        arr.push(r);
        inst.set(r.endDate, arr);
      }
      for (const [end, arr] of inst) buckets.set(end, { rows: arr, derivation: "reported" });
    }

    // --- emit points for both vintages + collect health inputs -----------
    const ends = [...buckets.keys()].sort();
    if (ends.length === 0) continue;
    const presentQ = new Set<number>();
    const units = new Set<string>();
    let revised = 0, compared = 0, lagSum = 0;
    const relChanges: number[] = [];
    const sharpRevisions: string[] = [];

    for (const end of ends) {
      const b = buckets.get(end)!;
      presentQ.add(quarterIndex(end));
      if (b.derivation === "reported") {
        const { first, latest } = pickVintages(b.rows);
        for (const [vintage, r] of [["first", first], ["latest", latest]] as const) {
          units.add(r.unit);
          outPoints.push({
            cik, concept, kind, periodEnd: end, vintage,
            val: r.val, unit: r.unit, derivation: "reported",
            sourceAccn: r.accn, sourceFiled: r.filed,
          });
        }
        if (first.val !== null && latest.val !== null) {
          compared++;
          lagSum += Math.max(0, (Date.parse(latest.filed ?? "") - Date.parse(first.filed ?? "")) / 86_400_000);
          if (first.val !== latest.val) {
            revised++;
            // relative change, capped at 500% — periods with first ≈ 0
            // (sign flips, tax items) would otherwise poison the statistic
            const rel = Math.min(
              Math.abs(latest.val - first.val) / Math.max(Math.abs(first.val), 1e-12),
              5
            );
            relChanges.push(rel);
            if (rel > 0.05) sharpRevisions.push(`${end}:${(rel * 100).toFixed(0)}%`);
          }
        }
      } else {
        // derived quarter (4f: any complementary YTD pair, not only FY−9M):
        // emit the per-vintage differences computed above
        for (const vintage of ["first", "latest"] as const) {
          const d = derivedQ4.get(`${end}|${vintage}`);
          if (!d) continue;
          units.add(d.unit);
          outPoints.push({
            cik, concept, kind, periodEnd: end, vintage,
            val: d.val, unit: d.unit, derivation: "derived_ytd",
            sourceAccn: d.accn, sourceFiled: d.filed,
          });
        }
      }
    }

    // --- continuity flags on the expected quarterly grid ------------------
    const flags: string[] = [];
    const qs = [...presentQ].sort((a, b) => a - b);
    const span = qs[qs.length - 1] - qs[0] + 1;
    const coverage = span > 0 ? qs.length / span : 0;
    const missing: string[] = [];
    for (let qi = qs[0]; qi <= qs[qs.length - 1]; qi++) {
      if (!presentQ.has(qi)) missing.push(quarterLabel(qi));
    }
    if (missing.length > 0) flags.push(`gap:${missing.slice(0, 8).join(",")}${missing.length > 8 ? "…" : ""}`);
    if (units.size > 1) flags.push(`unit_change:${[...units].join("|")}`);
    if (sharpRevisions.length > 0) flags.push(`sharp_revision:${sharpRevisions.slice(0, 8).join(",")}${sharpRevisions.length > 8 ? "…" : ""}`);
    // unresolved rename candidates from the auto-alias pass (human review queue)
    const ef = extraFlags.get(concept);
    if (ef) flags.push(...ef);

    outHealth.push({
      cik, concept, kind,
      pointsCount: ends.length,
      gridCoverage: coverage,
      flags: flags.length ? JSON.stringify(flags) : null,
      revisionRate: compared > 0 ? revised / compared : 0,
      // median (not mean) of capped relative changes — robust to the handful
      // of near-zero-base periods that dominate any arithmetic mean
      revisionMagnitude: relChanges.length ? median(relChanges) : 0,
      revisionLagDays: compared > 0 ? lagSum / compared : 0,
      aliasedFrom: aliasedFrom.size ? JSON.stringify([...aliasedFrom]) : null,
      builtAt: new Date(),
    });
  }

  // Atomic per-CIK replacement (hosted MySQL packet limits: <= 500 rows).
  // A failed build or insert can no longer leave a company with empty series.
  await db.transaction(async (tx) => {
    await tx.delete(seriesPoints).where(eq(seriesPoints.cik, cik));
    await tx.delete(seriesHealth).where(eq(seriesHealth.cik, cik));
    for (let i = 0; i < outPoints.length; i += 500) {
      await tx.insert(seriesPoints).values(outPoints.slice(i, i + 500));
    }
    for (let i = 0; i < outHealth.length; i += 500) {
      await tx.insert(seriesHealth).values(outHealth.slice(i, i + 500));
    }
  });

  // --- company-level rollup (Stage 4 features) ----------------------------
  const avg = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const amendCount = await db
    .select({ n: sql<number>`count(*)` })
    .from(filings)
    .where(sql`${filings.cik} = ${cik} AND ${filings.form} IN ('10-K/A','10-Q/A','8-K/A')`);
  await db
    .insert(companyDataHealth)
    .values({
      cik,
      seriesCount: outHealth.length,
      avgGridCoverage: avg(outHealth.map((h) => h.gridCoverage)),
      avgRevisionRate: avg(outHealth.map((h) => h.revisionRate)),
      avgRevisionMagnitude: avg(outHealth.map((h) => h.revisionMagnitude)),
      avgRevisionLagDays: avg(outHealth.map((h) => h.revisionLagDays)),
      amendmentCount: Number(amendCount[0]?.n ?? 0),
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        seriesCount: outHealth.length,
        avgGridCoverage: avg(outHealth.map((h) => h.gridCoverage)),
        avgRevisionRate: avg(outHealth.map((h) => h.revisionRate)),
        avgRevisionMagnitude: avg(outHealth.map((h) => h.revisionMagnitude)),
        avgRevisionLagDays: avg(outHealth.map((h) => h.revisionLagDays)),
        amendmentCount: Number(amendCount[0]?.n ?? 0),
        updatedAt: new Date(),
      },
    });

  return {
    series: outHealth.length,
    points: outPoints.length,
    avgCoverage: avg(outHealth.map((h) => h.gridCoverage)) ?? 0,
  };
}
