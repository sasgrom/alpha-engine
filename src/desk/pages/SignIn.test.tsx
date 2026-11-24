// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FAILURES, mountDesk, SIGNED_OUT, waitUntil, type MountedDesk } from "../desk-test-harness";
import { returnPath } from "./SignIn";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
  for (const key of Object.keys(FAILURES)) delete FAILURES[key];
});

const text = () => desk!.host.textContent ?? "";
const field = (id: string) => desk!.host.querySelector(`#desk-signin-${id}`) as HTMLInputElement;
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submitButton = () => desk!.host.querySelector("button[type=submit]") as HTMLButtonElement;
const submit = async () => { await act(async () => { submitButton().click(); }); };

describe("where a visitor returns after signing in", () => {
  it("accepts a page of this site and nothing else", () => {
    expect(returnPath("/desk/company/AAPL?range=1Y")).toBe("/desk/company/AAPL?range=1Y");
    expect(returnPath("/desk/research/macro?view=scenarios")).toBe("/desk/research/macro?view=scenarios");
    for (const bad of [null, "", "//evil.example/desk", "https://evil.example", "desk", "/login?next=/desk", "/signup", "/desk\\evil"]) expect(returnPath(bad)).toBe("/");
  });
});

describe("signing in to the desk", () => {
  it("sends a visitor without a session to sign in and brings them back to the page they asked for", async () => {
    FAILURES["auth.me"] = SIGNED_OUT;
    desk = await mountDesk("user", "/desk/screener?view=fundamentals", "No account yet?", true);
    expect(desk.host.querySelector("h1")?.textContent).toBe("Sign in");
    // no sum is asked for on a first attempt
    expect(field("sum")).toBeNull();
    expect(submitButton().disabled).toBe(true);
    await type(field("name"), " ada ");
    await type(field("password"), "secret-123");
    expect(submitButton().disabled).toBe(false);
    delete FAILURES["auth.me"];
    await submit();
    await waitUntil(() => text().includes("3 of 3 companies"));
    expect(desk.posted[0]).toEqual({ procedure: "auth.login", input: { username: "ada", password: "secret-123" } });
    // the view asked for, not the desk's first page
    expect([...desk.host.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim())).toContain("P/E");
  });

  it("says why a sign-in failed, and asks for the sum once the server wants one", async () => {
    FAILURES["auth.login"] = { code: "UNAUTHORIZED", httpStatus: 401, message: "Invalid username or password" };
    desk = await mountDesk("user", "/login", "No account yet?", true);
    await type(field("name"), "ada");
    await type(field("password"), "wrong");
    await submit();
    await waitUntil(() => !!desk!.host.querySelector("[role=alert]"));
    expect(desk.host.querySelector("[role=alert]")?.textContent).toBe("Invalid username or password.");
    FAILURES["auth.login"] = { code: "BAD_REQUEST", httpStatus: 400, message: "captcha required or invalid" };
    await submit();
    await waitUntil(() => !!field("sum") && !!desk!.host.querySelector(".desk-signin-svg svg"));
    expect(desk.host.querySelector("[role=alert]")?.textContent).toBe("Solve the sum below to go on: there were several failed attempts.");
    // the button waits for the answer, and the answer travels with the sum's id
    expect(submitButton().disabled).toBe(true);
    await type(field("sum"), "7");
    delete FAILURES["auth.login"];
    await submit();
    await waitUntil(() => desk!.posted.length >= 3);
    expect(desk.posted[2]).toEqual({ procedure: "auth.login", input: { username: "ada", password: "wrong", captchaId: "sum-1", captchaAnswer: "7" } });
  });
});

describe("creating an account in the desk", () => {
  it("asks for the sum at once, holds the button until the rules are met, and sends the account with the sum", async () => {
    desk = await mountDesk("user", "/signup", "Already have an account?", true);
    expect(desk.host.querySelector("h1")?.textContent).toBe("Create an account");
    await waitUntil(() => !!desk!.host.querySelector(".desk-signin-svg svg"));
    await type(field("name"), "a!");
    await type(field("password"), "short");
    await type(field("confirm"), "other");
    expect([...desk.host.querySelectorAll(".desk-signin-hint[data-bad=true]")].map((hint) => hint.textContent)).toEqual([
      "3 to 32 letters, digits or underscores.", "At least 12 characters, with a letter and a digit.", "The two passwords differ.",
    ]);
    expect(submitButton().disabled).toBe(true);
    await type(field("name"), "ada_2");
    await type(field("password"), "longer-pass-1");
    await type(field("confirm"), "longer-pass-1");
    expect(submitButton().disabled).toBe(true);
    await type(field("sum"), "7");
    expect(desk.host.querySelectorAll(".desk-signin-hint[data-bad=true]")).toHaveLength(0);
    expect(submitButton().disabled).toBe(false);
    FAILURES["auth.signup"] = { code: "CONFLICT", httpStatus: 409, message: "username is taken" };
    await submit();
    await waitUntil(() => !!desk!.host.querySelector("[role=alert]"));
    expect(desk.host.querySelector("[role=alert]")?.textContent).toBe("That username is taken.");
    expect(desk.posted[0]).toEqual({ procedure: "auth.signup", input: { username: "ada_2", password: "longer-pass-1", captchaId: "sum-1", captchaAnswer: "7" } });
    // a failed attempt uses the sum up: the answer is cleared for the new one
    expect(field("sum").value).toBe("");
  });
});
