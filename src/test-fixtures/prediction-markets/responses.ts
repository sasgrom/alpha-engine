export const FIXTURE_NOTICE = "Offline public-response fixtures shaped by the lab's recorded responses; never live data.";

function fed(threshold: number, p: number) {
  return {
    ticker: `KXFED-26DEC-T${threshold.toFixed(2)}`,
    event_ticker: "KXFED-26DEC",
    title: `Will the upper bound of the federal funds rate be above ${threshold.toFixed(2)}% following the Fed's Dec 9, 2026 meeting?`,
    status: "active",
    strike_type: "greater",
    floor_strike: threshold,
    yes_bid_dollars: Math.max(0, p - 0.01).toFixed(4),
    yes_ask_dollars: Math.min(1, p + 0.01).toFixed(4),
    last_price_dollars: p.toFixed(4),
    volume_fp: "50000.00",
    volume_24h_fp: "20000.00",
    open_interest_fp: "10000.00",
    liquidity_dollars: "7000.00",
    close_time: "2026-12-09T19:00:00Z",
    open_time: "2026-09-01T04:00:00Z",
    rules_primary: `If the upper bound is greater than ${threshold.toFixed(2)}% after this meeting, the market resolves to Yes.`,
    rules_secondary: "The market expires after the official statement.",
    result: "",
    expiration_value: "",
  };
}

export const KALSHI_FED_RESPONSE = { markets: [fed(3.5, 0.99), fed(3.75, 0.85), fed(4, 0.22), fed(4.25, 0.05), fed(4.5, 0.01), fed(4.75, 0.005), fed(5, 0.001)] };

function cpi(threshold: number, p: number) {
  return {
    ticker: `KXCPI-26NOV-T${threshold}`,
    event_ticker: "KXCPI-26NOV",
    title: `Will CPI rise more than ${threshold}% in November 2026?`,
    status: "active",
    strike_type: "greater",
    floor_strike: threshold,
    yes_bid_dollars: Math.max(0, p - 0.01).toFixed(4),
    yes_ask_dollars: Math.min(1, p + 0.01).toFixed(4),
    last_price_dollars: p.toFixed(4),
    volume_fp: "25000.00",
    volume_24h_fp: "20000.00",
    open_interest_fp: "9000.00",
    liquidity_dollars: "6500.00",
    close_time: "2026-12-10T13:29:00Z",
    open_time: "2026-10-01T04:00:00Z",
    rules_primary: `If CPI increases by more than ${threshold}% in November 2026, the market resolves to Yes.`,
    result: "",
    expiration_value: "",
  };
}

export const KALSHI_CPI_RESPONSE = { markets: [cpi(-0.3, 0.99), cpi(-0.2, 0.95), cpi(-0.1, 0.9), cpi(0, 0.8), cpi(0.1, 0.6), cpi(0.2, 0.35), cpi(0.3, 0.1), cpi(0.4, 0.01)] };

export const KALSHI_RECESSION_MARKET = {
  ticker: "KXRECSSNBER-26",
  event_ticker: "KXRECSSNBER-26",
  title: "Will there be a recession in 2026?",
  status: "active",
  yes_bid_dollars: "0.2100",
  yes_ask_dollars: "0.2300",
  last_price_dollars: "0.2200",
  volume_fp: "10000.00",
  volume_24h_fp: "20000.00",
  open_interest_fp: "1000.00",
  liquidity_dollars: "6000.00",
  close_time: "2026-12-31T23:59:00Z",
  rules_primary: "The market resolves to Yes if a US recession is declared for 2026.",
  result: "",
  expiration_value: "",
};

export const KALSHI_COMPANY_SETTLED = {
  ticker: "KXBBY-26AUGDOMCOMP-N1.0",
  event_ticker: "KXBBY-26AUGDOMCOMP",
  title: "Will Best Buy Co., Inc. report Above -1.0% domestic comparable store sales in Q2 2027?",
  status: "finalized",
  strike_type: "greater",
  floor_strike: -1,
  yes_bid_dollars: "1.0000",
  yes_ask_dollars: "1.0000",
  last_price_dollars: "1.0000",
  volume_fp: "100.00",
  volume_24h_fp: "0.00",
  open_interest_fp: "0.00",
  close_time: "2026-08-27T04:00:00Z",
  open_time: "2026-05-01T04:00:00Z",
  rules_primary: "If Best Buy reports Above -1.0% domestic comparable store sales, the market resolves to Yes.",
  result: "yes",
  expiration_value: "4.5",
  settlement_value_dollars: "1.0000",
};

