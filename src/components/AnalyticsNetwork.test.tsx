// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import AnalyticsNetwork from "./AnalyticsNetwork";
import { analyticsSnapshot } from "@/data/analytics-snapshot";
import { toneCarSeries, toneEventMeta } from "@/data/tone-event-study";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("AnalyticsNetwork", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("renders actual and target graphs with clickable nodes", () => {
    const selected: string[] = [];
    const nodes = analyticsSnapshot.actual.slice(0, 3) as any[];
    act(() => {
      root = createRoot(host!);
      root.render(<AnalyticsNetwork mode="actual" nodes={nodes} selectedId={null} onSelect={(node) => selected.push(node.id)} />);
    });
    expect(host!.querySelectorAll("g[role=button]").length).toBe(3);
    expect(host!.querySelectorAll("path").length).toBeGreaterThan(0);
    const first = host!.querySelector("g[role=button]")!;
    act(() => { first.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(selected).toEqual(["fetch"]);

    act(() => {
      root!.render(<AnalyticsNetwork mode="target" nodes={analyticsSnapshot.target.slice(0, 3) as any[]} selectedId={null} onSelect={() => {}} />);
    });
    expect(host!.querySelectorAll("g[role=button]").length).toBe(3);
  });

  it("keeps the snapshot evidence-based and current", () => {
    expect(analyticsSnapshot.metrics.factorCompanies).toBeLessThan(analyticsSnapshot.metrics.companies);
    expect(analyticsSnapshot.metrics.factorCompanies).toBe(analyticsSnapshot.metrics.factsCompanies);
    expect(analyticsSnapshot.metrics.edgarToneCompanies).toBeGreaterThanOrEqual(50);
    expect(analyticsSnapshot.metrics.optionsSnapshots).toBeGreaterThanOrEqual(200);
    expect(analyticsSnapshot.metrics.latestPriceDate >= "2026-10-26").toBe(true);
    expect(analyticsSnapshot.metrics.testCount).toBeGreaterThanOrEqual(342);
    expect(analyticsSnapshot.actual.find((node) => node.id === "shareFlows")?.status).toBe("done");
    expect(analyticsSnapshot.actual.find((node) => node.id === "optionFeatures")?.status).not.toBe("missing");
    expect(analyticsSnapshot.history.at(-1)?.week).toBe(analyticsSnapshot.week);
    expect(analyticsSnapshot.history.at(-1)?.metrics.factorCompanies).toBe(analyticsSnapshot.metrics.factorCompanies);
  });

  it("keeps the event-study chart tied to the measured research result", () => {
    expect(toneCarSeries.map((point) => point.horizon)).toEqual([1, 5, 21, 63]);
    expect(toneEventMeta.events).toBe(2515);
    expect(toneCarSeries[3].positive).toBeLessThan(0);
    expect(toneCarSeries[3].negative).toBeGreaterThan(0);
  });

  it("keeps the published English review synchronized with current evidence", () => {
    const report = readFileSync("public/reports/project-strength-review.md", "utf8");
    expect(report).toContain("2026-10-29");
    expect(report).toContain("1,348,866 facts from 53 CIKs");
    expect(report).toContain("250 snapshots and 310,634 normalized rows");
    expect(report).not.toContain("factor_points only for 5");
    expect(report).not.toContain("2026-10-09");
  });
});
