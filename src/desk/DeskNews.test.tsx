// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desk news for the owner", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
  });
  const rows = () => [...desk!.host.querySelectorAll(".desk-news-row")];
  const lastNewsInput = () => desk!.queried.filter((call) => call.procedure === "desk.news").at(-1)?.input as Record<string, unknown>;

  it("lists each story once with its outlets, companies and the model's reading", async () => {
    desk = await mountDesk("admin", "/desk/news", "Apple raises its dividend a");
    expect(rows()).toHaveLength(2);
    const first = rows()[0];
    expect(first.querySelector(".desk-news-title")!.getAttribute("href")).toBe("https://www.globenewswire.com/a");
    expect(first.querySelector(".desk-news-fact")!.textContent).toBe("Apple lifts its quarterly dividend by 4%.");
    expect(first.textContent).toContain("Dividends and buybacks");
    expect(first.querySelector(".desk-news-direction")!.textContent).toBe("Positive");
    // the covered company links to its page; a company outside the desk is plain text
    expect(first.querySelector("a.desk-news-chip")!.getAttribute("href")).toBe("/desk/company/AAPL");
    expect(first.querySelector(".desk-news-chip.outside")!.textContent).toBe("PRIV");
    // the copies open on request, with when we saw each
    const more = first.querySelector(".desk-news-more") as HTMLButtonElement;
    expect(more.textContent).toBe("+1 outlet");
    act(() => more.click());
    await waitUntil(() => first.querySelector(".desk-news-sources") !== null);
    expect(first.querySelector(".desk-news-sources a")!.textContent).toBe("Benzinga");
    // a story we saw days after it was published says so, and a follow-up is marked
    expect(rows()[1].textContent).toContain("seen 4 days after publication");
    expect(rows()[1].textContent).toContain("Follow-up");
    expect(desk.host.textContent).toContain("2 read by the model");
    // the desk's own name, and only the counts the model gave
    expect(desk.host.querySelector(".desk-news-rank li")!.textContent).toMatch(/^AAPL.+2\+1$/);

    // the page starts with the covered companies of the last day, and sends every filter to the server
    // (one test: the harness keeps its query cache between mounts of a file)
    expect(lastNewsInput()).toMatchObject({ hours: 24, scope: "registry", limit: 60 });
    const select = desk.host.querySelector('select[aria-label="Kind of news"]') as HTMLSelectElement;
    act(() => {
      select.value = "mna_deal";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitUntil(() => lastNewsInput()?.event === "mna_deal");
    const newOnly = [...desk.host.querySelectorAll("label.desk-check input")][0] as HTMLInputElement;
    act(() => newOnly.click());
    await waitUntil(() => lastNewsInput()?.newOnly === true);
    const outlet = [...desk.host.querySelectorAll(".desk-news-bars button")].find((button) => button.textContent?.startsWith("Yahoo Finance")) as HTMLButtonElement;
    act(() => outlet.click());
    await waitUntil(() => lastNewsInput()?.publisher === "Yahoo Finance");
  });

  it("shows a company's news on its page, about it first", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Apple raises its dividend a");
    const card = [...desk.host.querySelectorAll("section.desk-card")].find((node) => node.querySelector("h2")?.textContent === "News")!;
    // the second story only came from Apple's company feed: it shows under every mention, not under "about it"
    expect([...card.querySelectorAll(".desk-news-title")].map((link) => link.textContent)).toEqual(["Apple raises its dividend a"]);
    const all = [...card.querySelectorAll("button")].find((button) => button.textContent === "Every mention") as HTMLButtonElement;
    act(() => all.click());
    await waitUntil(() => card.querySelectorAll(".desk-news-row").length === 2);
    // the company itself is not repeated as a chip on its own page
    expect([...card.querySelectorAll(".desk-news-chip")].map((chip) => chip.textContent)).toEqual(["PRIV"]);
  });
});
