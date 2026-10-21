/**
 * Scope service — "which tickers a job processes" (Iteration 3a / Stage 2).
 *
 * Single universe-selection grammar (params.tickers):
 *   universe           — the CURRENT USER's active memberships (4c, D30 —
 *                        user_universe table; the legacy global
 *                        companies.inUniverse flag is deprecated). A legacy
 *                        job without startedBy resolves against the admin's
 *                        universe (least surprising fallback).
 *   sp500 | ndx | dow  — live index-constituent lists from Wikipedia
 *   sector:<name>      — companies.sector = <name>  (GICS, case-insensitive)
 *   industry:<name>    — companies.industry = <name>
 *   preset:<name>      — a saved selection from settings['scope_preset:u<userId>:<name>']
 *   AAPL,MSFT          — an explicit ticker list (any string with a comma,
 *                        or a lone ticker, is treated as an explicit list)
 *
 * params.exclude — comma-separated tickers, subtracted AFTER the base
 * resolves ("un-clicking" the selection — a user requirement). A preset's
 * exclude merges with the ad-hoc exclude from the job params.
 *
 * Presets are PER-USER since 4c (D30): key = "scope_preset:u<userId>:<name>".
 * They live in the settings table because they are user configuration, not
 * domain data.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companies, settings } from "@db/schema";
import * as edgar from "./edgar";
import { adminUserId, universeTickersOf } from "./membership";
import { GICS_BY_CIK, GICS_BY_TICKER, GICS_SNAPSHOT_AS_OF, GICS_SP500 } from "./gics-snapshot";

/** Scope resolve result: the final list + diagnostics for the job log. */
export interface ScopeResolution {
  /** final tickers (sorted, deduplicated) */
  tickers: string[];
  /** how many tickers the base produced before exclude subtraction */
  baseCount: number;
  /** tickers actually crossed out by the exclude list (intersection with the base) */
  excluded: string[];
  /** the raw base string — for transparent job logging */
  base: string;
}

/** Shape of a saved preset in settings.value (JSON). */
export interface ScopePreset {
  base: string;
  exclude: string[];
}

const PRESET_KEY_PREFIX = "scope_preset:";

/** Per-user preset key (4c, D30): scope_preset:u<userId>:<name>. */
function presetKey(userId: number, name: string): string {
  return `${PRESET_KEY_PREFIX}u${userId}:${name}`;
}

/** Normalize a ticker coming from the UI: uppercase, dots -> dashes. */
function normTicker(t: string): string {
  return t.trim().toUpperCase().replace(/\./g, "-");
}

/** Parse an exclude list: "aapl, msft" -> ["AAPL","MSFT"]. */
export function parseExclude(spec: string | string[] | undefined | null): string[] {
  if (!spec) return [];
  const parts = Array.isArray(spec) ? spec : spec.split(",");
  return [...new Set(parts.map(normTicker).filter(Boolean))];
}

/**
 * Resolve a base scope string into a ticker list (WITHOUT exclude).
 * sector:/industry: work only over companies already present in the DB (the
 * classification lives in companies.sector/industry) — GICS enrichment runs
 * automatically at the end of every bootstrap job (iteration 3c).
 *
 * "universe" is per-user since 4c (D30): the active memberships of userId.
 * userId undefined = a legacy job without startedBy → the admin's universe.
 */
async function resolveBase(base: string, userId?: number): Promise<string[]> {
  const db = getDb();
  if (base === "universe") {
    const uid = userId ?? (await adminUserId());
    if (uid === null) return [];
    return universeTickersOf(uid);
  }
  if (base === "sp500") return edgar.sp500Constituents();
  if (base === "ndx") return edgar.ndxConstituents();
  if (base === "dow") return edgar.dowConstituents();
  const mSector = base.match(/^sector:(.+)$/i);
  if (mSector) {
    const rows = await db
      .select({ ticker: companies.ticker })
      .from(companies)
      .where(sql`LOWER(${companies.sector}) = LOWER(${mSector[1].trim()})`);
    return rows.map((r) => r.ticker);
  }
  const mIndustry = base.match(/^industry:(.+)$/i);
  if (mIndustry) {
    const rows = await db
      .select({ ticker: companies.ticker })
      .from(companies)
      .where(sql`LOWER(${companies.industry}) = LOWER(${mIndustry[1].trim()})`);
    return rows.map((r) => r.ticker);
  }
  const mPreset = base.match(/^preset:(.+)$/i);
  if (mPreset) {
    // a preset resolves recursively: its base is a scope string of its own;
    // presets are per-user (4c), so the SAME user context rides along
    const preset = await getPreset(mPreset[1].trim(), userId);
    if (!preset) throw new Error(`Scope preset not found: ${mPreset[1].trim()}`);
    const inner = await resolveScope(preset.base, preset.exclude, userId);
    return inner.tickers;
  }
  // fallback: an explicit comma-separated ticker list (or a lone ticker)
  return [...new Set(base.split(",").map(normTicker).filter(Boolean))];
}

