import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { reviewerAccess, reviewerTourPreferences } from "@db/schema";
import { env } from "../lib/env";
import { NDA_TEXT, NDA_VERSION, REVIEWER_TOURS, type ReviewerTourStatus, type ReviewerTourTrack } from "@contracts/reviewer";
import { createHash } from "node:crypto";

export type { ReviewerAccess } from "@db/schema";

export const NDA_TEXT_SHA256 = createHash("sha256").update(NDA_TEXT).digest("hex");

export function hashReviewerIp(ip: string, secret = env.appSecret): string {
  const normalized = ip.trim();
  if (!normalized || normalized === "unknown") throw new TRPCError({ code: "FORBIDDEN", message: "Reviewer network could not be verified" });
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

export function firstIpDecision(existingHash: string | null, candidateHash: string): "bind" | "allow" | "deny" {
  if (!existingHash) return "bind";
  return existingHash === candidateHash ? "allow" : "deny";
}

export async function getReviewerAccess(userId: number) {
  const [row] = await getDb().select().from(reviewerAccess).where(eq(reviewerAccess.userId, userId)).limit(1);
  return row ?? null;
}

export async function bindReviewerIp(userId: number, ip: string): Promise<void> {
  const access = await getReviewerAccess(userId);
  if (!access) return;
  const candidate = hashReviewerIp(ip);
  const decision = firstIpDecision(access.firstIpHash, candidate);
  if (decision === "deny") throw new TRPCError({ code: "FORBIDDEN", message: "Reviewer access is limited to the original network. Contact the owner." });
  if (decision === "bind") {
    await getDb().update(reviewerAccess).set({ firstIpHash: candidate }).where(eq(reviewerAccess.userId, userId));
  }
}

export async function acceptReviewerNda(userId: number, ip: string, userAgent: string, sessionUnionId: string) {
  await bindReviewerIp(userId, ip);
  const access = await getReviewerAccess(userId);
  if (!access) throw new TRPCError({ code: "FORBIDDEN", message: "Reviewer profile is missing" });
  if (access.acceptedAt) return access;
  const acceptedAt = new Date();
  await getDb().update(reviewerAccess).set({
    acceptedAt,
    acceptedIpHash: hashReviewerIp(ip),
    acceptedUserAgent: userAgent.slice(0, 500),
    acceptedSessionUnionId: sessionUnionId,
    ndaVersion: NDA_VERSION,
  }).where(eq(reviewerAccess.userId, userId));
  return getReviewerAccess(userId);
}

const defaultTour = (track: ReviewerTourTrack) => ({ track, currentStep: 0, status: "not_started" as ReviewerTourStatus });

export async function getTourPreferences(userId: number) {
  const rows = await getDb().select().from(reviewerTourPreferences).where(eq(reviewerTourPreferences.userId, userId));
  return (Object.keys(REVIEWER_TOURS) as ReviewerTourTrack[]).map((track) => {
    const row = rows.find((item) => item.track === track);
    return row ?? defaultTour(track);
  });
}

export type ReviewerTourAction = "start" | "next" | "previous" | "skip_now" | "dismiss_forever" | "restart";

export function nextTourState(current: { currentStep: number; status: string }, track: ReviewerTourTrack, action: ReviewerTourAction): { currentStep: number; status: ReviewerTourStatus } {
  const lastStep = REVIEWER_TOURS[track].steps.length - 1;
  if (action === "start" || action === "restart") return { currentStep: 0, status: "in_progress" as ReviewerTourStatus };
  if (action === "skip_now") return { currentStep: current.currentStep, status: "not_started" as ReviewerTourStatus };
  if (action === "dismiss_forever") return { currentStep: current.currentStep, status: "dismissed_forever" as ReviewerTourStatus };
  if (action === "previous") return { currentStep: Math.max(0, current.currentStep - 1), status: "in_progress" as ReviewerTourStatus };
  if (action === "next") {
    if (current.currentStep >= lastStep) return { currentStep: lastStep, status: "completed" as ReviewerTourStatus };
    return { currentStep: current.currentStep + 1, status: "in_progress" as ReviewerTourStatus };
  }
  return { ...current, status: current.status as ReviewerTourStatus };
}

export async function applyTourAction(userId: number, track: ReviewerTourTrack, action: ReviewerTourAction) {
  const access = await getReviewerAccess(userId);
  if (!access?.acceptedAt) throw new TRPCError({ code: "FORBIDDEN", message: "NDA required" });
  const preferences = await getTourPreferences(userId);
  const current = preferences.find((item) => item.track === track) ?? defaultTour(track);
  const next = nextTourState(current, track, action);
  const db = getDb();
  const existing = await db.select().from(reviewerTourPreferences).where(and(eq(reviewerTourPreferences.userId, userId), eq(reviewerTourPreferences.track, track))).limit(1);
  if (existing.length) {
    await db.update(reviewerTourPreferences).set(next).where(and(eq(reviewerTourPreferences.userId, userId), eq(reviewerTourPreferences.track, track)));
  } else {
    await db.insert(reviewerTourPreferences).values({ userId, track, ...next });
  }
  return getTourPreferences(userId);
}

export async function reviewerStatus(userId: number) {
  const access = await getReviewerAccess(userId);
  return {
    isReviewer: Boolean(access),
    ndaAccepted: Boolean(access?.acceptedAt),
    ndaVersion: access?.ndaVersion ?? NDA_VERSION,
    ndaTextHash: NDA_TEXT_SHA256,
    firstIpBound: Boolean(access?.firstIpHash),
    tours: await getTourPreferences(userId),
  };
}
