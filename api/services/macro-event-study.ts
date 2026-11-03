import type { NormalizedMacroPoint } from "../../worker/lib/fred";
import type { PoliticalEvent } from "../../worker/lib/political-events";
import { delta, type CalibrationChannel } from "./shock-calibration";

export type MacroEventSplit = "discovery" | "out_of_sample";
export type MacroEventHorizon = "1" | "5" | "21" | "63";
const HORIZONS: MacroEventHorizon[] = ["1", "5", "21", "63"];
const MIN_EVENTS_PER_SPLIT = 5;
const BOOTSTRAP_REPLICATES = 500;

interface MacroEvidencePoint {
  observationPeriod: string;
  value: number;
  availableAt: string;
  researchEligibleAt: string;
  vintageId: string;
}
export interface MacroEventOutcome extends MacroEvidencePoint {
  change: number;
}
export interface MacroEventObservation {
  eventId: string;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  researchEligibleAt: string;
  split: MacroEventSplit;
  seriesId: string;
  channel: CalibrationChannel;
  baseline: MacroEvidencePoint;
  outcomes: Record<MacroEventHorizon, MacroEventOutcome | null>;
}
export interface MacroEventSummary {
  n: number;
  mean: number;
  median: number;
  ci95Mean: [number, number] | null;
}
export interface MacroEventSeriesStudy {
  seriesId: string;
  channel: CalibrationChannel;
  unit: "decimal" | "decimal_percentage";
  horizons: Record<MacroEventHorizon, { discovery: MacroEventSummary | null; outOfSample: MacroEventSummary | null }>;
}
export interface MacroEventStudyReport {
  schemaVersion: 1;
  dataMode?: "live" | "fixture";
  generatedAt: string;
  asOf: string;
  status: "ready" | "partial" | "insufficient_events";
  policy: {
    vintage: "first_release_per_observation";
    eventStart: "next_observation_after_publication_day";
    availability: "baseline_known_at_event_and_outcomes_known_at_report_asof";
    discoveryFraction: 0.7;
    minEventsPerSplit: 5;
    bootstrapReplicates: 500;
    maxBlockLength: 3;
    directionalForecast: false;
  };
  events: {
    total: number;
    eligible: number;
    withBaseline: number;
    withAnyObservation: number;
    discovery: number;
    outOfSample: number;
  };
  studies: MacroEventSeriesStudy[];
  observations: MacroEventObservation[];
}
export interface MacroEventStudyInput {
  events: PoliticalEvent[];
  series: { seriesId: string; channel: CalibrationChannel; rows: NormalizedMacroPoint[] }[];
  asOf: string;
  generatedAt: string;
  dataMode?: "live" | "fixture";
}

const time = (value: string): number => Date.parse(value);
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Moving-block bootstrap CI for clustered event means; blocks never exceed three events. */
export function movingBlockMeanCi(values: number[], seed: number, replicates = BOOTSTRAP_REPLICATES): [number, number] | null {
  if (values.length < 2) return null;
  const random = seededRandom(seed);
  const blockLength = Math.min(3, values.length);
  const estimates: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate++) {
    const sample: number[] = [];
    while (sample.length < values.length) {
      const blockStart = Math.floor(random() * values.length);
      for (let index = 0; index < blockLength && sample.length < values.length; index++) sample.push(values[(blockStart + index) % values.length]);
    }
    estimates.push(mean(sample));
  }
  return [quantile(estimates, 0.025), quantile(estimates, 0.975)];
}

/** Keep the earliest released vintage per economic period, never a later revision. */
export function firstReleasePoints(rows: NormalizedMacroPoint[], asOf: string): NormalizedMacroPoint[] {
  const byPeriod = new Map<string, NormalizedMacroPoint>();
  for (const row of rows) {
    if (row.value === null || !Number.isFinite(row.value) || row.observationPeriod < "2000-01-01" || row.observationPeriod > asOf.slice(0, 10) || row.availableAt > asOf || row.researchEligibleAt > asOf || row.ingestedAt > asOf) continue;
    const prior = byPeriod.get(row.observationPeriod);
    if (!prior || row.availableAt < prior.availableAt || (row.availableAt === prior.availableAt && row.vintageId < prior.vintageId)) byPeriod.set(row.observationPeriod, row);
  }
  return [...byPeriod.values()].sort((a, b) => a.observationPeriod.localeCompare(b.observationPeriod));
}

const evidence = (point: NormalizedMacroPoint): MacroEvidencePoint => ({
  observationPeriod: point.observationPeriod,
  value: point.value!,
  availableAt: point.availableAt,
  researchEligibleAt: point.researchEligibleAt,
  vintageId: point.vintageId,
});

