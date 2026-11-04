import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { firstIpDecision, hashReviewerIp, nextTourState } from "./reviewer-access";
import { NDA_TEXT } from "@contracts/reviewer";

describe("reviewer first-IP binding", () => {
  it("hashes rather than storing a raw address and never accepts unknown", () => {
    const a = hashReviewerIp("203.0.113.9", "secret-a");
    const b = hashReviewerIp("203.0.113.9", "secret-b");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("203.0.113.9");
    expect(() => hashReviewerIp("unknown", "secret-a")).toThrow();
  });

  it("binds once, accepts the same network and rejects a different one", () => {
    expect(firstIpDecision(null, "hash-a")).toBe("bind");
    expect(firstIpDecision("hash-a", "hash-a")).toBe("allow");
    expect(firstIpDecision("hash-a", "hash-b")).toBe("deny");
  });
});

describe("reviewer tour state", () => {
  it("starts, advances, goes back, completes and restarts", () => {
    let state = nextTourState({ currentStep: 0, status: "not_started" }, "geography", "start");
    expect(state).toEqual({ currentStep: 0, status: "in_progress" });
    state = nextTourState(state, "geography", "next");
    expect(state.currentStep).toBe(1);
    state = nextTourState(state, "geography", "previous");
    expect(state.currentStep).toBe(0);
    state = nextTourState({ currentStep: 6, status: "in_progress" }, "geography", "next");
    expect(state).toEqual({ currentStep: 6, status: "completed" });
    state = nextTourState(state, "geography", "restart");
    expect(state).toEqual({ currentStep: 0, status: "in_progress" });
  });

  it("distinguishes skip-now from never-show", () => {
    expect(nextTourState({ currentStep: 2, status: "in_progress" }, "technical", "skip_now")).toEqual({ currentStep: 2, status: "not_started" });
    expect(nextTourState({ currentStep: 2, status: "in_progress" }, "technical", "dismiss_forever")).toEqual({ currentStep: 2, status: "dismissed_forever" });
  });
});

describe("NDA text integrity", () => {
  it("hashes the exact versioned NDA text", async () => {
    const { NDA_TEXT_SHA256 } = await import("./reviewer-access");
    expect(NDA_TEXT_SHA256).toBe(createHash("sha256").update(NDA_TEXT).digest("hex"));
  });
});
