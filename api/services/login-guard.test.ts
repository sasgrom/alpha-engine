import { beforeEach, describe, expect, it } from "vitest";
import { LOCAL_ADDRESS, loginFailed, loginGate, loginSucceeded, resetLoginGuard, signupAllowed, signupOpen } from "./login-guard";

const T0 = 1_800_000_000_000;
beforeEach(() => resetLoginGuard());

describe("one address trying one name", () => {
  it("asks for the captcha after three failures and locks the pair after five", () => {
    for (let i = 0; i < 2; i++) loginFailed("9.9.9.9", "owner", T0 + i);
    expect(loginGate("9.9.9.9", "owner", T0 + 10)).toEqual({ locked: false, captchaRequired: false, retryAfterSec: 0 });
    loginFailed("9.9.9.9", "owner", T0 + 20);
    expect(loginGate("9.9.9.9", "owner", T0 + 30)).toMatchObject({ locked: false, captchaRequired: true });
    loginFailed("9.9.9.9", "owner", T0 + 40);
    loginFailed("9.9.9.9", "owner", T0 + 50);
    expect(loginGate("9.9.9.9", "owner", T0 + 60)).toMatchObject({ locked: true, retryAfterSec: 600 });
    // the lock ends and the old failures have aged out
    expect(loginGate("9.9.9.9", "owner", T0 + 16 * 60_000)).toMatchObject({ locked: false });
  });

  it("clears on a correct password", () => {
    for (let i = 0; i < 4; i++) loginFailed("9.9.9.9", "Owner", T0 + i);
    loginSucceeded("9.9.9.9", "owner");
    expect(loginGate("9.9.9.9", "OWNER", T0 + 10)).toEqual({ locked: false, captchaRequired: false, retryAfterSec: 0 });
  });
});

describe("an attacker who changes address on every try", () => {
  it("meets the captcha after three failures on a name, from any address", () => {
    for (let i = 0; i < 3; i++) loginFailed(`7.7.7.${i}`, "owner", T0 + i);
    expect(loginGate("8.8.8.8", "owner", T0 + 10)).toMatchObject({ locked: false, captchaRequired: true });
    expect(loginGate("8.8.8.8", "someone_else", T0 + 10)).toMatchObject({ captchaRequired: false });
  });

  it("gets the name locked for remote addresses after ten failures, but never for the home machine", () => {
    for (let i = 0; i < 10; i++) loginFailed(`7.7.7.${i}`, "owner", T0 + i);
    expect(loginGate("8.8.8.8", "owner", T0 + 100)).toMatchObject({ locked: true, retryAfterSec: 900 });
    expect(loginGate(LOCAL_ADDRESS, "owner", T0 + 100)).toMatchObject({ locked: false, captchaRequired: true });
    expect(loginGate("8.8.8.8", "owner", T0 + 16 * 60_000)).toMatchObject({ locked: false });
  });
});

describe("one address trying many names", () => {
  it("is locked for half an hour after twenty failures", () => {
    for (let i = 0; i < 19; i++) loginFailed("6.6.6.6", `user${i}`, T0 + i);
    expect(loginGate("6.6.6.6", "fresh_name", T0 + 50)).toMatchObject({ locked: false });
    loginFailed("6.6.6.6", "user19", T0 + 60);
    expect(loginGate("6.6.6.6", "fresh_name", T0 + 70)).toMatchObject({ locked: true, retryAfterSec: 1800 });
    expect(loginGate("5.5.5.5", "fresh_name", T0 + 70)).toMatchObject({ locked: false });
  });

  it("does not lock the home machine by address", () => {
    for (let i = 0; i < 25; i++) loginFailed(LOCAL_ADDRESS, `user${i}`, T0 + i);
    expect(loginGate(LOCAL_ADDRESS, "fresh_name", T0 + 70)).toMatchObject({ locked: false });
  });
});

describe("creating accounts", () => {
  it("is closed unless the owner opened it", () => {
    expect(signupOpen({})).toBe(false);
    expect(signupOpen({ SIGNUP_OPEN: "true" })).toBe(false);
    expect(signupOpen({ SIGNUP_OPEN: "1" })).toBe(true);
  });

  it("allows five an hour from one address when open", () => {
    for (let i = 0; i < 5; i++) expect(signupAllowed("4.4.4.4", T0 + i)).toBe(true);
    expect(signupAllowed("4.4.4.4", T0 + 10)).toBe(false);
    expect(signupAllowed("4.4.4.4", T0 + 3_700_000)).toBe(true);
  });
});
