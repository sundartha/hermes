export const PROVIDER = Object.freeze({ TELNYX: "telnyx" });
export const DEFAULT_PROVIDER = PROVIDER.TELNYX;

export function resolveSeedProvider(providerRaw) {
  if (!providerRaw) return DEFAULT_PROVIDER;
  return Object.values(PROVIDER).includes(providerRaw) ? providerRaw : null;
}

export const PLATFORM_NUMBER_PURPOSE = Object.freeze({
  OUTBOUND_ANI: "outbound_ani",
  ALERT_SMS_SENDER: "alert_sms_sender",
});

export const NUMBER_HOLD_REASON = Object.freeze({
  PLATFORM_IN_USE: "platform_number_in_use",
  ACTIVE_CALL: "active_call_on_number",
  NON_TELNYX: "non_telnyx_manual",
});

export const GLOBAL_CAP_REASON = "global_cap";

export const NEEDS_MANUAL_RECONCILE_REASON = "needs_manual_reconcile";

export const REQUEST_NUMBER_REASON = Object.freeze({
  TENANT_INACTIVE: "tenant_inactive",
  TENANT_CAP: "tenant_cap",
  GLOBAL_CAP: GLOBAL_CAP_REASON,
});

export function shouldPersistProvisionResult(provisionResult) {
  return provisionResult.ok || provisionResult.reason === GLOBAL_CAP_REASON;
}

export const PROVISION_NUMBER_JOB = "provision_number";

export const NUMBER_SWAP_JOB = "number_swap";
export const SWAP_ATTEMPTS_MAX = 3;

export const TAUSCH_ERGEBNIS = Object.freeze({
  ERSATZ_AKTIV: "ersatz_aktiv",
  GETAUSCHT: "getauscht",
  FREIGABE_FEHLGESCHLAGEN: "freigabe_fehlgeschlagen",
  REGISTRIERUNG_FEHLGESCHLAGEN: "registrierung_fehlgeschlagen",
  DRY_RUN: "dry_run",
  PLATTFORMDECKE: "plattformdecke",
  KAUF_FEHLGESCHLAGEN: "kauf_fehlgeschlagen",
  MANUELL: "manuell",
});
