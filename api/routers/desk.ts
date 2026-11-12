/**
 * Desk view (the new standalone UI at /desk). Reads only:
 * - the precomputed market snapshot, for every signed-in user; option-derived fields only for the owner and
 *   NDA-accepted reviewers (see services/desk-snapshot.ts);
 * - the fund-flow files (overview, one fund, one company), for every signed-in user (owner's decision of
 *   2026-11-11); reviewers reach them, like everything else, only after accepting the NDA (middleware).
 */
import { z } from "zod";
import type { FundFlowsCompany, FundFlowsFund, FundFlowsOverview } from "@contracts/fund-flows";
import { createRouter, authedQuery } from "../middleware";
import { deskSnapshotFor, readDeskSnapshot } from "../services/desk-snapshot";
import { readFundFlowsFile } from "../services/fund-flows-files";

const entity = z.object({ cik: z.number().int().positive() });

export const deskRouter = createRouter({
  snapshot: authedQuery.query(({ ctx }) => {
    const snapshot = readDeskSnapshot();
    if (!snapshot) return null;
    const presentation = ctx.user.role === "admin" || Boolean(ctx.reviewerAccess?.acceptedAt);
    return deskSnapshotFor(snapshot, presentation);
  }),
  flowsOverview: authedQuery.query(() => readFundFlowsFile<FundFlowsOverview>("overview.json")),
  flowsFund: authedQuery.input(entity).query(({ input }) => readFundFlowsFile<FundFlowsFund>(`fund/${input.cik}.json`)),
  flowsCompany: authedQuery.input(entity).query(({ input }) => readFundFlowsFile<FundFlowsCompany>(`company/${input.cik}.json`)),
});
