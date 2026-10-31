export interface GammaExposureInput {
  right: "call" | "put";
  gamma: number;
  openInterest: number;
  multiplier: number;
  spot: number;
}

/** Dollar GEX for one contract: Γ · OI · multiplier · S² · 0.01. */
export function dollarGex(input: GammaExposureInput): number | null {
  const { gamma, openInterest, multiplier, spot } = input;
  if (![gamma, openInterest, multiplier, spot].every(Number.isFinite) || gamma < 0 || openInterest < 0 || multiplier <= 0 || spot <= 0) return null;
  return gamma * openInterest * multiplier * spot * spot * 0.01;
}

/** Scenario-only net GEX: calls minus puts. This is not a dealer-inventory label. */
export function netGex(contracts: GammaExposureInput[]): number | null {
  if (!contracts.length) return null;
  let total = 0;
  for (const contract of contracts) {
    const value = dollarGex(contract);
    if (value === null) return null;
    total += contract.right === "call" ? value : -value;
  }
  return total;
}

/** A flip requires repricing Γ(S); scaling a fixed-Γ GEX by S² cannot change its sign. */
export function canFixedGammaChangeSign(contracts: GammaExposureInput[]): false {
  void contracts;
  return false;
}
