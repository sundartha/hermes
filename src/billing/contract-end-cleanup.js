import { releaseTenantNumbersOnErase } from "../release-reconcile.js";

const AUDIT_ACTION = Object.freeze({
  WORKOS_DELETED: "workos_user_deleted",
  WORKOS_DELETE_FAILED: "workos_user_delete_failed",
  WORKOS_DELETE_SKIPPED: "workos_user_delete_skipped",
});

async function attemptWorkosDelete({ store, workos, auditStore, logger, tenantId }) {
  const subject = store.tenantIdpSubject(tenantId);
  if (!subject) {
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.WORKOS_DELETE_SKIPPED,
      detail: "reason=no_identity",
    });
    return false;
  }
  if (!workos) {
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
