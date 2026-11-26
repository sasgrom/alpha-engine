import type { ValueRecord } from "./flash-pipeline";

export interface NetSalesIdentity {
  gross: ValueRecord;
  excise: ValueRecord;
  net: ValueRecord;
}

export function findNetSalesIdentity(values: ValueRecord[], gross: ValueRecord): NetSalesIdentity | null {
  if (gross.rowLabel.trim().toLowerCase() !== "sales" || !gross.current || gross.instant || gross.value === null) return null;
  const peers = values.filter(value =>
    value.statement === gross.statement && value.current && !value.instant && value.months === gross.months &&
    value.periodEnd === gross.periodEnd && value.source.file === gross.source.file && value.source.tableIndex === gross.source.tableIndex && value.value !== null
  );
  const excise = peers.find(value => /excise.*tax/i.test(value.rowLabel));
  const net = peers.find(value => value.rowLabel.trim().toLowerCase() === "net sales");
  if (!excise || !net || gross.value! - Math.abs(excise.value!) !== net.value) return null;
  return { gross, excise, net };
}
