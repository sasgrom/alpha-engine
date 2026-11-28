export function r1000PanelGatesPass(gates: any, requireSecurityTypes = false) {
  return Boolean(gates?.overlap?.pass && gates?.membership?.pass && gates?.stooqContradictions?.pass
    && gates?.identity?.pass && gates?.calendar?.pass && gates?.chain?.pass
    && (!requireSecurityTypes || gates?.securityTypes?.pass === true && gates?.securityTypes?.status === "enabled" && gates?.securityTypes?.file));
}
