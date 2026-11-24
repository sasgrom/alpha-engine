// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountDesk, waitUntil, type MountedDesk } from "../desk-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let desk: MountedDesk | null = null;
afterEach(() => {
  desk?.unmount();
  desk = null;
});

const headers = () => [...desk!.host.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
const rowOf = (ticker: string) => [...desk!.host.querySelectorAll("tbody tr")].find((row) => row.querySelector(".desk-ticker")?.textContent?.startsWith(ticker)) as HTMLTableRowElement;
const cells = (ticker: string) => Object.fromEntries([...rowOf(ticker).querySelectorAll("td")].map((cell, index) => [headers()[index], cell.textContent?.trim()]));
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
};
const button = (label: string) => [...desk!.host.querySelectorAll("button")].find((item) => item.textContent?.trim().startsWith(label));

describe("the desk Screener", () => {
  it("opens on the performance columns and keeps the fundamentals for the other view", async () => {
    desk = await mountDesk("user", "/desk/screener", "3 of 3 companies");
    expect(headers()).toEqual(["Company", "Sector", "Price", "1D", "1W", "1M", "YTD", "1Y", "12−1M", "Market value", "Beta", "Volatility", "52-week range", "3 months", "Next report"]);
    expect(desk.host.querySelector(".desk-seg [aria-pressed=true]")?.textContent).toBe("Performance");
  });

  it("shows the fundamentals from the filings data: earnings per share, P/E on them, growth, margins and volume", async () => {
    desk = await mountDesk("user", "/desk/screener?view=fundamentals", "3 of 3 companies");
    await waitUntil(() => (rowOf("AAPL").textContent ?? "").includes("Sep 2026"));
    expect(headers()).toEqual(["Company", "Sector", "Price", "Market value", "P/E", "EPS", "Revenue", "Growth", "Net margin", "FCF margin", "Yield", "Volume", "Quarter"]);
    // price 100 over 5.00 a share; 400 against 320 billion; 100 and 80 of 400 billion
    expect(cells("AAPL")).toMatchObject({ "P/E": "20.0", EPS: "5.00", Revenue: "$400B", Growth: "+25.0%", "Net margin": "25.0%", "FCF margin": "20.0%", Volume: "$14.60B", Quarter: "Sep 2026" });
    // a loss has no P/E, and nothing is computed from a figure the file does not have
    expect(cells("NVDA")).toMatchObject({ "P/E": "—", EPS: "−2.00", Growth: "—", "Net margin": "−5.0%", "FCF margin": "—", Quarter: "Oct 2026" });
    expect(rowOf("NVDA").querySelector("[title^='Net income of the four quarters']")).toBeTruthy();
    // no row in the file: Schwab's per-share figures stand in, marked
    expect(cells("MSFT")).toMatchObject({ "P/E": "30.0", EPS: "3.00", Revenue: "—", Quarter: "—" });
    expect(rowOf("MSFT").querySelectorAll("[title^='Schwab']")).toHaveLength(2);
    expect(desk.host.textContent).toContain("standard fundamentals v3.2");
  });

  it("sorts by a fundamentals column and goes back to the market value when the view no longer shows it", async () => {
    desk = await mountDesk("user", "/desk/screener?view=fundamentals", "3 of 3 companies");
    await waitUntil(() => (rowOf("AAPL").textContent ?? "").includes("Sep 2026"));
    const order = () => [...desk!.host.querySelectorAll("tbody .desk-ticker")].map((cell) => cell.textContent?.replace("Research", ""));
    await click(button("EPS"));
    // highest first, Schwab's stand-in figure among them
    expect(order()).toEqual(["AAPL", "MSFT", "NVDA"]);
    await click(button("Performance"));
    await waitUntil(() => headers().includes("Beta"));
    expect(order()).toEqual(["AAPL", "NVDA", "MSFT"]);
  });
});
