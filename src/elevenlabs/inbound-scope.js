export const INBOUND_EL_SCOPE = Object.freeze({
  ALLOWLIST: "allowlist",
  REGISTRIERTE_DIDS: "registrierte_dids",
});

export const DEFAULT_INBOUND_EL_SCOPE = INBOUND_EL_SCOPE.ALLOWLIST;

export function isInboundElScope(wert) {
  return Object.values(INBOUND_EL_SCOPE).includes(wert);
}
