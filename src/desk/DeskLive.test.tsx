// @vitest-environment jsdom
// Own file: the desk caches its snapshot query for five minutes, so live prices need a fresh query client.
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, SNAPSHOT, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk view during a session", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    delete SNAPSHOT.live;
  });

  it("marks the prices live and says when they were taken, in the header and the footer", async () => {
    SNAPSHOT.live = { session: SNAPSHOT.session, asOf: "2026-11-13T18:39:55.000Z", capturedAt: "2026-11-13T18:40:05.000Z", quotes: 503 };
    desk = await mountDesk("admin");
    const eyebrow = desk.host.querySelector(".desk-eyebrow");
    expect(eyebrow?.textContent).toMatch(/Live · prices as of \d{1,2}:\d{2}.*, refreshed every 20 minutes/);
    expect(eyebrow?.querySelector(".desk-live-dot")).not.toBeNull();
    expect(desk.host.querySelector(".desk-footer")?.textContent).toMatch(/live prices as of \d{1,2}:\d{2}/);
    expect(desk.host.textContent).toContain("extremes at the latest live prices");
  });
});
