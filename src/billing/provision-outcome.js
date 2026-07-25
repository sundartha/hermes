// GAP-04: die Gruende, mit denen triggerTenantProvisioning antwortet - EINE Quelle
// (G25/G5) statt verstreuter String-Literale im Orchestrator und in der Aktivierung.
// Rein, kein IO.
import { REQUEST_NUMBER_REASON } from "../store/defaults.js";

export const PROVISION_REASON = Object.freeze({
  QUEUED: "queued",
  REDRIVE: "redrive",
  DRY_RUN: "dry_run",
  ALREADY_PROVISIONED: "already_provisioned",
  // TENANT_CAP/GLOBAL_CAP sind byte-identisch zur SSoT in store/defaults.js
  // (REQUEST_NUMBER_REASON) - kein zweites Literal fuer denselben Wert (G5).
  TENANT_CAP: REQUEST_NUMBER_REASON.TENANT_CAP,
  GLOBAL_CAP: REQUEST_NUMBER_REASON.GLOBAL_CAP,
  PERSIST_ERROR: "persist_error",
  NEEDS_MANUAL_RECONCILE: "needs_manual_reconcile",
});

// Gruende, die die Aktivierung freigeben. ALREADY_PROVISIONED kommt als {ok:false} zurueck,
// ist aber der IDEMPOTENTE Erfolgsfall (Webhook-Retry, oder ein nach Zahlungsausfall
// gesperrter Tenant, der wieder zahlt und laengst eine Nummer hat) - er MUSS freigeben,
// sonst bliebe ein wieder zahlender Kunde dauerhaft gesperrt. DRY_RUN gibt frei, weil der
// Betreiber den Kauf bewusst abgeschaltet hat (PROVISIONING_ENABLED=false ist eine
// Konfiguration, kein Fehlschlag) - sichtbar am eigenen Audit-Detail.
const CLEARING_REASONS = Object.freeze(
  new Set([
    PROVISION_REASON.QUEUED,
    PROVISION_REASON.REDRIVE,
    PROVISION_REASON.DRY_RUN,
    PROVISION_REASON.ALREADY_PROVISIONED,
  ]),
);

// Gibt die Aktivierung frei? Fail-closed: ein fehlendes/unbekanntes Ergebnis gilt als
// NICHT geklaert (nie raten, G26).
export function provisionCleared(result) {
  return Boolean(result && CLEARING_REASONS.has(result.reason));
}

// Audit-Detail-Fragment fuers Provisioning-Ergebnis (Muster profileAuditDetail,
// activation.js): "provision=queued" bei Freigabe, "provision=withheld:<grund>" sonst.
// undefined/null-Ergebnis -> "provision=none" (Aktivierung lief nicht so weit).
export function provisionAuditDetail(result) {
  if (!result || !result.reason) return "provision=none";
  return provisionCleared(result) ? `provision=${result.reason}` : `provision=withheld:${result.reason}`;
}
