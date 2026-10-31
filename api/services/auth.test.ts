// Unit tests for 4d (D33) auth primitives: scrypt hashing, captcha, guard.
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, passwordPolicyError, usernamePolicyError } from "./passwords";
import { issueCaptcha, verifyCaptcha } from "./captcha";
import { loginGate, loginFailed, loginSucceeded, signupAllowed } from "./login-guard";

describe("passwords (scrypt)", () => {
  it("round-trips a correct password and rejects a wrong one", async () => {
    const h = await hashPassword("s3cret!");
    expect(h.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("s3cret!", h)).toBe(true);
    expect(await verifyPassword("s3cret?", h)).toBe(false);
  });
  it("salts differ for identical passwords", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
  it("fails closed on malformed/null stored hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("policies", () => {
  it("password policy: min 8 + letter + digit", () => {
    expect(passwordPolicyError("short1")).toBeTruthy();
    expect(passwordPolicyError("onlyletters")).toBeTruthy();
    expect(passwordPolicyError("12345678")).toBeTruthy();
    expect(passwordPolicyError("goodpass1")).toBeNull();
  });
  it("username policy: 3–32 [a-zA-Z0-9_]", () => {
    expect(usernamePolicyError("ab")).toBeTruthy();
    expect(usernamePolicyError("bad name!")).toBeTruthy();
    expect(usernamePolicyError("fine_user9")).toBeNull();
  });
});

describe("captcha", () => {
  it("issues an svg and verifies the right answer one-shot", () => {
    const { id, svg } = issueCaptcha();
    expect(svg).toContain("<svg");
    // chars render as separate <text> elements (anti-OCR jitter) — reassemble
    const text = [...svg.matchAll(/>([^<])<\/text>/g)].map((m) => m[1]).join("");
    const m = text.match(/^(\d+) ([+−]) (\d+) = \?$/);
    expect(m).toBeTruthy();
    const answer = String(m![2] === "−" ? Number(m![1]) - Number(m![3]) : Number(m![1]) + Number(m![3]));
    expect(verifyCaptcha(id, answer)).toBe(true);
    expect(verifyCaptcha(id, answer)).toBe(false); // one-shot
  });
  it("rejects wrong answers and unknown ids", () => {
    const { id } = issueCaptcha();
    expect(verifyCaptcha(id, "definitely-wrong")).toBe(false);
    expect(verifyCaptcha("nope", "1")).toBe(false);
    expect(verifyCaptcha(undefined, undefined)).toBe(false);
  });
});

describe("login-guard", () => {
  it("escalates: captcha after 3 fails, lock after 5, success resets", () => {
    const ip = "10.0.0.1";
    const u = "guarded";
    expect(loginGate(ip, u)).toEqual({ locked: false, captchaRequired: false, retryAfterSec: 0 });
    loginFailed(ip, u);
    loginFailed(ip, u);
    expect(loginGate(ip, u).captchaRequired).toBe(false);
    loginFailed(ip, u);
    expect(loginGate(ip, u).captchaRequired).toBe(true);
    loginFailed(ip, u);
    loginFailed(ip, u);
    const g5 = loginGate(ip, u);
    expect(g5.locked).toBe(true);
    expect(g5.retryAfterSec).toBeGreaterThan(0);
    loginSucceeded(ip, u);
    expect(loginGate(ip, u)).toEqual({ locked: false, captchaRequired: false, retryAfterSec: 0 });
  });
  it("signup throttle: 5 per ip per hour", () => {
    const ip = "10.0.0.9";
    for (let i = 0; i < 5; i++) expect(signupAllowed(ip)).toBe(true);
    expect(signupAllowed(ip)).toBe(false);
  });
});
