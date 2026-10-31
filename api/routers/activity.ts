/**
 * Activity router (4e, D35) — the client tracker endpoint. Page views only;
 * login/signup events are written server-side inside the auth router.
 * Dedupe is client-side (AppLayout skips re-sending the same path within
 * 60 s) — the server stays dumb and honest.
 */
import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { clientIp, recordEvent } from "../services/activity";

export const activityRouter = createRouter({
  track: authedQuery
    .input(z.object({ path: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      await recordEvent(ctx.user.id, "page", { path: input.path, ip: clientIp(ctx.req.headers) });
      return { ok: true };
    }),
});
