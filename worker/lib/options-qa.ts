import { snapshotQuality, type OptionChainSnapshot, type OptionContract } from "./options";

const percent = (part: number, whole: number): number => whole ? part / whole : 0;
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function timestampMs(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  let candidate = s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) candidate = `${s.replace(" ", "T")}Z`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) candidate = `${s}T00:00:00Z`;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? ms : null;
}
function hasTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2}|\b(?:UTC|GMT|ET|EST|EDT|CT|CST|CDT|PT|PST|PDT))\s*$/i.test(value.trim());
}

export function auditOptionSnapshot(snapshot: OptionChainSnapshot) {
  const quality = snapshotQuality(snapshot.contracts);
  const present = { iv: 0, openInterest: 0, volume: 0, delta: 0, allGreeks: 0, rho: 0 };
  const quotes = { zeroBid: 0, zeroAsk: 0, crossed: 0, locked: 0, negative: 0, missingBid: 0, missingAsk: 0, twoSided: 0 };
  const integrity = {
    expired: 0, tradeDateMismatch: 0, invalidDelta: 0, negativeIv: 0, ivAbove500Percent: 0,
    zeroOpenInterest: 0, zeroVolume: 0,
    qualityMismatch: JSON.stringify(quality) !== JSON.stringify(snapshot.quality) ? 1 : 0,
  };
  const spreads: number[] = [];
  for (const c of snapshot.contracts) {
    if (c.impliedVolatility !== null) present.iv++;
    if (c.openInterest !== null) present.openInterest++;
    if (c.volume !== null) present.volume++;
    if (c.delta !== null) present.delta++;
    if ([c.delta, c.gamma, c.theta, c.vega].every((x) => x !== null)) present.allGreeks++;
    if (c.rho !== null) present.rho++;
    if (c.bid === null) quotes.missingBid++;
    if (c.ask === null) quotes.missingAsk++;
    if (c.bid === 0) quotes.zeroBid++;
    if (c.ask === 0) quotes.zeroAsk++;
    if ((c.bid ?? 0) < 0 || (c.ask ?? 0) < 0) quotes.negative++;
    if (c.bid !== null && c.ask !== null && c.bid > 0 && c.ask > 0) {
      if (c.bid > c.ask) quotes.crossed++;
      if (c.bid === c.ask) quotes.locked++;
      if (c.ask >= c.bid) {
        quotes.twoSided++;
        spreads.push((c.ask - c.bid) / ((c.ask + c.bid) / 2));
      }
    }
    if (c.expiration < snapshot.tradeDate) integrity.expired++;
    if (c.tradeDate !== snapshot.tradeDate) integrity.tradeDateMismatch++;
    const deltaTolerance = 1e-9;
    if (c.delta !== null && ((c.right === "call" && (c.delta < -deltaTolerance || c.delta > 1 + deltaTolerance)) || (c.right === "put" && (c.delta < -1 - deltaTolerance || c.delta > deltaTolerance)))) integrity.invalidDelta++;
    if ((c.impliedVolatility ?? 0) < 0) integrity.negativeIv++;
    if ((c.impliedVolatility ?? 0) > 5) integrity.ivAbove500Percent++;
    if (c.openInterest === 0) integrity.zeroOpenInterest++;
    if (c.volume === 0) integrity.zeroVolume++;
  }
  spreads.sort((a, b) => a - b);
  const availableMs = timestampMs(snapshot.availableAt), ingestedMs = timestampMs(snapshot.ingestedAt);
  return {
    provider: snapshot.provider, underlying: snapshot.underlying, tradeDate: snapshot.tradeDate,
    snapshotId: snapshot.snapshotId ?? null, availableAt: snapshot.availableAt, ingestedAt: snapshot.ingestedAt,
    contracts: snapshot.contracts.length, expirations: quality.expirations,
    duplicates: quality.duplicates, invalidRows: quality.invalidRows,
    present, quotes, integrity,
    coverage: Object.fromEntries(Object.entries(present).map(([k, v]) => [k, percent(v, snapshot.contracts.length)])),
    spreadPct: { samples: spreads.length, median: quantile(spreads, 0.5), p95: quantile(spreads, 0.95) },
    timing: {
      lagMinutes: availableMs !== null && ingestedMs !== null ? (ingestedMs - availableMs) / 60_000 : null,
      availableDateMatches: snapshot.availableAt.slice(0, 10) === snapshot.tradeDate,
      timezonePresent: hasTimezone(snapshot.availableAt),
      providerTimeLabelPresent: snapshot.providerTimeLabel !== null,
      oiTimestampPresent: false,
    },
    warnings: snapshot.warnings,
  };
}
export type OptionSnapshotAudit = ReturnType<typeof auditOptionSnapshot>;

