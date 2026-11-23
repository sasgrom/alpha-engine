// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DESK_DATA, mountDesk, waitUntil, type MountedDesk } from "./desk-test-harness";
import { priceRisk, returnBins } from "./pages/company/price-risk";
import { binTitle } from "./pages/company/Risk";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const closes = (values: number[]) => values.map((close, index) => ({ date: `2026-11-${String(index + 2).padStart(2, "0")}`, close }));

describe("what a run of closes says about risk", () => {
  it("measures the return, the largest fall from a high with its dates, and where the price stands now", () => {
    const risk = priceRisk(closes([100, 102, 104, 110, 99, 88, 90, 92, 91, 95, 96.8]))!;
    expect(risk).toMatchObject({ sessions: 11, from: "2026-11-02", to: "2026-11-12", peakDate: "2026-11-05", troughDate: "2026-11-07" });
    expect(risk.totalReturn).toBeCloseTo(-0.032, 10);
    expect(risk.maxDrawdown).toBeCloseTo(-0.2, 10);
    expect(risk.currentDrawdown).toBeCloseTo(96.8 / 110 - 1, 10);
    expect(risk.best).toMatchObject({ date: "2026-11-05" });
    expect(risk.best!.value).toBeCloseTo(110 / 104 - 1, 10);
    expect(risk.worst).toMatchObject({ date: "2026-11-07" });
    expect(risk.upShare).toBeCloseTo(0.7, 10);
    expect(risk.drawdown.map((row) => Number(row.value.toFixed(3))).slice(0, 6)).toEqual([0, 0, 0, 0, -0.1, -0.2]);
    // annualized volatility: sample standard deviation of the ten daily returns × √252
    const returns = [102 / 100, 104 / 102, 110 / 104, 99 / 110, 88 / 99, 90 / 88, 92 / 90, 91 / 92, 95 / 91, 96.8 / 95].map((ratio) => ratio - 1);
    const mean = returns.reduce((a, b) => a + b, 0) / 10;
    expect(risk.annualVolatility).toBeCloseTo(Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / 9) * Math.sqrt(252), 10);
  });

  it("is at the high when the run only rose, and gives nothing for fewer than three closes", () => {
    const risk = priceRisk(closes([10, 11, 12, 13]))!;
    expect(risk.maxDrawdown).toBe(0);
    expect(risk.currentDrawdown).toBe(0);
    expect(priceRisk(closes([10, 11]))).toBeNull();
    expect(priceRisk([{ date: "2026-11-02", close: 0 }, { date: "2026-11-03", close: Number.NaN }, { date: "2026-11-04", close: 5 }])).toBeNull();
  });

  it("spreads the daily returns over round bins around zero, with the extremes in the end bins", () => {
    const returns = [...Array.from({ length: 98 }, (_, index) => (index % 2 ? 0.004 : -0.004)), 0, 0.3];
    const bins = returnBins(returns);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(100);
    // one wild day (+30%) does not widen the bins: it is counted in the last one
    expect(bins.length).toBeLessThanOrEqual(24);
    expect(bins.at(-1)).toMatchObject({ openHigh: true });
    expect(bins.at(-1)!.count).toBeGreaterThanOrEqual(1);
    // a flat day is counted with the days that did not rise
    const middle = bins.length / 2;
    expect(bins[middle - 1].to).toBe(0);
    expect(bins[middle - 1].count).toBe(50);
    expect(bins[middle].count).toBe(bins.length === 2 ? 50 : 49);
    expect(returnBins([])).toEqual([]);
    expect(binTitle({ from: -0.01, to: -0.005, count: 3, openLow: false, openHigh: false })).toBe("Days that moved −1.0% to −0.5%");
    expect(binTitle({ from: -0.03, to: -0.02, count: 1, openLow: true, openHigh: false })).toBe("Days that fell more than 2%");
    expect(binTitle({ from: 0.02, to: 0.03, count: 1, openLow: false, openHigh: true })).toBe("Days that rose more than 2%");
  });
});

describe("desk company risk card", () => {
  let desk: MountedDesk | null = null;
  afterEach(() => {
    desk?.unmount();
    desk = null;
    DESK_DATA.empty = false;
  });
  const card = () => [...desk!.host.querySelectorAll("section.desk-card")].find(node => node.querySelector("h2")?.textContent === "Risk and returns")!;
  const stat = (label: string) => [...card().querySelectorAll("[data-risk-stats] .desk-stat")].find(node => node.textContent?.startsWith(label))?.querySelector("strong")?.textContent;

  it("reads the closes of the chosen range: the figures, the fall from the high and the spread of daily returns", async () => {
    desk = await mountDesk("admin", "/desk/company/AAPL", "Risk and returns");
    await waitUntil(() => card().textContent?.includes("11 sessions") ?? false);
    expect(card().textContent).toContain("Nov 2, 2026 to Nov 12, 2026 · 11 sessions · follows the range of the price chart (1Y)");
    expect(stat("Return over the range")).toBe("−3.2%");
    expect(stat("Largest fall from a high")).toBe("−20.0%");
    expect(card().textContent).toContain("Nov 5, 2026 to Nov 7, 2026");
    expect(stat("Now below the range's high")).toBe("−12.0%");
    expect(stat("Best day")).toBe("+5.8%");
    expect(stat("Worst day")).toBe("−11.1%");
    expect(stat("Days that closed higher")).toBe("70%");
    expect(card().querySelector("[data-risk-drawdown] svg")!.getAttribute("aria-label")).toBe("Fall from the highest close so far, 11 sessions; deepest −20.0% on Nov 7, 2026");
    expect(card().querySelector("[data-risk-drawdown] circle[data-deepest]")!.getAttribute("data-deepest")).toBe("2026-11-07");
    // ten daily returns, one bar per bin that holds a day
    const bars = [...card().querySelectorAll("[data-risk-histogram] rect[data-bar]")];
    expect(bars.length).toBeGreaterThan(2);
    // the intraday ranges have no daily closes to read
    const oneDay = [...desk.host.querySelectorAll("button")].find(button => button.textContent === "1D")!;
    act(() => oneDay.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitUntil(() => card().textContent?.includes("Choose a range of one month or longer") ?? false);
  });
});
