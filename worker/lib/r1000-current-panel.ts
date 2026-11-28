export function r1000PanelGatesPass(gates: any) {
  return Boolean(gates?.overlap?.pass && gates?.membership?.pass && gates?.stooqContradictions?.pass
    && gates?.identity?.pass && gates?.calendar?.pass && gates?.chain?.pass);
}
