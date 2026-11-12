/**
 * Desk view (the new standalone UI at /desk). Reads only:
 * - the precomputed market snapshot, for every signed-in user; option-derived fields only for the owner and
 *   NDA-accepted reviewers (see services/desk-snapshot.ts);
 * - the fund-flow files (overview, one fund, one company) for the research audience: the owner and reviewers who
 *   accepted the NDA, as for the classic research pages.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { FundFlowsCompany, FundFlowsFund, FundFlowsOverview } from "@contracts/fund-flows";
import { createRouter, authedQuery } from "../middleware";
import { deskSnapshotFor, readDeskSnapshot } from "../services/desk-snapshot";
import { readFundFlowsFile } from "../services/fund-flows-files";

const researchQuery = authedQuery.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && !ctx.reviewerAccess?.acceptedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Research content is limited to the owner and reviewers who accepted the NDA" });
  }
  return next();
});
const entity = z.object({ cik: z.number().int().positive() });

export const deskRouter = createRouter({
  snapshot: authedQuery.query(({ ctx }) => {
    const snapshot = readDeskSnapshot();
    if (!snapshot) return null;
    const presentation = ctx.user.role === "admin" || Boolean(ctx.reviewerAccess?.acceptedAt);
    return deskSnapshotFor(snapshot, presentation);
  }),
  flowsOverview: researchQuery.query(() => readFundFlowsFile<FundFlowsOverview>("overview.json")),
  flowsFund: researchQuery.input(entity).query(({ input }) => readFundFlowsFile<FundFlowsFund>(`fund/${input.cik}.json`)),
  flowsCompany: researchQuery.input(entity).query(({ input }) => readFundFlowsFile<FundFlowsCompany>(`company/${input.cik}.json`)),
});
