/**
 * Options data contracts and provider adapters. Raw payloads remain on disk;
 * these functions only normalize and measure quality, never hide bad rows.
 */
export type OptionRight = "call" | "put";
export type OptionProvider = "cboe" | "eodhd" | "alphavantage" | "orats" | "orats_intraday";

export interface OptionContract {
  contractId: string;
  underlying: string;
  expiration: string;
  strike: number;
  right: OptionRight;
  exchange: string | null;
  providerRowId: string | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  theoretical: number | null;
  midpoint: number | null;
  tradeDate: string | null;
}

export interface OptionQuality {
  rows: number;
  contracts: number;
  calls: number;
  puts: number;
  expirations: number;
  duplicates: number;
  invalidRows: number;
  zeroBid: number;
  crossedQuotes: number;
}

export interface OptionChainSnapshot {
  provider: OptionProvider;
  underlying: string;
  /** Collector run identifier; multiple intraday snapshots share tradeDate. */
  snapshotId?: string;
  tradeDate: string;
  availableAt: string;
  ingestedAt: string;
  providerTimeLabel: string | null;
  underlyingData: Record<string, unknown> | null;
  warnings: string[];
  quality: OptionQuality;
  contracts: OptionContract[];
}

export interface OsiParts { underlying: string; expiration: string; strike: number; right: OptionRight }

export function parseOsiSymbol(symbol: string): OsiParts | null {
  const m = symbol.match(/^(.+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/i);
  if (!m) return null;
  const year = 2000 + Number(m[2]), month = Number(m[3]), day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    underlying: m[1].toUpperCase(),
    expiration: `${year}-${m[3]}-${m[4]}`,
    strike: Number(m[6]) / 1000,
    right: m[5].toUpperCase() === "C" ? "call" : "put",
  };
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function oratsDate(value: unknown): string | null {
  const standard = isoDate(value);
  if (standard) return standard;
  const m = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function latestTimestamp(values: unknown[], fallback: string): string {
  const valid = values.filter((v): v is string => typeof v === "string" && v.length > 0).sort();
  return valid.at(-1) ?? fallback;
}

export function snapshotQuality(contracts: OptionContract[]): OptionQuality {
  const ids = new Set<string>(), expirations = new Set<string>(), rights = new Map<string, OptionRight>();
  let duplicates = 0, invalidRows = 0, zeroBid = 0, crossedQuotes = 0;
  for (const c of contracts) {
    if (ids.has(c.contractId)) duplicates++;
    ids.add(c.contractId);
    rights.set(c.contractId, c.right);
    expirations.add(c.expiration);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.expiration) || !(c.strike > 0)) invalidRows++;
    if (c.bid === 0) zeroBid++;
    if (c.bid !== null && c.ask !== null && c.bid > 0 && c.ask > 0 && c.bid > c.ask) crossedQuotes++;
  }
  const calls = [...rights.values()].filter((r) => r === "call").length;
  const puts = [...rights.values()].filter((r) => r === "put").length;
  return { rows: contracts.length, contracts: ids.size, calls, puts, expirations: expirations.size, duplicates, invalidRows, zeroBid, crossedQuotes };
}

export function finalizeSnapshot(snapshot: Omit<OptionChainSnapshot, "quality">): OptionChainSnapshot {
  const contracts = [...snapshot.contracts].sort((a, b) =>
    a.expiration.localeCompare(b.expiration) || a.strike - b.strike || a.right.localeCompare(b.right) || a.contractId.localeCompare(b.contractId)
  );
  return { ...snapshot, contracts, quality: snapshotQuality(contracts) };
}

function baseContract(parts: OsiParts, values: Partial<OptionContract>): OptionContract {
  return {
    contractId: `${parts.underlying}${parts.expiration.replace(/-/g, "")}${parts.right === "call" ? "C" : "P"}${String(Math.round(parts.strike * 1000)).padStart(8, "0")}`,
    underlying: parts.underlying,
    expiration: parts.expiration,
    strike: parts.strike,
    right: parts.right,
    exchange: null,
    providerRowId: null,
    bid: null, ask: null, bidSize: null, askSize: null, last: null, volume: null,
    openInterest: null, impliedVolatility: null, delta: null, gamma: null,
    theta: null, vega: null, rho: null, theoretical: null, midpoint: null, tradeDate: null,
    ...values,
  };
}

