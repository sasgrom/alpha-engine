import { createHash } from "node:crypto";
import type { DailyExpectationState, PredictionExpectationsReport, PredictionSnapshot, PredictionValues } from "../../contracts/prediction-markets";

export type JsonObject = Record<string, unknown>;

export function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function probability(bid: number | null, ask: number | null, last: number | null): number | null {
  if (bid !== null && ask !== null && ask >= bid && ask - bid <= 0.15 + 1e-9 && ask > 0) return (bid + ask) / 2;
  return last !== null && last >= 0 && last <= 1 ? last : null;
}

export function liquidityFlag(bid: number | null, ask: number | null, volume24h: number | null, liquidity: number | null): "ok" | "thin" | "unknown" {
  if (bid === null || ask === null || volume24h === null || liquidity === null) return "unknown";
  return volume24h >= 10_000 && ask - bid <= 0.05 + 1e-9 && liquidity >= 5_000 ? "ok" : "thin";
}

export function excludedMarket(text: string, category?: string | null): boolean {
  if (category && /^(politics|sports|entertainment)$/i.test(category)) return true;
  return /election|president|senate|congress|prime minister|parliament|democrat|republican|trump|biden|harris|governor|mayor|referendum|electoral|\bNBA\b|\bNFL\b|\bMLB\b|\bNHL\b|football|soccer|basketball|baseball|hockey|earnings call|call wording|transcript|say on|mentions?/i.test(text);
}

export function nonUsMacro(text: string): boolean {
  return /\bUK\b|U\.K\.|Canada|Argentina|Brazil|Mexico|Eurozone|Euro area|England|Britain|Australia|Japan|China|India/i.test(text);
}

export function settled(market: JsonObject): boolean {
  return market.result === "yes" || market.result === "no" || ["settled", "finalized", "determined"].includes(String(market.status)) || market._section === "historical";
}

export function numericMarket(market: JsonObject | PredictionSnapshot): boolean {
  const raw = market as JsonObject;
  return Boolean(raw.strike_type || numberValue(raw.floor_strike) !== null || numberValue(raw.cap_strike) !== null || /-[TB]N?-?[0-9.]+$/.test(String(raw.ticker)));
}

export function thresholdOf(market: JsonObject | PredictionSnapshot): number | null {
  const raw = market as JsonObject;
  const strikeType = raw.strike_type ?? raw.strikeType;
  if (strikeType !== null && strikeType !== undefined && !["greater", "greater_or_equal"].includes(String(strikeType))) return null;
  const floor = numberValue(raw.floor_strike ?? raw.floor);
  if (floor !== null) return floor;
  const match = String(raw.ticker ?? raw.market).match(/-T(N?)(-?[0-9.]+)$/);
  if (!match) return null;
  const value = Number(match[2]);
  return match[1] === "N" ? -value : value;
}

export function polyThreshold(question: string): number | null {
  const match = question.match(/(?:above|over|more than|at least|greater than)\s*\$?\s*(-?\d+(?:\.\d+)?)\s*%/i);
  return match ? Number(match[1]) : null;
}

export function polyOutcome(question: string): { change: number; orMore: boolean } | null {
  const q = question.toLowerCase();
  if (q.includes("no change")) return { change: 0, orMore: false };
  const size = q.match(/(\d+)\s*(\+)?\s*bps?/);
  if (!size) return null;
  if (/decrease|cut|lower/.test(q)) return { change: -Number(size[1]), orMore: Boolean(size[2]) };
  if (/increase|hike|raise/.test(q)) return { change: Number(size[1]), orMore: Boolean(size[2]) };
  return null;
}

