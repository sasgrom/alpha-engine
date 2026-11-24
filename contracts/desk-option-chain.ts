/**
 * One company's option chain for the desk Company page: the latest complete Schwab capture, read from the raw
 * archive on request (api/services/desk-option-chain.ts). One expiration at a time; raw chains stay local.
 */
export interface DeskOptionQuote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  /** Implied volatility as a fraction; null where the provider's figure is no volatility (zero, or above 500%). */
  iv: number | null;
  delta: number | null;
}

/** The call and the put of one strike. */
export interface DeskOptionStrike {
  strike: number;
  call: DeskOptionQuote | null;
  put: DeskOptionQuote | null;
}

export interface DeskOptionChain {
  ticker: string;
  /** When the chain was captured (UTC), the share price the provider gave with it, and whether its quotes were delayed. */
  capturedAt: string;
  underlyingPrice: number | null;
  delayed: boolean;
  /** Every expiration of the capture: days to it from the capture, and its contracts. */
  expirations: Array<{ date: string; dte: number; contracts: number }>;
  /** The expiration whose strikes follow: the one asked for, or the first at least a week out. */
  expiration: string;
  /** Lowest strike first. */
  strikes: DeskOptionStrike[];
}
