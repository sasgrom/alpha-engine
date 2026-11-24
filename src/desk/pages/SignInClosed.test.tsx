// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { FAILURES, mountDesk, SIGNED_OUT, SIGNUP, type MountedDesk } from "../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
  SIGNUP.open = true;
  for (const key of Object.keys(FAILURES)) delete FAILURES[key];
});

describe("sign-in while accounts are created by the owner only", () => {
  it("does not offer to create an account", async () => {
    SIGNUP.open = false;
    FAILURES["auth.me"] = SIGNED_OUT;
    desk = await mountDesk("user", "/desk", "Accounts are created by the owner.", true);
    expect(desk.host.querySelector("h1")?.textContent).toBe("Sign in");
    expect(desk.host.textContent).not.toContain("Create one");
    expect(desk.host.querySelector('a[href^="/signup"]')).toBeNull();
  });

  it("sends a visitor who opens the sign-up address to sign in", async () => {
    SIGNUP.open = false;
    FAILURES["auth.me"] = SIGNED_OUT;
    desk = await mountDesk("user", "/signup", "Accounts are created by the owner.", true);
    expect(desk.host.querySelector("h1")?.textContent).toBe("Sign in");
    expect(desk.host.querySelector("#desk-signin-confirm")).toBeNull();
  });
});