export function kalshiSnapshot(market: JsonObject, fetchedAt: string, extra: Partial<PredictionSnapshot> = {}): PredictionSnapshot {
  const bid = numberValue(market.yes_bid_dollars), ask = numberValue(market.yes_ask_dollars), volume24h = numberValue(market.volume_24h_fp ?? market.volume_24h), liquidity = numberValue(market.liquidity_dollars ?? market.liquidity);
  const rules = [market.rules_primary, market.rules_secondary].filter(value => typeof value === "string" && value.length > 0);
  const result = market.result === "yes" || market.result === "no" ? market.result : null;
  const raw = market.expiration_value === null || market.expiration_value === undefined || market.expiration_value === "" ? null : String(market.expiration_value);
  return {
    series: String(market.event_ticker ?? "").split("-")[0], fetchedAt, venue: "kalshi", market: String(market.ticker), event: typeof market.event_ticker === "string" ? market.event_ticker : null,
    title: typeof market.title === "string" ? market.title : null, yesBid: bid, yesAsk: ask, last: numberValue(market.last_price_dollars), volume: numberValue(market.volume_fp), openInterest: numberValue(market.open_interest_fp), closeTime: typeof market.close_time === "string" ? market.close_time : null,
    strikeType: typeof market.strike_type === "string" ? market.strike_type : null, floor: numberValue(market.floor_strike), cap: numberValue(market.cap_strike), liquidityFlag: liquidityFlag(bid, ask, volume24h, liquidity), rulesHash: rules.length ? createHash("sha256").update(rules.join("\n")).digest("hex") : null,
    status: String(market.status ?? "unknown"), result, settlementValue: numberValue(market.expiration_value), settlementRaw: raw, volume24h, liquidity, ...extra,
  };
}

export function polymarketSnapshot(market: JsonObject, event: JsonObject, topic: string, fetchedAt: string): PredictionSnapshot {
  const tokens = jsonArray(market.clobTokenIds), prices = jsonArray(market.outcomePrices);
  const bid = numberValue(market.bestBid), ask = numberValue(market.bestAsk), volume24h = numberValue(market.volume24hr ?? market.volume24hrClob), liquidity = numberValue(market.liquidityNum ?? market.liquidity);
  const closed = market.closed === true || market.resolved === true;
  const outcomePrice = prices.length ? numberValue(prices[0]) : null;
  const result = closed && outcomePrice !== null ? outcomePrice > 0.5 ? "yes" as const : "no" as const : null;
  const identifier = market.conditionId ?? market.id ?? tokens[0] ?? market.slug;
  if (!identifier) throw new Error("Polymarket market has no condition id or CLOB token");
  return {
    series: topic, fetchedAt, venue: "polymarket", market: String(identifier), event: typeof event.slug === "string" ? event.slug : null,
    title: typeof market.question === "string" ? market.question : typeof event.title === "string" ? event.title : null,
    yesBid: bid, yesAsk: ask, last: numberValue(market.lastTradePrice), volume: numberValue(market.volumeNum ?? market.volume), openInterest: numberValue(market.openInterest ?? market.open_interest), closeTime: typeof market.endDate === "string" ? market.endDate : typeof event.endDate === "string" ? event.endDate : null,
    strikeType: null, floor: polyThreshold(String(market.question ?? market.groupItemTitle ?? "")), cap: null, liquidityFlag: liquidityFlag(bid, ask, volume24h, liquidity), rulesHash: createHash("sha256").update(JSON.stringify({ event: event.slug, question: market.question, outcomes: market.outcomes })).digest("hex"),
    status: closed ? "closed" : market.active === false ? "inactive" : "open", result, settlementValue: result ? result === "yes" ? 1 : 0 : null, settlementRaw: result, volume24h, liquidity,
  };
}

export function candleProbability(candle: JsonObject): { value: number | null; how: "mid" | "trade" | null } {
  const side = (name: string) => {
    const block = candle[name] as JsonObject | undefined;
    return numberValue(block?.close_dollars ?? block?.close);
  };
  const bid = side("yes_bid"), ask = side("yes_ask");
  if (bid !== null && ask !== null && ask >= bid && ask - bid <= 0.15 && ask > 0) return { value: (bid + ask) / 2, how: "mid" };
  const price = candle.price as JsonObject | undefined;
  const last = numberValue(price?.close_dollars ?? price?.close);
  return last !== null ? { value: last, how: "trade" } : { value: null, how: null };
}

