// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk news for a member", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("shows the headlines without the model's readings or their filters", async () => {
    desk = await mountDesk("user", "/desk/news", "Apple raises its dividend a");
    expect(desk.host.querySelectorAll(".desk-news-row")).toHaveLength(2);
    expect(desk.host.querySelector(".desk-news-fact")).toBeNull();
    expect(desk.host.querySelector(".desk-news-direction")).toBeNull();
    expect(desk.host.querySelector('select[aria-label="Kind of news"]')).toBeNull();
    expect(desk.host.textContent).not.toContain("read by the model");
    expect(desk.host.textContent).not.toContain("What kind of news");
  });
});
