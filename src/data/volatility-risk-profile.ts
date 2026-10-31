export type VolatilityForecastModel = "atmIv" | "rv20";

/**
 * Reviewed historical replay used by the Volatility Lab. Expected-move values
 * retain their reviewed precision; volatility inputs are displayed rounded.
 * This is not a live quote or an expected-return forecast.
 */
export const AAPL_RISK_REPLAY = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  tradeDate: "2024-01-02",
  spot: 183.731,
  dteDays: 17,
  forecastVol: { atmIv: 0.30, rv20: 0.192 },
  expectedMove: { atmIv: 11.851, rv20: 7.601 },
  actualMove: 8.086,
  calibration: { atmIvCoverage: 0.6485, rv20Coverage: 0.5979 },
  provenance: "Reviewed DoltHub option-feature snapshot and availability-anchored local price series",
} as const;

export const VOL_TARGET_LIMITS = {
  minScalar: 0.25,
  maxScalar: 1.00,
  defaultTargetVol: 0.20,
} as const;
