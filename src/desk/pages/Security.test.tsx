// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, SECURITY, waitUntil, type MountedDesk } from "../desk-test-harness";
import { deviceLabel } from "./Security";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
  SECURITY.secondFactor = { enabled: false, enabledAt: null, recoveryCodesLeft: 0 };
});

const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const button = (label: string) => [...desk!.host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label) as HTMLButtonElement;
const click = async (label: string) => { await act(async () => { button(label).click(); }); };

describe("a device in a few words", () => {
  it("names the browser and the system", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone or iPad");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/142.0 Safari/537.36 Edg/142.0")).toBe("Edge on Windows");
    expect(deviceLabel(null)).toBe("Unknown device");
  });
});

describe("the Security page", () => {
  it("sets up the second factor: password, QR code and key, a code, then the recovery codes once", async () => {
    desk = await mountDesk("admin", "/desk/security", "Second factor");
    expect(desk.host.textContent).toContain("Off");
    expect(button("Set it up").disabled).toBe(true);
    await type(desk.host.querySelector("#security-password") as HTMLInputElement, "my-password-123");
    await click("Set it up");
    await waitUntil(() => !!desk!.host.querySelector("[data-secret]"));
    expect(desk.posted.at(-1)).toEqual({ procedure: "auth.secondFactorBegin", input: { password: "my-password-123" } });
    expect(desk.host.querySelector("[data-secret]")?.textContent).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    expect(desk.host.querySelector('[role="img"] svg')).not.toBeNull();
    expect(button("Turn it on").disabled).toBe(true);
    await type(desk.host.querySelector("#security-code") as HTMLInputElement, "123456");
    await click("Turn it on");
    await waitUntil(() => !!desk!.host.querySelector("[data-recovery-codes]"));
    expect(desk.posted.at(-1)).toEqual({ procedure: "auth.secondFactorEnable", input: { code: "123456" } });
    expect(desk.host.querySelector("[data-recovery-codes]")?.textContent).toContain("aaaaa-bbbbb");
    // the secret is gone from the page once the factor is on
    expect(desk.host.querySelector("[data-secret]")).toBeNull();
  });

  it("lists the sessions, marks this browser and ends another one", async () => {
    desk = await mountDesk("admin", "/desk/security", "Where you are signed in");
    const rows = [...desk.host.querySelectorAll("[data-sessions] .desk-list-row")].map((row) => row.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Chrome on Windows");
    expect(rows[0]).toContain("this browser");
    expect(rows[0]).toContain("from this machine");
    expect(rows[0]).not.toContain("End");
    expect(rows[1]).toContain("Safari on iPhone or iPad");
    expect(rows[1]).toContain("100.82.217.81");
    await click("End");
    await waitUntil(() => desk!.posted.some((call) => call.procedure === "auth.revokeSession"));
    expect(desk.posted.find((call) => call.procedure === "auth.revokeSession")?.input).toEqual({ id: 5 });
    await click("Sign out everywhere else");
    await waitUntil(() => desk!.posted.some((call) => call.procedure === "auth.revokeOtherSessions"));
  });
});
