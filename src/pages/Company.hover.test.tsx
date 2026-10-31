// @vitest-environment jsdom
/**
 * Regression test for the "table ↔ chart" hover sync (Fundamentals tab
 * of the company page).
 *
 * Background: recharts 2.15.4 does NOT render ReferenceDot/ReferenceLine
 * when they are wrapped in a React fragment inside the chart children — in
 * production the bug showed up as "hovering a table row highlights nothing
 * on the chart". The test reproduces the EXACT Fundamentals markup
 * (Company.tsx) and guards against a return to the fragment wrapper.
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LineChart, Line, XAxis, YAxis, ReferenceDot, ReferenceLine } from "recharts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const chartData = [
  { periodEnd: "2025-09-27", val: 69.86e9, derivation: "reported" },
  { periodEnd: "2025-12-27", val: 70.59e9, derivation: "derived_q4" },
  { periodEnd: "2026-03-28", val: 57.35e9, derivation: "reported" },
];

/**
 * An exact copy of the Fundamentals JSX structure: the same Line props
 * (custom dot), the same sibling markers, the same table rows with
 * onMouseEnter/Leave. mode=siblings is the production markup; mode=fragment
 * is the anti-pattern (meant to fail: it demonstrates why you must not
 * write it that way).
 */
function SyncFixture({ mode }: { mode: "siblings" | "fragment" }) {
  const [hoverPeriod, setHoverPeriod] = useState<string | null>(null);
  const hoverPoint = chartData.find((d) => d.periodEnd === hoverPeriod) ?? null;

  const line = (
    <Line
      type="monotone"
      dataKey="val"
      strokeWidth={1.75}
      dot={(p: any) => (
        <circle
          key={p.key}
          cx={p.cx}
          cy={p.cy}
          r={p.payload.derivation === "derived_q4" ? 3 : 0}
          fill="none"
          strokeWidth={1.5}
        />
      )}
      activeDot={{ r: 3 }}
    />
  );
  const chartHandlers = {
    onMouseMove: (s: { activeLabel?: string | number }) => {
      const l = s?.activeLabel;
      if (typeof l === "string") setHoverPeriod((prev) => (prev === l ? prev : l));
    },
    onMouseLeave: () => setHoverPeriod(null),
  };

  return (
    <div data-hover={hoverPeriod ?? ""}>
      {mode === "siblings" ? (
        // production markup: ReferenceLine/ReferenceDot as TWO SEPARATE
        // conditional expressions among the chart's direct children (as in Company.tsx)
        <LineChart width={600} height={340} data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }} {...chartHandlers}>
          <XAxis dataKey="periodEnd" />
          <YAxis />
          {line}
          {hoverPoint && <ReferenceLine x={hoverPoint.periodEnd} strokeDasharray="3 3" />}
          {hoverPoint && <ReferenceDot x={hoverPoint.periodEnd} y={hoverPoint.val} r={5} />}
        </LineChart>
      ) : (
        // anti-pattern: the same refs, but inside a React fragment
        <LineChart width={600} height={340} data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }} {...chartHandlers}>
          <XAxis dataKey="periodEnd" />
          <YAxis />
          {line}
          {hoverPoint && (
            <>
              <ReferenceLine x={hoverPoint.periodEnd} strokeDasharray="3 3" />
              <ReferenceDot x={hoverPoint.periodEnd} y={hoverPoint.val} r={5} />
            </>
          )}
        </LineChart>
      )}
      {chartData.map((r) => (
        <div
          key={r.periodEnd}
          id={`qp-${r.periodEnd}`}
          className={hoverPeriod === r.periodEnd ? "active" : ""}
          onMouseEnter={() => setHoverPeriod(r.periodEnd)}
          onMouseLeave={() => setHoverPeriod(null)}
        >
          {r.periodEnd}
        </div>
      ))}
    </div>
  );
}

describe("Fundamentals hover sync", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  async function mount(mode: "siblings" | "fragment") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<SyncFixture mode={mode} />));
  }

  async function hoverRow(periodEnd: string) {
    await act(async () => {
      container.querySelector(`#qp-${periodEnd}`)!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
  }

  it("hovering a table row draws a ReferenceDot and ReferenceLine on the chart", async () => {
    await mount("siblings");
    expect(container.querySelector(".recharts-reference-dot")).toBeFalsy();
    await hoverRow("2025-12-27");
    expect((container.firstElementChild as HTMLElement).dataset.hover).toBe("2025-12-27");
    expect(container.querySelector(".recharts-reference-dot"), "marker dot").toBeTruthy();
    expect(container.querySelector(".recharts-reference-line"), "vertical guide").toBeTruthy();
    // row highlight
    expect(container.querySelector("#qp-2025-12-27")!.className).toContain("active");
  });

  it("leaving the row clears the markers", async () => {
    await mount("siblings");
    await hoverRow("2026-03-28");
    expect(container.querySelector(".recharts-reference-dot")).toBeTruthy();
    await act(async () => {
      container.querySelector("#qp-2026-03-28")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(container.querySelector(".recharts-reference-dot")).toBeFalsy();
  });

  it("ANTI-PATTERN: refs inside a fragment do NOT render (recharts 2.15)", async () => {
    await mount("fragment");
    await hoverRow("2025-12-27");
    // pin the engine's behavior: if a recharts upgrade makes this render,
    // the test will say the limitation is gone (then update code and test)
    expect(container.querySelector(".recharts-reference-dot")).toBeFalsy();
  });
});
