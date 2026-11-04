/**
 * Shared point-in-time selection for legacy MySQL macro readers.
 * The normalized FRED archive and Scenario Engine retain their own guarded path.
 */
import { and, desc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { macroPoints, type MacroPoint } from "@db/schema";

export type MacroVintageDatabase = ReturnType<typeof getDb>;

function macroVintageWindow(anchor: string) {
  // A null start is unknown availability; a null end is open-ended, and the end is inclusive.
  return and(
    lte(macroPoints.date, anchor),
    isNotNull(macroPoints.realtimeStart),
    lte(macroPoints.realtimeStart, anchor),
    or(isNull(macroPoints.realtimeEnd), gte(macroPoints.realtimeEnd, anchor)),
  );
}

/** Return the single newest eligible vintage for one series at the anchor.
 * Null values stay missing. SQL bounds the read instead of loading series history.
 */
export async function latestEligibleMacroPoint(
  seriesId: string,
  anchor: string,
  db: MacroVintageDatabase = getDb(),
): Promise<MacroPoint | undefined> {
  const [row] = await db
    .select()
    .from(macroPoints)
    .where(and(eq(macroPoints.seriesId, seriesId), macroVintageWindow(anchor)))
    .orderBy(desc(macroPoints.date), desc(macroPoints.realtimeStart), desc(macroPoints.id))
    .limit(1);
  return row;
}
