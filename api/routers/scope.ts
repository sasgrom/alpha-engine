/**
 * Iteration-3a tRPC router: scope presets ("which tickers to process").
 * Grammar and logic live in services/scope.ts; here are only the
 * authenticated endpoints for the Universe page (scope builder with manual
 * exclusion) and Jobs (selection-size preview before launching a job).
 * No heavy operations: enrichClassification reads the static GICS snapshot
 * (offline) + targeted UPDATEs — it stays a synchronous mutation.
 */
import { z } from "zod";
import { createRouter, authedQuery, adminQuery, effectiveUserId } from "../middleware";
import * as scope from "../services/scope";

export const scopeRouter = createRouter({
  /** Group catalog: indexes + distinct sector/industry from the DB. */
  groups: authedQuery.query(() => scope.scopeGroups()),

  /** Group members for the chip UI with manual ticker exclusion. */
  members: authedQuery
    .input(z.object({ base: z.string().min(1) }))
    .query(({ input }) => scope.scopeMembers(input.base)),

  /**
   * Resolve preview: how many tickers remain after exclude.
   * The Jobs page calls this debounced while the fields are being edited.
   * 4c (D30): "universe" and presets resolve against the CALLER's universe.
   */
  resolvePreview: authedQuery
    .input(z.object({ base: z.string().min(1), exclude: z.string().default("") }))
    .query(async ({ input, ctx }) => {
      const r = await scope.resolveScope(input.base, input.exclude, effectiveUserId(ctx));
      return { count: r.tickers.length, baseCount: r.baseCount, excluded: r.excluded, sample: r.tickers.slice(0, 20) };
    }),

  /** Saved selection presets — PER-USER since 4c (D30). */
  presets: authedQuery.query(({ ctx }) => scope.listPresets(ctx.user.id)),

  savePreset: authedQuery
    .input(
      z.object({
        name: z.string().min(1).max(48),
        base: z.string().min(1),
        exclude: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await scope.savePreset(input.name, { base: input.base, exclude: input.exclude.map((t) => t.toUpperCase()) }, ctx.user.id);
      return { ok: true };
    }),

  deletePreset: authedQuery
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await scope.deletePreset(input.name, ctx.user.id);
      return { ok: true };
    }),

  /**
   * Manual GICS re-enrichment (admin only, kept as the ops trigger — 3d).
   * Automatic enrichment already runs at the end of every bootstrap job
   * (D16); this endpoint exists for cases like a refreshed snapshot or
   * hand-imported rows. Returns the full breakdown (matched / unmatched
   * with reasons) so the UI toast can say exactly what happened.
   */
  enrichClassification: adminQuery.mutation(() => scope.enrichClassification()),
});
