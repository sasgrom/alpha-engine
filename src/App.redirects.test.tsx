// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "./desk/desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the old addresses of the classic view, for the owner", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  // each old address opens the desk page that took it over; the old landing pages and unknown addresses open Today
  it.each([
    ["/company/AAPL", "Financial statements"],
    ["/expectations", "Changes of guidance"],
    ["/insider-activity", "Latest insider purchases"],
    ["/screener", "3 of 3 companies"],
    ["/terminal", "S&P 500 companies closed higher"],
    ["/dashboard", "S&P 500 companies closed higher"],
    ["/database", "Data health"],
    ["/no-such-page", "S&P 500 companies closed higher"],
  ])("opens the desk from the old address %s", async (address, shown) => {
    desk = await mountDesk("admin", address, shown, true);
    expect(desk.host.querySelector(".desk-root")).not.toBeNull();
  });
});