function eventObservation(event: PoliticalEvent, split: MacroEventSplit, series: MacroEventStudyInput["series"][number], points: NormalizedMacroPoint[]): MacroEventObservation | null {
  const eventDay = event.publishedAt.slice(0, 10);
  const baseline = points.filter((point) => point.observationPeriod <= eventDay && point.availableAt <= event.researchEligibleAt && point.researchEligibleAt <= event.researchEligibleAt).at(-1);
  if (!baseline) return null;
  const after = points.filter((point) => point.observationPeriod > eventDay);
  const outcomes = Object.fromEntries(HORIZONS.map((label) => {
    const point = after[Number(label) - 1];
    if (!point) return [label, null];
    const change = delta(point, baseline, series.channel);
    return [label, change === null || !Number.isFinite(change) ? null : { ...evidence(point), change }];
  })) as MacroEventObservation["outcomes"];
  return {
    eventId: event.eventId,
    title: event.title,
    sourceUrl: event.sourceUrl,
    publishedAt: event.publishedAt,
    researchEligibleAt: event.researchEligibleAt,
    split,
    seriesId: series.seriesId,
    channel: series.channel,
    baseline: evidence(baseline),
    outcomes,
  };
}

function summarize(observations: MacroEventObservation[], horizon: MacroEventHorizon, seed: number): MacroEventSummary | null {
  const values = observations.map((observation) => observation.outcomes[horizon]?.change).filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (values.length < MIN_EVENTS_PER_SPLIT) return null;
  return { n: values.length, mean: mean(values), median: quantile(values, 0.5), ci95Mean: movingBlockMeanCi(values, seed) };
}

function validateInput(input: MacroEventStudyInput): void {
  if (!Number.isFinite(time(input.asOf)) || !Number.isFinite(time(input.generatedAt))) throw new Error("Macro event study timestamps must be ISO timestamps");
  const ids = new Set<string>();
  for (const event of input.events) {
    if (ids.has(event.eventId)) throw new Error(`Duplicate macro event ${event.eventId}`);
    ids.add(event.eventId);
  }
}

/** Build a first-release OFAC event study with chronological discovery/OOS evidence. */
export function buildMacroEventStudyReport(input: MacroEventStudyInput): MacroEventStudyReport {
  validateInput(input);
  const eligible = input.events.filter((event) => event.publishedAt <= input.asOf && event.researchEligibleAt <= input.asOf && event.ingestedAt <= input.asOf).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.eventId.localeCompare(b.eventId));
  const discoveryCount = Math.floor(eligible.length * 0.7);
  const splitById = new Map<string, MacroEventSplit>(eligible.map((event, index) => [event.eventId, index < discoveryCount ? "discovery" : "out_of_sample"]));
  const observations: MacroEventObservation[] = [];
  const pointsBySeries = new Map(input.series.map((series) => [series.seriesId, firstReleasePoints(series.rows, input.asOf)]));
  for (const event of eligible) {
    for (const series of input.series) {
      const observation = eventObservation(event, splitById.get(event.eventId)!, series, pointsBySeries.get(series.seriesId)!);
      if (observation) observations.push(observation);
    }
  }
  const studies = input.series.map((series, seriesIndex): MacroEventSeriesStudy => {
    const rows = observations.filter((observation) => observation.seriesId === series.seriesId);
    return {
      seriesId: series.seriesId,
      channel: series.channel,
      unit: series.channel === "rates" || series.channel === "credit" ? "decimal" : "decimal_percentage",
      horizons: Object.fromEntries(HORIZONS.map((horizon) => [horizon, {
        discovery: summarize(rows.filter((observation) => observation.split === "discovery"), horizon, seriesIndex * 1000 + Number(horizon)),
        outOfSample: summarize(rows.filter((observation) => observation.split === "out_of_sample"), horizon, seriesIndex * 1000 + Number(horizon) + 1),
      }])) as MacroEventSeriesStudy["horizons"],
    };
  });
  const oosStudies = studies.filter((study) => HORIZONS.some((horizon) => study.horizons[horizon].outOfSample !== null)).length;
  const discoveryStudies = studies.filter((study) => HORIZONS.some((horizon) => study.horizons[horizon].discovery !== null)).length;
  const withBaseline = new Set(observations.map((observation) => observation.eventId));
  const withAnyObservation = new Set(observations.filter((observation) => HORIZONS.some((horizon) => observation.outcomes[horizon] !== null)).map((observation) => observation.eventId));
  return {
    schemaVersion: 1,
    ...(input.dataMode ? { dataMode: input.dataMode } : {}),
    generatedAt: input.generatedAt,
    asOf: input.asOf,
    status: oosStudies === input.series.length && input.series.length > 0 ? "ready" : oosStudies > 0 || discoveryStudies > 0 ? "partial" : "insufficient_events",
    policy: {
      vintage: "first_release_per_observation",
      eventStart: "next_observation_after_publication_day",
      availability: "baseline_known_at_event_and_outcomes_known_at_report_asof",
      discoveryFraction: 0.7,
      minEventsPerSplit: MIN_EVENTS_PER_SPLIT,
      bootstrapReplicates: BOOTSTRAP_REPLICATES,
      maxBlockLength: 3,
      directionalForecast: false,
    },
    events: {
      total: input.events.length,
      eligible: eligible.length,
      withBaseline: withBaseline.size,
      withAnyObservation: withAnyObservation.size,
      discovery: discoveryCount,
      outOfSample: eligible.length - discoveryCount,
    },
    studies,
    observations,
  };
}
