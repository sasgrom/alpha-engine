// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_AS_KEY } from "@/providers/trpc";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function button(host: HTMLDivElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found as HTMLButtonElement;
}
async function click(host: HTMLDivElement, text: string) {
  await act(async () => { button(host, text).click(); });
}
async function setField(host: HTMLDivElement, labelText: string, value: string) {
  const label = [...host.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(labelText));
  const field = label?.querySelector("input,select,textarea") as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
  if (!field) throw new Error(`Field not found: ${labelText}`);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("desk owner tools", () => {
  let desk: MountedDesk | null = null;
  beforeEach(() => { DESK_DATA.empty = false; });
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
    vi.restoreAllMocks();
  });

  it("manages people and protects the one-time password flow and view-as return", async () => {
    const prompt = vi.spyOn(window, "prompt");
    desk = await mountDesk("admin", "/desk/admin", "Accounts");
    const host = desk.host;
    await setField(host, "Username", "new_user");
    await setField(host, "Password", "secret1");
    await setField(host, "Display name", "New User");
    await setField(host, "Role", "admin");
    await click(host, "Create account");
    await waitUntil(() => desk!.calls.includes("admin.createUser"));

    await click(host, "Reset password");
    await waitUntil(() => !!host.querySelector(".desk-generated-password"));
    const password = host.querySelector<HTMLInputElement>(".desk-generated-password")!.value;
    expect(password).toMatch(/^A9[0-9a-f]{24}$/);
    await click(host, "Confirm reset");
    await waitUntil(() => desk!.calls.includes("admin.resetPassword"));
    expect(host.textContent).toContain("The password was reset");
    expect(prompt).not.toHaveBeenCalled();
    await click(host, "Close");

    await click(host, "Promote");
    await waitUntil(() => desk!.calls.includes("admin.setUserRole"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click(host, "Delete");
    await waitUntil(() => desk!.calls.includes("admin.deleteUser"));

    await click(host, "View as");
    await waitUntil(() => (host.textContent ?? "").includes("Viewing as member"));
    expect(localStorage.getItem(VIEW_AS_KEY)).toBe("2");
    await click(host, "Exit");
    await waitUntil(() => (host.textContent ?? "").includes("Create account"));
    expect(localStorage.getItem(VIEW_AS_KEY)).toBeNull();
  });

  it("creates reviewers and runs each reviewer action through mocks", async () => {
    desk = await mountDesk("admin", "/desk/admin?tab=reviewers", "2026-11-04 12:00:00");
    const host = desk.host;
    expect(host.textContent).toContain("2026-11-04 12:00:00");
    expect(host.textContent).toContain("Bound");
    await setField(host, "Username", "new_reviewer");
    await setField(host, "Password", "secret1");
    await setField(host, "Display name", "New Reviewer");
    await click(host, "Create reviewer");
    await waitUntil(() => desk!.calls.includes("admin.createReviewer"));
    await click(host, "Reset IP+NDA");
    await waitUntil(() => desk!.calls.includes("admin.resetReviewerFirstIp"));
    await click(host, "Reset NDA");
    await waitUntil(() => desk!.calls.includes("admin.resetReviewerNda"));
    await click(host, "Reset tour");
    await waitUntil(() => desk!.calls.includes("admin.resetReviewerTour"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click(host, "Delete");
    await waitUntil(() => desk!.calls.includes("admin.deleteUser"));
  });

  it("renders manuals as documents and switches manuals", async () => {
    desk = await mountDesk("admin", "/desk/admin?tab=manuals", "Manual heading");
    const host = desk.host;
    expect(host.querySelector(".desk-markdown h1")?.textContent).toBe("Manual heading");
    expect(host.querySelector(".desk-markdown-table")?.textContent).toContain("Prices");
    expect(host.querySelector(".desk-code-block")?.textContent).toContain("const answer = 42;");
    expect(host.querySelector(".desk-markdown a")?.getAttribute("href")).toBe("https://www.sec.gov/");
    expect(host.textContent).not.toContain("# Manual heading");
    await click(host, "Engine Manual (RU)");
    expect(button(host, "Engine Manual (RU)").getAttribute("aria-pressed")).toBe("true");
  });

  it("opens a job log", async () => {
    desk = await mountDesk("admin", "/desk/admin?tab=logs", "#55 prices");
    const host = desk.host;
    expect(host.textContent).toContain("Select a job to read its log.");
    const job = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("#55 prices"))!;
    await act(async () => { job.click(); });
    await waitUntil(() => (host.textContent ?? "").includes("Price load finished"));
    expect(desk.calls).toContain("admin.jobLog");
  });

  it("shows compact monitors and preserves the worker note and SEC source", async () => {
    desk = await mountDesk("admin", "/desk/admin?tab=monitors", "assetGrowth");
    const host = desk.host;
    expect(host.textContent).toContain("assetGrowth");
    expect(host.textContent).toContain("stocktwits");
    await click(host, "Open note");
    await waitUntil(() => (host.textContent ?? "").includes("Full worker note evidence."));
    expect(host.querySelector("a[href*='sec.gov/Archives']")).not.toBeNull();
  });

  it("renders every tab's empty state", async () => {
    DESK_DATA.empty = true;
    desk = await mountDesk("admin", "/desk/admin", "No other accounts yet.");
    const host = desk.host;
    await click(host, "Reviewers");
    await waitUntil(() => (host.textContent ?? "").includes("No reviewer profiles yet."));
    await click(host, "Manuals");
    await waitUntil(() => (host.textContent ?? "").includes("No manuals available."));
    await click(host, "Logs");
    await waitUntil(() => (host.textContent ?? "").includes("No jobs yet."));
    await click(host, "Monitors");
    await waitUntil(() => (host.textContent ?? "").includes("No factor-IC observations."));
    expect(host.textContent).toContain("No worker data received yet.");
  });
});
