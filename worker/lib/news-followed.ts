/**
 * The companies the news briefs cover: the active follows (watchlists) of the viewers who may see the model's
 * readings, that is the owner (admin) and reviewers who accepted the NDA (the rule of api/routers/desk.ts news).
 * Members' follows are left out: they never see a brief. Read-only on alpha_engine.
 */
import { and, eq, isNotNull, or } from "drizzle-orm";
import { getDb } from "../../api/queries/connection";
import { reviewerAccess, userUniverse, users } from "../../db/schema";
import { writeJsonAtomic } from "./json-file";

export interface FollowedFile { builtAt: string; ciks: number[]; tickers: Record<string, string>; viewers: number }

export async function readFollowed(): Promise<FollowedFile> {
  const rows = await getDb()
    .select({ userId: userUniverse.userId, cik: userUniverse.cik, ticker: userUniverse.ticker })
    .from(userUniverse)
    .innerJoin(users, eq(users.id, userUniverse.userId))
    .leftJoin(reviewerAccess, eq(reviewerAccess.userId, userUniverse.userId))
    .where(and(eq(userUniverse.active, true), or(eq(users.role, "admin"), isNotNull(reviewerAccess.acceptedAt))));
  const tickers: Record<string, string> = {};
  for (const row of rows) tickers[String(row.cik)] ??= row.ticker;
  return { builtAt: new Date().toISOString(), ciks: [...new Set(rows.map(row => row.cik))].sort((a, b) => a - b), tickers, viewers: new Set(rows.map(row => row.userId)).size };
}

export function writeFollowed(file: string, followed: FollowedFile) { writeJsonAtomic(file, followed); }