export function normalizeCboe(payload: any, ingestedAt: string): OptionChainSnapshot {
  const data = payload?.data ?? {};
  const underlying = String(payload?.symbol ?? data.symbol ?? "").toUpperCase();
  const availableAt = String(payload?.timestamp ?? ingestedAt);
  const tradeDate = isoDate(availableAt) ?? ingestedAt.slice(0, 10);
  const contracts = (data.options ?? []).map((row: any) => {
    const parts = parseOsiSymbol(String(row.option));
    if (!parts) return null;
    return baseContract(parts, {
      contractId: String(row.option),
      bid: num(row.bid), ask: num(row.ask), bidSize: num(row.bid_size), askSize: num(row.ask_size),
      last: num(row.last_trade_price), volume: num(row.volume), openInterest: num(row.open_interest),
      impliedVolatility: num(row.iv), delta: num(row.delta), gamma: num(row.gamma), theta: num(row.theta),
      vega: num(row.vega), rho: num(row.rho), theoretical: num(row.theo), tradeDate,
    });
  }).filter((c: OptionContract | null): c is OptionContract => c !== null);
  const underlyingData = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "options"));
  return finalizeSnapshot({ provider: "cboe", underlying, tradeDate, availableAt, ingestedAt, providerTimeLabel: null, underlyingData, warnings: [], contracts });
}

export function normalizeEodhd(payload: any, ingestedAt: string): OptionChainSnapshot[] {
  const rows = payload?.data ?? [];
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const a = row.attributes ?? {};
    const day = a.tradetime ?? isoDate(a.bid_date ?? a.ask_date) ?? "unknown";
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(row);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, groupRows]) => {
    const underlying = String(groupRows[0]?.attributes?.underlying_symbol ?? "").toUpperCase();
    const availableAt = latestTimestamp(groupRows.map((r: any) => r.attributes?.bid_date ?? r.attributes?.ask_date ?? r.attributes?.tradetime), ingestedAt);
    const tradeDate = day === "unknown" ? isoDate(availableAt) ?? ingestedAt.slice(0, 10) : day;
    const contracts = groupRows.map((row: any) => {
      const a = row.attributes ?? {};
      const parts = parseOsiSymbol(String(a.contract)) ?? {
        underlying,
        expiration: String(a.exp_date),
        strike: num(a.strike) ?? 0,
        right: String(a.type) === "put" ? "put" as const : "call" as const,
      };
      return baseContract(parts, {
        contractId: String(a.contract),
        exchange: a.exchange ?? null,
        providerRowId: row.id ? String(row.id) : null,
        bid: num(a.bid), ask: num(a.ask), bidSize: num(a.bid_size), askSize: num(a.ask_size),
        last: num(a.last), volume: num(a.volume), openInterest: num(a.open_interest),
        impliedVolatility: num(a.volatility), delta: num(a.delta), gamma: num(a.gamma),
        theta: num(a.theta), vega: num(a.vega), rho: num(a.rho), theoretical: num(a.theoretical),
        midpoint: num(a.midpoint), tradeDate: isoDate(a.tradetime) ?? tradeDate,
      });
    }).filter((c: OptionContract | null): c is OptionContract => c !== null);
    return finalizeSnapshot({
      provider: "eodhd", underlying, tradeDate, availableAt, ingestedAt, providerTimeLabel: "EOD",
      underlyingData: null, warnings: day === "unknown" ? ["Missing tradetime; used quote timestamp as fallback."] : [], contracts,
    });
  });
}