export const KALSHI_CANDLE_RESPONSE = {
  candlesticks: [
    { end_period_ts: Date.parse("2026-11-13T04:00:00Z") / 1000, yes_bid: { close_dollars: "0.50" }, yes_ask: { close_dollars: "0.60" }, price: { close_dollars: "0.52" } },
    { end_period_ts: Date.parse("2026-11-14T04:00:00Z") / 1000, yes_bid: { close_dollars: "0.40" }, yes_ask: { close_dollars: "0.70" }, price: { close_dollars: "0.42" } },
  ],
};

function poly(question: string, probability: number, conditionId: string, closed = false) {
  return {
    conditionId,
    question,
    bestBid: Math.max(0, probability - 0.01),
    bestAsk: Math.min(1, probability + 0.01),
    lastTradePrice: probability,
    volumeNum: 100000,
    volume24hr: 20000,
    liquidityNum: 8000,
    openInterest: 5000,
    outcomePrices: JSON.stringify([probability, 1 - probability]),
    clobTokenIds: JSON.stringify([conditionId]),
    outcomes: JSON.stringify(["Yes", "No"]),
    active: true,
    closed,
    endDate: "2026-12-09T19:00:00Z",
  };
}

export const POLY_FED_MARKETS = [
  poly("Fed decreases interest rates by 50+ bps after December 2026 meeting?", 0.1, "poly-fed-cut50"),
  poly("Fed decreases interest rates by 25 bps after December 2026 meeting?", 0.2, "poly-fed-cut25"),
  poly("No change in Fed interest rates after December 2026 meeting?", 0.55, "poly-fed-nochange"),
  poly("Fed increases interest rates by 25+ bps after December 2026 meeting?", 0.15, "poly-fed-hike25"),
];

export const POLY_FED_EVENT = { slug: "fed-decision-in-december-2026", title: "Fed decision in December 2026", endDate: "2026-12-09T19:00:00Z", markets: POLY_FED_MARKETS };

export const POLY_CPI_MARKETS = [
  poly("Will CPI rise above -0.2% in November 2026?", 0.99, "poly-cpi-minus02"),
  poly("Will CPI rise above -0.1% in November 2026?", 0.9, "poly-cpi-minus01"),
  poly("Will CPI rise above 0% in November 2026?", 0.7, "poly-cpi-zero"),
  poly("Will CPI rise above 0.1% in November 2026?", 0.4, "poly-cpi-01"),
  poly("Will CPI rise above 0.2% in November 2026?", 0.1, "poly-cpi-02"),
  poly("Will CPI rise above 0.3% in November 2026?", 0.01, "poly-cpi-03"),
];

export const POLY_CPI_EVENT = { slug: "cpi-november-2026", title: "CPI in November 2026", endDate: "2026-12-10T13:30:00Z", markets: POLY_CPI_MARKETS };
export const POLY_RECESSION_EVENT = { slug: "us-recession-in-2026", title: "US recession in 2026", endDate: "2026-12-31T23:59:00Z", markets: [poly("Will the US enter a recession in 2026?", 0.19, "poly-recession-2026")] };
export const POLY_SETTLED_MARKET = poly("No change in Fed interest rates after December 2026 meeting?", 1, "poly-settled-nochange", true);
export const POLY_SETTLED_EVENT = { slug: "fed-decision-in-december-2026", title: "Fed decision in December 2026", endDate: "2026-12-09T19:00:00Z", markets: [POLY_SETTLED_MARKET] };
export const POLY_HISTORY_RESPONSE = { history: [{ t: 1794614400, p: 0.5 }, { t: 1794700800, p: 0.55 }] };