export function quoteDay(endPeriodTs: number): string {
  return new Date(endPeriodTs * 1000 - 6 * 3_600_000).toISOString().slice(0, 10);
}

function pavDecreasing(values: number[]): number[] {
  const blocks = values.map(value => ({ value, count: 1 }));
  let index = 0;
  while (index < blocks.length - 1) {
    if (blocks[index].value < blocks[index + 1].value) {
      const count = blocks[index].count + blocks[index + 1].count, value = (blocks[index].value * blocks[index].count + blocks[index + 1].value * blocks[index + 1].count) / count;
      blocks.splice(index, 2, { value, count });
      index = Math.max(index - 1, 0);
    } else index++;
  }
  return blocks.flatMap(block => Array(block.count).fill(block.value));
}

export function distribution(points: [number, number][], mode: "grid" | "continuous" = "grid"): { mean: number | null; sd: number | null; covered: boolean } {
  if (!points.length) return { mean: null, sd: null, covered: false };
  const sorted = [...points].sort((a, b) => a[0] - b[0]), thresholds = sorted.map(point => point[0]);
  const survival = pavDecreasing(sorted.map(([, value]) => value < 0.03 ? 0 : value > 0.97 ? 1 : value));
  const step = thresholds.length > 1 ? Math.min(...thresholds.slice(1).map((value, index) => value - thresholds[index])) : 0.1;
  const masses: [number, number][] = [[thresholds[0] - (mode === "continuous" ? step / 2 : 0), 1 - survival[0]]];
  for (let index = 0; index < thresholds.length - 1; index++) masses.push([mode === "continuous" ? (thresholds[index] + thresholds[index + 1]) / 2 : thresholds[index + 1], survival[index] - survival[index + 1]]);
  masses.push([thresholds[thresholds.length - 1] + step / (mode === "continuous" ? 2 : 1), survival[survival.length - 1]]);
  const total = masses.reduce((sum, [, mass]) => sum + mass, 0);
  if (total <= 0) return { mean: null, sd: null, covered: false };
  const mean = masses.reduce((sum, [value, mass]) => sum + value * mass, 0) / total;
  const sd = Math.sqrt(Math.max(0, masses.reduce((sum, [value, mass]) => sum + mass * (value - mean) ** 2, 0) / total));
  return { mean, sd, covered: survival[0] >= 0.8 && survival[survival.length - 1] <= 0.2 };
}

