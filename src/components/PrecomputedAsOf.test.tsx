import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrecomputedAsOf from "./PrecomputedAsOf";

describe("PrecomputedAsOf", () => {
  it("shows the artifact timestamp and an honest stale mark", () => {
    const html = renderToStaticMarkup(createElement(PrecomputedAsOf, { asOf: "2026-11-11T12:34:56.000Z", stale: true, dataMode: "precomputed", label: "13F data" }));
    expect(html).toContain("13F data as of 2026-11-11 12:34Z · stale");
    expect(html).toContain("text-amber-400");
  });

  it("does not mark on-request results as precomputed", () => {
    expect(renderToStaticMarkup(createElement(PrecomputedAsOf, { asOf: null, stale: false, dataMode: "on_request" }))).toBe("");
  });
});
