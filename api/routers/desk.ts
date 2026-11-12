/**
 * Desk view (the new standalone UI at /desk). One read: the precomputed market snapshot, for every signed-in user;
 * option-derived fields only for the owner and NDA-accepted reviewers (see services/desk-snapshot.ts).
 */
import { createRouter, authedQuery } from "../middleware";
import { deskSnapshotFor, readDeskSnapshot } from "../services/desk-snapshot";

export const deskRouter = createRouter({
  snapshot: authedQuery.query(({ ctx }) => {
    const snapshot = readDeskSnapshot();
    if (!snapshot) return null;
    const presentation = ctx.user.role === "admin" || Boolean(ctx.reviewerAccess?.acceptedAt);
    return deskSnapshotFor(snapshot, presentation);
  }),
});