function errorStats(pairs: [number, number][]) {
  if (!pairs.length) return { pairs: 0, mae: null, medianAbs: null, rmse: null, maxAbs: null };
  const errors = pairs.map(([a, b]) => Math.abs(a - b));
  const sorted = [...errors].sort((a, b) => a - b);
  return {
    pairs: pairs.length,
    mae: errors.reduce((a, b) => a + b, 0) / errors.length,
    medianAbs: quantile(sorted, 0.5),
    rmse: Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length),
    maxAbs: Math.max(...errors),
  };
}
function contractMap(contracts: OptionContract[]): Map<string, OptionContract> {
  const out = new Map<string, OptionContract>();
  for (const c of contracts) out.set(c.contractId, c);
  return out;
}

/** Numeric QA only for identical underlyings and trade dates. No date shifting. */
export function compareOptionSnapshots(a: OptionChainSnapshot, b: OptionChainSnapshot) {
  if (a.provider === b.provider || a.underlying !== b.underlying || a.tradeDate !== b.tradeDate) {
    throw new Error("Cross-provider comparison requires same underlying/date and different providers");
  }
  const left = contractMap(a.contracts), right = contractMap(b.contracts);
  const matched = [...left.keys()].filter((id) => right.has(id));
  const pairs = (pick: (c: OptionContract) => number | null): [number, number][] => matched.flatMap((id) => {
    const x = pick(left.get(id)!), y = pick(right.get(id)!);
    return x !== null && y !== null ? [[x, y]] : [];
  });
  const nearAtmIvPairs = matched.flatMap((id): [number, number][] => {
    const x = left.get(id)!, y = right.get(id)!;
    return x.delta !== null && Math.abs(x.delta) >= 0.2 && Math.abs(x.delta) <= 0.8 && x.impliedVolatility !== null && y.impliedVolatility !== null
      ? [[x.impliedVolatility, y.impliedVolatility]] : [];
  });
  const aMs = timestampMs(a.availableAt), bMs = timestampMs(b.availableAt);
  return {
    left: `${a.provider}:${a.underlying}:${a.tradeDate}:${a.snapshotId ?? "none"}`,
    right: `${b.provider}:${b.underlying}:${b.tradeDate}:${b.snapshotId ?? "none"}`,
    leftContracts: left.size, rightContracts: right.size,
    matchedContracts: matched.length,
    matchRate: percent(matched.length, Math.min(left.size, right.size)),
    coverageOfLeft: percent(matched.length, left.size), coverageOfRight: percent(matched.length, right.size),
    availabilityDeltaMinutes: aMs !== null && bMs !== null ? Math.abs(aMs - bMs) / 60_000 : null,
    iv: errorStats(pairs((c) => c.impliedVolatility)),
    nearAtmIv: errorStats(nearAtmIvPairs),
    delta: errorStats(pairs((c) => c.delta)),
    gamma: errorStats(pairs((c) => c.gamma)),
    theta: errorStats(pairs((c) => c.theta)),
    vega: errorStats(pairs((c) => c.vega)),
    bid: errorStats(pairs((c) => c.bid)),
    ask: errorStats(pairs((c) => c.ask)),
  };
}

