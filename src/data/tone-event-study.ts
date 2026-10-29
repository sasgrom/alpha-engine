export interface ToneCarPoint {
  horizon: number;
  all: number;
  positive: number;
  negative: number;
}

/** Measured from research/tone-event-study-result.json; no forward-looking values. */
export const toneCarSeries: readonly ToneCarPoint[] = [
  { horizon: 1, all: -0.000623761917672191, positive: -0.00040118451284565306, negative: -0.006653207307880024 },
  { horizon: 5, all: -0.0019375693917829222, positive: -0.005260125184647226, negative: -0.005416581397134692 },
  { horizon: 21, all: -0.0006792749868659873, positive: -0.006985589509963119, negative: 0.025530862838445238 },
  { horizon: 63, all: 0.00009079597021264181, positive: -0.013141440921991775, negative: 0.06767609200040282 },
];
export const toneEventMeta = {
  events: 2515,
  model: "Market-model OLS · post-close disclosure",
  note: "Exploratory event-study evidence, not a production signal. Yearly results are regime-dependent.",
};