/**
 * Full resolve: base -> exclude subtraction (a preset's own exclude is
 * already applied inside the recursion for preset:<name>; only the ad-hoc
 * exclude is passed in here).
 *
 * @param userId owner of the "universe" base and of presets (4c, D30);
 *               undefined resolves "universe" against the admin (legacy jobs).
 */
export async function resolveScope(
  tickersSpec: string,
  excludeSpec?: string | string[],
  userId?: number
): Promise<ScopeResolution> {
  const base = (tickersSpec ?? "").trim() || "universe";
  const baseTickers = await resolveBase(base, userId);
  const exclude = new Set(parseExclude(excludeSpec));
  const excluded = baseTickers.filter((t) => exclude.has(t));
  const tickers = baseTickers.filter((t) => !exclude.has(t)).sort();
  return { tickers, baseCount: baseTickers.length, excluded, base };
}

// ---------------------------------------------------------------------------
// Presets CRUD (settings table, per-user since 4c)
// ---------------------------------------------------------------------------

export async function listPresets(userId: number): Promise<(ScopePreset & { name: string })[]> {
  const prefix = `${PRESET_KEY_PREFIX}u${userId}:`;
  const rows = await getDb()
    .select()
    .from(settings)
    .where(sql`${settings.key} LIKE ${prefix + "%"}`);
  const out: (ScopePreset & { name: string })[] = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.value ?? "{}") as ScopePreset;
      if (typeof parsed.base === "string") {
        out.push({
          name: r.key.slice(prefix.length),
          base: parsed.base,
          exclude: Array.isArray(parsed.exclude) ? parsed.exclude : [],
        });
      }
    } catch {
      // broken JSON in settings must not break the preset list — skip it
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPreset(name: string, userId?: number): Promise<ScopePreset | null> {
  // no userId (legacy job) → the admin's presets, mirroring the universe fallback
  const uid = userId ?? (await adminUserId());
  if (uid === null) return null;
  const [row] = await getDb()
    .select()
    .from(settings)
    .where(eq(settings.key, presetKey(uid, name)))
    .limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value ?? "{}") as ScopePreset;
    return typeof parsed.base === "string"
      ? { base: parsed.base, exclude: Array.isArray(parsed.exclude) ? parsed.exclude : [] }
      : null;
  } catch {
    return null;
  }
}

export async function savePreset(name: string, preset: ScopePreset, userId: number): Promise<void> {
  // the preset name is part of the key; strip dangerous characters so the
  // key stays readable and never collides with other settings namespaces
  const safe = name.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 48);
  if (!safe) throw new Error("Preset name is empty after sanitization");
  await getDb()
    .insert(settings)
    .values({ key: presetKey(userId, safe), value: JSON.stringify(preset) })
    .onDuplicateKeyUpdate({ set: { value: JSON.stringify(preset) } });
}

export async function deletePreset(name: string, userId: number): Promise<void> {
  await getDb().delete(settings).where(eq(settings.key, presetKey(userId, name)));
}

// ---------------------------------------------------------------------------
// Classification enrichment (GICS from the static S&P 500 snapshot)
// ---------------------------------------------------------------------------