function summarize(audits: OptionSnapshotAudit[]) {
  const contracts = audits.reduce((n, a) => n + a.contracts, 0);
  const sumPresent = (key: keyof OptionSnapshotAudit["present"]) => audits.reduce((n, a) => n + a.present[key], 0);
  const sumQuote = (key: keyof OptionSnapshotAudit["quotes"]) => audits.reduce((n, a) => n + a.quotes[key], 0);
  const sumIntegrity = (key: keyof OptionSnapshotAudit["integrity"]) => audits.reduce((n, a) => n + a.integrity[key], 0);
  const lags = audits.map((a) => a.timing.lagMinutes).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return {
    snapshots: audits.length,
    underlyings: new Set(audits.map((a) => a.underlying)).size,
    providerUnderlyingPairs: new Set(audits.map((a) => `${a.provider}:${a.underlying}`)).size,
    warningSnapshots: audits.filter((a) => a.warnings.length > 0).length,
    contracts,
    coverage: Object.fromEntries(Object.keys(audits[0]?.present ?? { iv: 0 }).map((key) => [key, percent(sumPresent(key as keyof OptionSnapshotAudit["present"]), contracts)])),
    quotes: Object.fromEntries(Object.keys(audits[0]?.quotes ?? { zeroBid: 0 }).map((key) => {
      const n = sumQuote(key as keyof OptionSnapshotAudit["quotes"]);
      return [key, { count: n, rate: percent(n, contracts) }];
    })),
    integrity: Object.fromEntries(Object.keys(audits[0]?.integrity ?? { expired: 0 }).map((key) => [key, sumIntegrity(key as keyof OptionSnapshotAudit["integrity"])])),
    duplicates: audits.reduce((n, a) => n + a.duplicates, 0),
    invalidRows: audits.reduce((n, a) => n + a.invalidRows, 0),
    timing: {
      lagSamples: lags.length, medianLagMinutes: quantile(lags, 0.5), p95LagMinutes: quantile(lags, 0.95),
      negativeLag: audits.filter((a) => (a.timing.lagMinutes ?? 0) < 0).length,
      unavailableLag: audits.length - lags.length,
      missingTimezone: audits.filter((a) => !a.timing.timezonePresent).length,
      availableDateMismatch: audits.filter((a) => !a.timing.availableDateMatches).length,
      missingProviderTimeLabel: audits.filter((a) => !a.timing.providerTimeLabelPresent).length,
      oiTimestampAvailable: false,
    },
  };
}

export function buildOptionQaReport(snapshots: OptionChainSnapshot[], generatedAt = new Date().toISOString()) {
  const audits = snapshots.map(auditOptionSnapshot);
  const providers = [...new Set(audits.map((a) => a.provider))].sort().map((provider) => ({
    provider, ...summarize(audits.filter((a) => a.provider === provider)),
  }));
  const historyMap = new Map<string, OptionSnapshotAudit[]>();
  for (const audit of audits) {
    const key = `${audit.provider}|${audit.underlying}`;
    if (!historyMap.has(key)) historyMap.set(key, []);
    historyMap.get(key)!.push(audit);
  }
  const history = [...historyMap.entries()].map(([, rows]) => ({
    provider: rows[0].provider, underlying: rows[0].underlying, snapshots: rows.length,
    tradeDates: new Set(rows.map((r) => r.tradeDate)).size,
    firstTradeDate: rows.map((r) => r.tradeDate).sort()[0],
    lastTradeDate: rows.map((r) => r.tradeDate).sort().at(-1),
  })).sort((a, b) => a.provider.localeCompare(b.provider) || a.underlying.localeCompare(b.underlying));

  const groups = new Map<string, OptionChainSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.underlying}|${snapshot.tradeDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(snapshot);
  }
  const crossProvider: ReturnType<typeof compareOptionSnapshots>[] = [];
  for (const rows of groups.values()) {
    const latest = new Map<string, OptionChainSnapshot>();
    for (const row of rows) {
      const old = latest.get(row.provider);
      if (!old || row.availableAt > old.availableAt) latest.set(row.provider, row);
    }
    const selected = [...latest.values()].sort((a, b) => a.provider.localeCompare(b.provider));
    for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
      crossProvider.push(compareOptionSnapshots(selected[i], selected[j]));
    }
  }
  return {
    generatedAt,
    summary: summarize(audits),
    providers,
    history,
    crossProvider,
    snapshots: audits.sort((a, b) => a.provider.localeCompare(b.provider) || a.underlying.localeCompare(b.underlying) || a.availableAt.localeCompare(b.availableAt)),
  };
}
export type OptionQaReport = ReturnType<typeof buildOptionQaReport>;