function eventGroups(rows: PredictionSnapshot[]): Map<string, PredictionSnapshot[]> {
  const groups = new Map<string, PredictionSnapshot[]>();
  for (const row of rows) {
    const key = row.event ?? "";
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function upcoming(groups: Map<string, PredictionSnapshot[]>, now: string): [string, PredictionSnapshot[]][] {
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).sort(([ , a], [ , b]) => (a[0].closeTime ?? "9999").localeCompare(b[0].closeTime ?? "9999")).filter(([, rows]) => !rows[0].closeTime || rows[0].closeTime >= now);
}

function expectedFrom(rows: PredictionSnapshot[], mode: "grid" | "continuous" = "grid"): { mean: number | null; sd: number | null; covered: boolean; points: [number, number][] } {
  const points = rows.map(row => {
    const threshold = thresholdOf(row as unknown as JsonObject);
    const value = probability(row.yesBid, row.yesAsk, row.last);
    return threshold !== null && value !== null ? [threshold, value] as [number, number] : null;
  }).filter(point => point !== null).sort((a, b) => a[0] - b[0]);
  return { ...distribution(points, mode), points };
}

function fedProbabilities(points: [number, number][], current: number | null): { cut: number | null; unchanged: number | null; hike: number | null } {
  if (current === null || points.length < 3) return { cut: null, unchanged: null, hike: null };
  const above = Math.min(...points.filter(([threshold]) => Math.abs(threshold - current) < 0.01).map(([, value]) => value));
  const below = Math.min(...points.filter(([threshold]) => Math.abs(threshold - current + 0.25) < 0.01).map(([, value]) => value));
  const hike = Number.isFinite(above) ? above : null, cut = Number.isFinite(below) ? 1 - below : null;
  return { cut, hike, unchanged: cut !== null && hike !== null ? Math.max(0, Math.min(1, 1 - cut - hike)) : null };
}

function outcomeProbabilities(rows: PredictionSnapshot[]): { cut: number | null; unchanged: number | null; hike: number | null } {
  const values = rows.map(row => ({ outcome: polyOutcome(row.title ?? ""), p: probability(row.yesBid, row.yesAsk, row.last) })).filter(row => row.outcome && row.p !== null);
  const total = values.reduce((sum, row) => sum + row.p!, 0);
  if (!total) return { cut: null, unchanged: null, hike: null };
  const part = (pick: (change: number) => boolean) => {
    const selected = values.filter(row => pick(row.outcome!.change));
    return selected.length ? selected.reduce((sum, row) => sum + row.p!, 0) / total : 0;
  };
  return { cut: part(change => change < 0), unchanged: part(change => change === 0), hike: part(change => change > 0) };
}

function currentUpperBound(rows: PredictionSnapshot[], now: string, previous: number | null): number | null {
  if (previous !== null) return previous;
  const actual = rows.filter(row => row.series === "KXFED" && row.result && (row.closeTime ?? "") < now && /%/.test(row.settlementRaw ?? "")).sort((a, b) => (a.closeTime ?? "").localeCompare(b.closeTime ?? "")).at(-1);
  return actual ? numberValue(actual.settlementRaw!.replace("%", "")) : null;
}

export function buildPredictionExpectations(snapshots: PredictionSnapshot[], now: string, previousFedUpper: number | null = null): PredictionExpectationsReport {
  const latest = new Map<string, PredictionSnapshot>();
  for (const row of snapshots) {
    const key = `${row.venue}|${row.market}`;
    if ((latest.get(key)?.fetchedAt ?? "") < row.fetchedAt) latest.set(key, row);
  }
  const rows = [...latest.values()].filter(row => !excludedMarket(row.title ?? ""));
  const fed = upcoming(eventGroups(rows.filter(row => row.venue === "kalshi" && row.series === "KXFED")), now).slice(0, 4);
  const current = currentUpperBound(rows, now, previousFedUpper);
  const firstFed = fed[0]?.[1] ?? [], firstFedDistribution = expectedFrom(firstFed);
  const firstFedProbabilities = fedProbabilities(firstFedDistribution.points, current);
  const polyFed = upcoming(eventGroups(rows.filter(row => row.venue === "polymarket" && row.series === "fed")), now);
  const firstPolyFed = polyFed[0]?.[1] ?? [], alternateFedProbabilities = outcomeProbabilities(firstPolyFed);
  const values = (primary: number | null, alternate: number | null): PredictionValues => ({ primary, alternate });
  const cpiEvent = upcoming(eventGroups(rows.filter(row => row.venue === "kalshi" && row.series === "KXCPI")), now)[0];
  const cpi = expectedFrom(cpiEvent?.[1] ?? []);
  const polyCpiRows = rows.filter(row => row.venue === "polymarket" && row.series === "cpi" && !nonUsMacro(`${row.event ?? ""} ${row.title ?? ""}`) && !/delays?/i.test(`${row.event ?? ""} ${row.title ?? ""}`));
  const polyCpiEvent = upcoming(eventGroups(polyCpiRows), now)[0];
  const polyCpi = expectedFrom(polyCpiEvent?.[1] ?? []);
  const recessionRows = rows.filter(row => row.venue === "kalshi" && ["KXRECSSNBER", "KXQRECESS"].includes(row.series) && `${row.event ?? ""} ${row.title ?? ""}`.includes(now.slice(0, 4)));
  const recessionProbabilities = recessionRows.map(row => probability(row.yesBid, row.yesAsk, row.last)).filter(value => value !== null);
  const recession = recessionProbabilities.length ? Math.max(...recessionProbabilities) : null;
  const polyRecessionRows = rows.filter(row => row.venue === "polymarket" && row.series === "recession" && /(?:\bUS\b|\bU\.S\.\b).*recession/i.test(row.title ?? "") && row.result === null);
  const polyRecession = upcoming(eventGroups(polyRecessionRows), now)[0]?.[1] ?? [];
  const recessionAlternate = polyRecession.length ? probability(polyRecession[0].yesBid, polyRecession[0].yesAsk, polyRecession[0].last) : null;
  const fedOutcomesComplete = Object.values(firstFedProbabilities).every(value => value !== null);
  return {
    schemaVersion: 1,
    generatedAt: now,
    asOf: rows.length ? rows.map(row => row.fetchedAt).sort().at(-1)! : null,
    status: rows.length === 0 ? "empty" : fedOutcomesComplete ? "ok" : "partial",
    closed: rows.length > 0 && rows.every(row => row.result !== null || ["closed", "resolved", "settled", "finalized", "determined", "inactive"].includes(row.status)),
    fed: {
      meeting: firstFed[0]?.closeTime ?? null,
      alternateMeeting: firstPolyFed[0]?.closeTime ?? null,
      currentUpper: current,
      expectedUpper: values(firstFedDistribution.covered ? firstFedDistribution.mean : null, null),
      outcomes: { cut: values(firstFedProbabilities.cut, alternateFedProbabilities.cut), unchanged: values(firstFedProbabilities.unchanged, alternateFedProbabilities.unchanged), hike: values(firstFedProbabilities.hike, alternateFedProbabilities.hike) },
      next: fed.map(([event, markets]) => ({ meeting: markets[0].closeTime ?? event, expected: (() => { const result = expectedFrom(markets); return result.covered ? result.mean : null; })() })),
    },
    cpi: { event: cpiEvent?.[0] ?? polyCpiEvent?.[0] ?? null, expected: values(cpi.covered ? cpi.mean : null, polyCpi.covered ? polyCpi.mean : null), spread: values(cpi.sd, polyCpi.sd) },
    recession: { event: recessionRows[0]?.event ?? polyRecession[0]?.event ?? null, probability: values(recession, recessionAlternate) },
    calibration: { fed: "Fed markets: 0.99 skill the day before, 2022–2026", cpi: "CPI markets: 0.74 skill the day before, 2022–2026" },
    notes: ["Calibrated expectations for context and scenario work, not an after-release trading signal.", "Company KPI markets are forward evidence, not a validated standalone alpha signal."],
  };
}

export function dailyExpectationState(report: PredictionExpectationsReport, date: string): DailyExpectationState {
  const state: DailyExpectationState = { date, ...(report.asOf ? { asOf: report.asOf, rule: "snapshot" as const } : {}) };
  if (report.fed.currentUpper !== null) state.fedNow = report.fed.currentUpper;
  report.fed.next.forEach((row, index) => {
    if (row.expected === null) return;
    const meeting = row.meeting.slice(0, 10), expected = Math.round(row.expected * 10_000) / 10_000;
    if (index === 0) Object.assign(state, { fed1Meeting: meeting, fed1Expected: expected });
    else if (index === 1) Object.assign(state, { fed2Meeting: meeting, fed2Expected: expected });
    else if (index === 2) Object.assign(state, { fed3Meeting: meeting, fed3Expected: expected });
    else if (index === 3) Object.assign(state, { fed4Meeting: meeting, fed4Expected: expected });
  });
  if (report.fed.outcomes.hike.primary !== null) state.fed1PHike = Math.round(report.fed.outcomes.hike.primary * 10_000) / 10_000;
  if (report.fed.outcomes.cut.primary !== null) state.fed1PCut = Math.round(report.fed.outcomes.cut.primary * 10_000) / 10_000;
  if (report.cpi.expected.primary !== null) state.cpiNextExpected = Math.round(report.cpi.expected.primary * 10_000) / 10_000;
  if (report.cpi.spread.primary !== null) state.cpiNextSd = Math.round(report.cpi.spread.primary * 10_000) / 10_000;
  if (report.recession.probability.primary !== null) state.recessionThisYear = Math.round(report.recession.probability.primary * 10_000) / 10_000;
  return state;
}