/**
 * Sets companies.sector/industry from the static S&P 500 GICS snapshot
 * (decision D14, api/services/gics-snapshot.ts). The snapshot is the single
 * classification source: no live Wikipedia fetch is required, enrichment
 * works fully offline. Updating the classification = replacing the RAW block
 * in the snapshot (once a quarter, see GICS_SNAPSHOT_AS_OF).
 *
 * Match by CIK (reliable) OR by ticker (for rows without a CIK in our DB).
 * Only actual changes are written — otherwise updatedAt gets noisy and real
 * updates become indistinguishable from enrichment runs.
 * Companies outside the S&P 500 keep NULL — a deliberate limitation (the NDX
 * ICB taxonomy is not mixed with GICS, see schema.ts).
 *
 * The result names every company explicitly: matched tickers (whether a write
 * was needed or not) and unmatched ones with the reason — so callers (job
 * runner logs, manual trigger toasts) can say exactly WHY a company has no
 * GICS sector instead of an opaque "0 updated".
 */
export async function enrichClassification(): Promise<{
  sp500Rows: number;
  inDb: number;
  updated: number;
  asOf: string;
  matched: string[];
  unmatched: { ticker: string; reason: string }[];
}> {
  const db = getDb();
  const rows = await db.select().from(companies);
  let inDb = 0;
  let updated = 0;
  const matched: string[] = [];
  const unmatched: { ticker: string; reason: string }[] = [];
  for (const row of rows) {
    const g = GICS_BY_CIK.get(row.cik) ?? GICS_BY_TICKER.get(normTicker(row.ticker));
    if (!g) {
      unmatched.push({
        ticker: row.ticker,
        reason: "not an S&P 500 member — no GICS entry in the snapshot",
      });
      continue;
    }
    inDb++;
    matched.push(row.ticker);
    if (row.sector !== g.sector || row.industry !== g.industry) {
      await db
        .update(companies)
        .set({ sector: g.sector, industry: g.industry, updatedAt: new Date() })
        .where(eq(companies.cik, row.cik));
      updated++;
    }
  }
  return { sp500Rows: GICS_SP500.length, inDb, updated, asOf: GICS_SNAPSHOT_AS_OF, matched, unmatched };
}

/**
 * Available groups for the UI scope builder:
 * indexes (sp500/ndx/dow with sizes) + distinct sector/industry from the DB.
 * An index fetch failure (network/Wikipedia) does not sink the whole list —
 * the group comes back with count = -1 (the UI shows "n/a").
 */
export async function scopeGroups(): Promise<{
  indexes: { key: string; label: string; count: number }[];
  sectors: { name: string; count: number }[];
  industries: { name: string; count: number }[];
}> {
  const db = getDb();
  const indexDefs: { key: "sp500" | "ndx" | "dow"; label: string }[] = [
    { key: "sp500", label: "S&P 500" },
    { key: "ndx", label: "NASDAQ-100" },
    { key: "dow", label: "Dow Jones 30" },
  ];
  const indexes = await Promise.all(
    indexDefs.map(async (d) => {
      try {
        return { key: d.key, label: d.label, count: (await edgar.indexConstituents(d.key)).length };
      } catch {
        return { key: d.key, label: d.label, count: -1 };
      }
    })
  );
  const sectors = await db
    .select({ name: companies.sector, count: sql<number>`COUNT(*)` })
    .from(companies)
    .where(sql`${companies.sector} IS NOT NULL`)
    .groupBy(companies.sector)
    .orderBy(companies.sector);
  const industries = await db
    .select({ name: companies.industry, count: sql<number>`COUNT(*)` })
    .from(companies)
    .where(sql`${companies.industry} IS NOT NULL`)
    .groupBy(companies.industry)
    .orderBy(companies.industry);
  return {
    indexes,
    sectors: sectors.map((s) => ({ name: s.name ?? "", count: Number(s.count) })),
    industries: industries.map((s) => ({ name: s.name ?? "", count: Number(s.count) })),
  };
}

/**
 * Group members for the chip UI (detailed list with an "in DB" flag).
 * Used by the Universe page for manual ticker exclusion.
 */
export async function scopeMembers(base: string): Promise<
  { ticker: string; name: string | null; sector: string | null; inDb: boolean }[]
> {
  const tickers = await resolveBase(base);
  const db = getDb();
  const rows = await db.select({ ticker: companies.ticker, name: companies.name, sector: companies.sector }).from(companies);
  const byTicker = new Map(rows.map((r) => [normTicker(r.ticker), r]));
  return tickers.map((t) => {
    const r = byTicker.get(t);
    return { ticker: t, name: r?.name ?? null, sector: r?.sector ?? null, inDb: !!r };
  });
}
