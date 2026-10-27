// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import AnalyticsNetwork from "./AnalyticsNetwork";
import { analyticsSnapshot } from "@/data/analytics-snapshot";

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
    expect(analyticsSnapshot.metrics.optionsSnapshots).toBeGreaterThan(0);
    expect(analyticsSnapshot.history.at(-1)?.week).toBe(analyticsSnapshot.week);
    expect(analyticsSnapshot.history.at(-1)?.metrics.factorCompanies).toBe(analyticsSnapshot.metrics.factorCompanies);
  });
});