export function normalizeAlphaVantage(payload: any, ingestedAt: string): OptionChainSnapshot {
  const rows = payload?.data ?? [];
  const underlying = String(rows[0]?.symbol ?? "").toUpperCase();
  const tradeDate = latestTimestamp(rows.map((r: any) => r.date), ingestedAt.slice(0, 10));
  const contracts = rows.map((r: any) => {
    const parts = parseOsiSymbol(String(r.contractID));
    if (!parts) return null;
    return baseContract(parts, {
      contractId: String(r.contractID),
      bid: num(r.bid), ask: num(r.ask), bidSize: num(r.bid_size), askSize: num(r.ask_size),
      last: num(r.last), volume: num(r.volume), openInterest: num(r.open_interest),
      impliedVolatility: num(r.implied_volatility), delta: num(r.delta), gamma: num(r.gamma),
      theta: num(r.theta), vega: num(r.vega), rho: num(r.rho), midpoint: num(r.mark),
      tradeDate: isoDate(r.date) ?? tradeDate,
    });
  }).filter((c: OptionContract | null): c is OptionContract => c !== null);
  return finalizeSnapshot({ provider: "alphavantage", underlying, tradeDate, availableAt: tradeDate, ingestedAt, providerTimeLabel: "EOD", underlyingData: null, warnings: [], contracts });
}

function sideParts(record: Record<string, unknown>, right: OptionRight): OsiParts {
  return {
    underlying: String(record.ticker ?? "").toUpperCase(),
    expiration: oratsDate(record.expirDate ?? record.expirationDate ?? record.expiration) ?? "",
    strike: num(record.strike) ?? 0,
    right,
  };
}

function oratsNumber(record: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) if (record[name] !== undefined) return num(record[name]);
  return null;
}

function oratsSideNumber(record: Record<string, unknown>, right: OptionRight, suffixes: string[]): number | null {
  const prefixes = right === "call" ? ["c", "call"] : ["p", "put"];
  return oratsNumber(record, prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix}${suffix}`)));
}

/** ORATS has one row per expiration/strike, with call and put fields side by side. */
export function oratsRecordToContracts(record: Record<string, unknown>): OptionContract[] {
  const tradeDate = oratsDate(record.tradeDate ?? record.trade_date);
  const make = (right: OptionRight) => {
    const prefix = right === "call" ? "c" : "p";
    const osi = right === "call" ? record.cOpra : record.pOpra;
    const parts = osi ? parseOsiSymbol(String(osi)) ?? sideParts(record, right) : sideParts(record, right);
    const bid = oratsSideNumber(record, right, ["BidPx", "Bid", "BidPrice"]);
    const ask = oratsSideNumber(record, right, ["AskPx", "Ask", "AskPrice"]);
    const rawDelta = oratsNumber(record, ["delta"]);
    const delta = right === "put" && rawDelta !== null ? rawDelta - 1 : rawDelta;
    const values: Partial<OptionContract> = {
      bid, ask,
      bidSize: oratsSideNumber(record, right, ["BidSize"]),
      askSize: oratsSideNumber(record, right, ["AskSize"]),
      last: oratsSideNumber(record, right, ["Last", "LastPrice", "Price"]),
      volume: oratsSideNumber(record, right, ["Volu", "Volume"]),
      openInterest: oratsSideNumber(record, right, ["Oi", "OpenInterest"]),
      impliedVolatility: oratsSideNumber(record, right, ["SmvVol", "MidIv", "BidIv", "AskIv"]) ?? oratsNumber(record, ["smoothSmvVol", "smvVol"]),
      delta,
      gamma: oratsNumber(record, ["gamma"]),
      theta: oratsNumber(record, ["theta", "driftlessTheta"]),
      vega: oratsNumber(record, ["vega"]),
      rho: oratsNumber(record, ["rho"]),
      theoretical: oratsNumber(record, [`${prefix}Value`, `${prefix}Theo`]),
      midpoint: oratsNumber(record, [`${prefix}Mid`, `${prefix}Midpoint`]),
      tradeDate,
    };
    if (osi) values.contractId = String(osi);
    return baseContract(parts, values);
  };
  return [make("call"), make("put")];
}

export function oratsSnapshotMeta(record: Record<string, unknown>): { underlying: string; tradeDate: string; providerTimeLabel: string } {
  return {
    underlying: String(record.ticker ?? "").toUpperCase(),
    tradeDate: oratsDate(record.tradeDate ?? record.trade_date) ?? "",
    providerTimeLabel: "near-EOD 15:46 ET",
  };
}

export function oratsAvailableAt(record: Record<string, unknown>, fallback: string): string {
  const value = record.updatedAt ?? record.quoteDate ?? record.snapShotDate ?? record.tradeDate ?? record.trade_date;
  return value ? String(value) : fallback;
}
