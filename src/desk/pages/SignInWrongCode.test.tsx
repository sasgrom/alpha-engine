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

// its own file: the harness keeps the signed-in state between the tests of one file
describe("a wrong second-factor code at sign-in", () => {
  it("says when the code was wrong and clears the field", async () => {
    FAILURES["auth.me"] = SIGNED_OUT;
    desk = await mountDesk("user", "/desk", "Sign in", true);
    await type(field("name"), "ada");
    await type(field("password"), "secret-123");
    FAILURES["auth.login"] = { code: "UNAUTHORIZED", httpStatus: 401, message: "Invalid code" };
    await submit();
    await waitUntil(() => !!field("code"));
    expect(desk.host.querySelector("[role=alert]")?.textContent).toBe("That code is not right. Wait for the next one and try again.");
    expect(field("code").value).toBe("");
  });
});
