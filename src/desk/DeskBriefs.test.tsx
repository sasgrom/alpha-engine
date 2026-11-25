// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("news briefs for the owner", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
  });

  it("opens the company's News card with its brief: top line, checked points, a failed part as its headline, the updates", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Apple raises its quarterly dividend by 4%.");
    const brief = desk.host.querySelector(".desk-brief")!;
    expect(brief.querySelector(".desk-brief-top")!.textContent).toContain("Apple raises its quarterly dividend by 4%.");
    expect(brief.querySelector(".desk-brief-price")!.textContent).toBe("Closed at $271.49 on Nov 25, +0.4% on the day.");
    const points = [...brief.querySelectorAll(".desk-brief-points > li")];
    expect(points).toHaveLength(2);
    expect(points[0].textContent).toContain("Dividend raised. Apple lifts its quarterly dividend by 4%.");
    expect(points[0].querySelector(".desk-brief-sources a")!.getAttribute("href")).toBe("https://example.com/a");
    // the part that failed the check shows the outlet's headline, marked, with the reason on hover
    expect(points[1].querySelector(".desk-brief-headline")!.textContent).toBe("Apple faces a supplier probe in Europe");
    expect(points[1].querySelector(".desk-brief-unchecked")!.getAttribute("title")).toBe("number 7 not in the sources");
    expect(brief.querySelector(".desk-brief-updates")!.textContent).toContain("The board set the record date for December 8.");
    expect(brief.querySelector(".desk-brief-foot")!.textContent).toContain("from 4 picked of 40 stories");
    expect(brief.querySelector(".desk-brief-foot")!.textContent).toContain("Left out: 20 published before the window, 10 about other companies, 2 noise, 3 commentary, 1 follow-ups.");
    const others = [...brief.querySelectorAll("button")].find((button) => button.textContent?.includes("other picked")) as HTMLButtonElement;
    act(() => others.click());
    await waitUntil(() => brief.textContent!.includes("Apple schedules its annual meeting"));
  });

  it("leads the Today card with the briefs of the followed companies, filings one click away", async () => {
    desk = await mountDesk("admin", "/desk", "Apple raises its quarterly dividend by 4%.");
    const card = [...desk.host.querySelectorAll("section.desk-card")].find((node) => node.querySelector("h2")?.textContent === "News briefs")!;
    const line = card.querySelector("a.desk-brief-line")!;
    expect(line.getAttribute("href")).toBe("/desk/company/AAPL");
    expect(line.textContent).toContain("update: The board set the record date for December 8.");
    expect(line.textContent).toContain("1 update");
    expect(card.textContent).toContain("1 followed company had no news of note.");
    const filings = [...card.querySelectorAll("button")].find((button) => button.textContent === "Filings") as HTMLButtonElement;
    act(() => filings.click());
    await waitUntil(() => card.querySelector("h2")?.textContent === "Latest filings");
  });
});
