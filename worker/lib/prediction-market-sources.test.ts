import { describe, expect, it } from "vitest";
import { httpPredictionSources } from "./prediction-market-sources";
import type { PublicHttp } from "./prediction-market-http";

const events = [
  { slug: "us-recession-by-end-2026", title: "US recession by end of 2026", endDate: "2026-12-31" },
  { slug: "canada-recession-before-2027", title: "Canada recession before 2027", endDate: "2026-12-31" },
  { slug: "us-cpi-november-2026", title: "CPI in November 2026", endDate: "2026-12-10" },
  { slug: "october-inflation-uk-annual-2026", title: "UK annual inflation", endDate: "2026-11-18" },
  { slug: "argentina-monthly-inflation-october-2026", title: "Argentina monthly inflation", endDate: "2026-11-18" },
  { slug: "bls-delays-another-cpi-release-before-2027", title: "BLS delays another CPI release before 2027", endDate: "2026-12-31" },
  { slug: "fed-decision-in-december-20260729232808632", title: "Fed decision in December 2026", endDate: "2026-12-09" },
];

function http(): PublicHttp {
  return { get: async () => ({ events }), requests: 0, retries: 0 };
}

describe("prediction-market source scope", () => {
  it("keeps US recession and CPI events while excluding other jurisdictions and scheduling events", async () => {
    const sources = httpPredictionSources(http());
    expect((await sources.polyEvents("recession")).map(event => event.slug)).toEqual(["us-recession-by-end-2026"]);
    expect((await sources.polyEvents("cpi")).map(event => event.slug)).toEqual(["us-cpi-november-2026"]);
  });

  it("accepts the actual Fed event slug with a numeric suffix", async () => {
    expect((await httpPredictionSources(http()).polyEvents("fed")).map(event => event.slug)).toEqual(["fed-decision-in-december-20260729232808632"]);
  });
});
