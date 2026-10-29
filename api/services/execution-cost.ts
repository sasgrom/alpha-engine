export interface EquityCostInput {
  notional: number;
  advNotional: number;
  participation: number;
  spreadBps: number;
  commissionBps: number;
  impactCoefficient: number;
}

/** Square-root impact scenario, not a broker quote. Every rate is an explicit assumption. */
export function equityCostBps(input: EquityCostInput): { spread: number; commission: number; impact: number; total: number } {
  const { notional, advNotional, participation, spreadBps, commissionBps, impactCoefficient } = input;
  if ([notional, advNotional, participation, spreadBps, commissionBps, impactCoefficient].some((x) => !Number.isFinite(x) || x < 0) || notional <= 0 || advNotional <= 0 || participation <= 0) {
    throw new Error("Positive notional, ADV and participation are required");
  }
  const spread = spreadBps / 2;
  const commission = commissionBps;
  const impact = impactCoefficient * Math.sqrt(participation);
  return { spread, commission, impact, total: spread + commission + impact };
}

export function daysToExit(position: number, adv: number, participation: number): number | null {
  if (!(position >= 0) || !(adv > 0) || !(participation > 0) || ![position, adv, participation].every(Number.isFinite)) return null;
  return position / (adv * participation);
}

export interface OptionLegCost {
  bid: number;
  ask: number;
  multiplier: number;
  contracts: number;
  commissionPerContract: number;
}
/** One-way cost from mid to the executable side, plus per-contract commissions. */
export function optionExecutionCost(legs: OptionLegCost[]): { spreadCost: number; commissions: number; total: number } {
  if (!legs.length) throw new Error("At least one option leg is required");
  let spreadCost = 0, commissions = 0;
  for (const leg of legs) {
    if (leg.bid < 0 || leg.ask < leg.bid || leg.multiplier <= 0 || leg.contracts <= 0 || leg.commissionPerContract < 0) throw new Error("Invalid option leg");
    spreadCost += (leg.ask - leg.bid) / 2 * leg.multiplier * leg.contracts;
    commissions += leg.commissionPerContract * leg.contracts;
  }
  return { spreadCost, commissions, total: spreadCost + commissions };
}

export function netReturnBps(grossReturnBps: number, costBps: number): number {
  if (!Number.isFinite(grossReturnBps) || !Number.isFinite(costBps) || costBps < 0) throw new Error("Invalid return or cost");
  return grossReturnBps - costBps;
}
