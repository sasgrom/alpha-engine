/**
 * Membership service (4c, D30) — the per-user universe.
 *
 * Each user builds their own world (owner directive: "each user creates
 * their own universe and selection of companies; the DB stores the data"):
 * a row in user_universe per (userId, cik). active=false is the hide switch;
 * row deletion is the trash can; re-adding a removed company creates a fresh
 * ACTIVE row — exactly like a brand-new one. The shared companies table is
 * never touched by membership actions (users read shared data, they never
 * modify it — D31).
 *
 * Everything universe-scoped in the platform resolves through this module:
 * job scopes ("universe"), the screener payload, dashboard counters, the
 * latest-filings feed and the price-import wanted set.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companies, externalCache, userUniverse, users } from "@db/schema";

/** Active membership tickers of one user — the per-user "universe" scope base. */
export async function universeTickersOf(userId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ ticker: userUniverse.ticker })
    .from(userUniverse)
    .where(and(eq(userUniverse.userId, userId), eq(userUniverse.active, true)));
  return rows.map((r) => r.ticker).sort();
}

/** Active membership CIKs of one user (screener rows, feed filters). */
export async function universeCiksOf(userId: number): Promise<number[]> {
  const rows = await getDb()
    .select({ cik: userUniverse.cik })
    .from(userUniverse)
    .where(and(eq(userUniverse.userId, userId), eq(userUniverse.active, true)));
  return rows.map((r) => r.cik);
}

/** Distinct users holding at least one membership (screener background refresh). */
export async function usersWithUniverse(): Promise<number[]> {
  const rows = await getDb()
    .selectDistinct({ userId: userUniverse.userId })
    .from(userUniverse);
  return rows.map((r) => r.userId);
}

/**
 * Union of active membership tickers across ALL users — the wanted set of the
 * bulk price import (D23/D30): shared accumulation serves everyone, so the
 * archive import covers whatever ANY user watches.
 */
export async function allActiveUniverseTickers(): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ ticker: userUniverse.ticker })
    .from(userUniverse)
    .where(eq(userUniverse.active, true));
  return rows.map((r) => r.ticker).sort();
}

/**
 * The platform owner's user id — the fallback owner of scope "universe" for
 * legacy jobs whose startedBy is NULL (they predate per-user tracking and
 * can only be re-run manually; resolving them against the admin's universe
 * is the least surprising behaviour).
 */
export async function adminUserId(): Promise<number | null> {
  const [a] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(users.id)
    .limit(1);
  return a?.id ?? null;
}

/**
 * Drop a user's cached screener payload (external_cache key screener:u<id>).
 * Membership changes (add/hide/remove) alter the screener's input set, so the
 * next read must recompute rather than serve a stale 20 h payload (D27).
 */
export async function invalidateScreenerCache(userId: number): Promise<void> {
  await getDb()
    .delete(externalCache)
    .where(eq(externalCache.key, `screener:u${userId}`));
}

/** True when the company is already in the shared registry (ingested). */
export async function companyInDb(cik: number): Promise<boolean> {
  const [row] = await getDb()
    .select({ cik: companies.cik })
    .from(companies)
    .where(eq(companies.cik, cik))
    .limit(1);
  return !!row;
}
