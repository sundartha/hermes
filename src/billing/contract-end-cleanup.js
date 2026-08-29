// 312k-Phase 4: Vertragsende-Aufraeumarbeiten - Rufnummer freigeben + WorkOS-Identitaet
// loeschen, AUSSCHLIESSLICH wenn der Vertrag durch eine KUENDIGUNG endete. Die
// Unterscheidung Kuendigung/Zahlungsausfall selbst lebt in billing/webhook.js (liest
// tenantSubscription(tenant).cancelAtPeriodEnd VOR dem Suspend) - diese Datei wird nur
// gerufen, wenn diese Bedingung bereits bejaht ist. Nummern-Freigabe nutzt den bereits
// vorverdrahteten Seam releaseTenantNumbersOnErase (release-reconcile.js, Muster-Kommentar
// dort: "kein Live-Aufrufer" - DIESER Aufrufer ist der erste). WorkOS-Loeschung ist neu
// (workos-management.js). Beide Teilschritte sind UNABHAENGIG voneinander idempotent und
// duerfen NIEMALS die Sperre (SUSPEND) blockieren - ein Fehler hier wird geloggt +
// durabel auditiert und als offen vermerkt, nie geworfen an den Aufrufer weitergereicht.
//
// Retry-Mechanik folgt dem Bestands-Muster periodischer Aufraeumarbeiten (Muster
// scheduleReleaseReconcile, wiring/web-login.js; runRetention, boot.js): EIN Selektor
// (store.tenantsPendingContractEndCleanup) + EIN Executor (attemptContractEndCleanup),
// Boot-Lauf + Sweep-Intervall - keine eigene Warteschlange.
import { releaseTenantNumbersOnErase } from "../release-reconcile.js";

const AUDIT_ACTION = Object.freeze({
  WORKOS_DELETED: "workos_user_deleted",
  WORKOS_DELETE_FAILED: "workos_user_delete_failed",
  WORKOS_DELETE_SKIPPED: "workos_user_delete_skipped",
});

// Ein WorkOS-Loeschversuch. Liefert true = noch OFFEN (Retry noetig), false = erledigt
// (geloescht ODER nichts zu tun). Jeder Versuch UND jeder Ausgang landet im durablen
// Nachweis (auditStore.record) - console/logger sind nur die operative Sicht daneben.
// Niemals subject (die WorkOS-Nutzer-Kennung) oder den API-Key loggen.
async function attemptWorkosDelete({ store, workos, auditStore, logger, tenantId }) {
  const subject = store.tenantIdpSubject(tenantId);
  if (!subject) {
    // Kein bekannter WorkOS-Identitaet an diesem Tenant (z.B. CLI-bootstrapped ohne
    // Web-Login) - nichts zu loeschen, kein offener Rest.
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.WORKOS_DELETE_SKIPPED,
      detail: "reason=no_identity",
    });
    return false;
  }
  if (!workos) {
    // Owner-Entscheidung (Auslieferungszustand): ohne eigens vergebenen
    // WORKOS_MANAGEMENT_API_KEY wird die Loeschung NICHT versucht - offen vermerkt,
    // protokolliert, der Rest der Vertragsende-Verarbeitung laeuft normal weiter.
    logger.warn(`[contract-end] WORKOS_MANAGEMENT_API_KEY nicht gesetzt - Loeschung offen tenant=${tenantId}`);
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.WORKOS_DELETE_SKIPPED,
      detail: "reason=key_missing",
    });
    return true;
  }
  try {
    await workos.deleteUser(subject);
    await auditStore.record({ tenantId, action: AUDIT_ACTION.WORKOS_DELETED, detail: null });
    return false;
  } catch (err) {
    logger.warn(`[contract-end] WorkOS-Loeschung fehlgeschlagen tenant=${tenantId}: ${err.message}`);
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.WORKOS_DELETE_FAILED,
      detail: "reason=provider_error",
    });
    return true;
  }
}

// Ein vollstaendiger Aufraeum-Versuch fuer EINEN Tenant (Nummern + WorkOS), gerufen sowohl
// direkt am Vertragsende (billing/webhook.js SUSPEND-Zweig) als auch vom periodischen Retry-
// Sweep (runContractEndCleanupSweep). Wirft NIE (jeder Teilschritt ist selbst schon
// fail-soft; die aeusseren try/catch sind ein zusaetzlicher Riegel gegen einen unerwarteten
// Store-Fehler) - der Aufrufer darf dadurch NIE blockiert werden (die Sperre ist beim
// Webhook-Aufrufer bereits laengst vollzogen). Persistiert den Fortschritt am Ende IMMER
// (auch bei "nichts zu tun"), damit ein Tenant ohne offenen Rest aus dem Sweep-Selektor
// faellt (Idempotenz: ein zweiter Durchlauf nach Erfolg findet ihn nicht mehr).
export async function attemptContractEndCleanup({
  store,
  numberProvisioner,
  workos,
  auditStore = { record: async () => {} },
  logger = console,
  tenantId,
  sipRegistrar,
}) {
  let numberReleasePending = true;
  try {
    if (numberProvisioner) {
      const { aborted } = await releaseTenantNumbersOnErase({
        store,
        provisioner: numberProvisioner,
        audit: auditStore,
        logger,
        tenantId,
        sipRegistrar,
      });
      numberReleasePending = aborted > 0;
    } else {
      logger.warn(`[contract-end] kein Nummern-Provisioner injiziert - Freigabe offen tenant=${tenantId}`);
    }
  } catch (err) {
    logger.warn(`[contract-end] Nummern-Freigabe fehlgeschlagen tenant=${tenantId}: ${err.message}`);
  }

  let workosDeletePending = true;
  try {
    workosDeletePending = await attemptWorkosDelete({ store, workos, auditStore, logger, tenantId });
  } catch (err) {
    logger.warn(`[contract-end] WorkOS-Schritt fehlgeschlagen tenant=${tenantId}: ${err.message}`);
  }

  await store.setContractEndCleanupPending(tenantId, { numberReleasePending, workosDeletePending });
  return { numberReleasePending, workosDeletePending };
}

// Periodischer Retry-Sweep (Muster runReleaseReconcile): findet alle Tenants mit noch
// offenem Teilschritt (Selektor tenantsPendingContractEndCleanup, s. state-ops.js - der
// NIE einen bloss zahlungsausfall-suspendierten Tenant liefert, da dessen Felder nie
// gesetzt wurden) und versucht jeden erneut. Idempotent: ein Tenant ohne offenen Rest
// verlaesst den Selektor und wird nicht mehr angefasst.
export async function runContractEndCleanupSweep({
  store,
  numberProvisioner,
  workos,
  auditStore,
  logger = console,
  sipRegistrar,
}) {
  const pending = store.tenantsPendingContractEndCleanup();
  for (const tenant of pending) {
    await attemptContractEndCleanup({
      store,
      numberProvisioner,
      workos,
      auditStore,
      logger,
      tenantId: tenant.id,
      sipRegistrar,
    });
  }
  return { attempted: pending.length };
}
