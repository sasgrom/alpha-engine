// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FAILURES, mountDesk, SIGNED_OUT, waitUntil, type MountedDesk } from "../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
  for (const key of Object.keys(FAILURES)) delete FAILURES[key];
});

const field = (id: string) => desk!.host.querySelector(`#desk-signin-${id}`) as HTMLInputElement;
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submitButton = () => desk!.host.querySelector("button[type=submit]") as HTMLButtonElement;
const submit = async () => { await act(async () => { submitButton().click(); }); };

describe("signing in to an account with a second factor", () => {
  it("asks for the code only after the server says so, and sends it with the password", async () => {
    FAILURES["auth.me"] = SIGNED_OUT;
    desk = await mountDesk("user", "/desk", "Sign in", true);
    expect(field("code")).toBeNull();
    await type(field("name"), "ada");
    await type(field("password"), "secret-123");
    FAILURES["auth.login"] = { code: "PRECONDITION_FAILED", httpStatus: 412, message: "second factor required" };
    await submit();
    await waitUntil(() => !!field("code"));
    expect(desk.host.querySelector("[role=alert]")?.textContent).toBe("Enter the 6-digit code from your authenticator app.");
    // the button waits for six characters
    expect(submitButton().disabled).toBe(true);
    await type(field("code"), "123 456");
    expect(submitButton().disabled).toBe(false);
    delete FAILURES["auth.login"];
    delete FAILURES["auth.me"];
    await submit();
    await waitUntil(() => desk!.posted.filter((call) => call.procedure === "auth.login").length === 2);
    expect(desk.posted.filter((call) => call.procedure === "auth.login")[1].input).toEqual({ username: "ada", password: "secret-123", code: "123 456" });
  });
});
