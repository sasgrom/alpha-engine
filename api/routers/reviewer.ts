import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { clientIp } from "../services/activity";
import { acceptReviewerNda, applyTourAction, reviewerStatus } from "../services/reviewer-access";

export const reviewerRouter = createRouter({
  status: authedQuery.query(({ ctx }) => reviewerStatus(ctx.user.id)),

  acceptNda: authedQuery.mutation(async ({ ctx }) => {
    return acceptReviewerNda(ctx.user.id, clientIp(ctx.req.headers), ctx.req.headers.get("user-agent") ?? "", ctx.user.unionId);
  }),

  tourAction: authedQuery
    .input(z.object({
      track: z.enum(["geography", "technical"]),
      action: z.enum(["start", "next", "previous", "skip_now", "dismiss_forever", "restart"]),
    }))
    .mutation(async ({ input, ctx }) => {
      return applyTourAction(ctx.user.id, input.track, input.action);
    }),
});
