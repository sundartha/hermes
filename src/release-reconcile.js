import {
  classifyNumbersForRelease,
  numberReleaseVerdict,
  findNumber,
  releaseNumber,
  numberBusyReason,
  unbindOwnPlatformBindings,
  tenantInactive,
  tenantNumbersForErase,
  RELEASE_VERDICT,
} from "./store/state-ops.js";
import { NUMBER_STATUS } from "./store/defaults.js";

const PROVIDER_NOT_FOUND = 404;
const RECONCILE_ACTOR = "system:release-reconcile";
const ERASE_ACTOR = "system:erase-release";
const AUDIT_ACTION = Object.freeze({
  RELEASED: "did_released",
  ABORTED: "did_release_aborted",
});
const ABORT_REASON = Object.freeze({
  PROVIDER_ERROR: "provider_error",
  RECHECK_VOR_DELETE: "recheck_vor_delete",
  STORE_MUTATION_NACH_DELETE: "store_mutation_nach_delete",
});

function recordDidAudit(audit, { actor, tenantId, action, detail }) {
  return audit.record({ actorSub: actor, tenantId, action, detail });
}

async function providerReleaseOrGone(provisioner, number, logger) {
  try {
    await provisioner.releaseNumber(number.providerNumberId);
    return true;
  } catch (err) {
    if (err.providerStatus === PROVIDER_NOT_FOUND) {
      logger.warn(`[did-release] provider 404 (bereits weg) number=${number.id} -> Store nachziehen`);
      return true;
    }
    logger.warn(`[did-release] provider-release fehlgeschlagen number=${number.id}: ${err.message}`);
    return false;
  }
}

async function stillReleasableUnderLock(store, numberId) {
  return store.withStoreLock(() => {
    const state = store.load();
    const num = findNumber(state, numberId);
    return (
      !!num && num.status === NUMBER_STATUS.ACTIVE && !numberBusyReason(state, num, { forTenantId: num.tenantId })
    );
  });
}

async function abortRelease({ audit, actor, number, reason, logger, message }) {
  logger.warn(message);
  await recordDidAudit(audit, {
    actor,
    tenantId: number.tenantId,
    action: AUDIT_ACTION.ABORTED,
    detail: `number=${number.id} grund=${reason}`,
  });
  return false;
}

async function performNumberRelease({ store, provisioner, audit, logger, actor, number, sipRegistrar }) {
  if (!(await stillReleasableUnderLock(store, number.id)))
    return abortRelease({
      audit, actor, number, logger,
      reason: ABORT_REASON.RECHECK_VOR_DELETE,
      message: `[did-release] recheck-abbruch VOR provider-delete number=${number.id}`,
    });
  if (!(await providerReleaseOrGone(provisioner, number, logger)))
    return abortRelease({
      audit, actor, number, logger,
      reason: ABORT_REASON.PROVIDER_ERROR,
      message: `[did-release] provider-delete fehlgeschlagen number=${number.id}`,
    });
  if (sipRegistrar && number.providerAgentPhoneNumberId)
    await sipRegistrar.removeRegistration(number.providerAgentPhoneNumberId);
  try {
    await store.withStoreLock(() => {
      const state = store.load();
      const num = findNumber(state, number.id);
      if (num && num.status === NUMBER_STATUS.ACTIVE) {
        const closed = unbindOwnPlatformBindings(state, num);
        try {
          releaseNumber(state, num.id);
        } catch (err) {
          for (const binding of closed) binding.releasedAt = null;
          throw err;
        }
      }
      store.save();
    });
  } catch (err) {
    return abortRelease({
      audit, actor, number, logger,
      reason: ABORT_REASON.STORE_MUTATION_NACH_DELETE,
      message: `[did-release] store-mutation fehlgeschlagen NACH provider-delete number=${number.id}: ${err.message}`,
    });
  }
  logger.log(`[did-release] freigegeben number=${number.id} tenant=${number.tenantId}`);
  await recordDidAudit(audit, {
    actor,
    tenantId: number.tenantId,
    action: AUDIT_ACTION.RELEASED,
    detail: `number=${number.id} provider=${number.providerNumberId}`,
  });
  return true;
}

async function releaseCandidate({ store, provisioner, audit, logger, nowMs, graceMs, numberId, sipRegistrar }) {
  const fresh = store.load();
  const number = findNumber(fresh, numberId);
  const stillReleasable =
    !!number &&
    numberReleaseVerdict(fresh, number, { nowMs, graceMs }).action === RELEASE_VERDICT.RELEASE &&
    tenantInactive(fresh, number.tenantId);
  if (!stillReleasable) {
    logger.warn(`[did-release] recheck-abbruch number=${numberId} (reaktiviert/veraendert)`);
    await recordDidAudit(audit, {
      actor: RECONCILE_ACTOR,
      tenantId: number ? number.tenantId : null,
      action: AUDIT_ACTION.ABORTED,
      detail: `number=${numberId} grund=recheck`,
    });
    return false;
  }
  return performNumberRelease({ store, provisioner, audit, logger, actor: RECONCILE_ACTOR, number, sipRegistrar });
}

export async function runReleaseReconcile({ store, provisioner, audit, logger = console, nowMs, graceMs, sipRegistrar }) {
  const buckets = classifyNumbersForRelease(store.load(), { nowMs, graceMs });
  const candidates = buckets.release;
  for (const { number, reason } of buckets.hold)
    logger.warn(`[did-release] HOLD number=${number.id} grund=${reason}`);
  if (graceMs === 0) {
    if (candidates.length)
      logger.warn(
        `[did-release] OBSERVE-ONLY (RELEASE_GRACE_DAYS=0): ${candidates.length} Kandidat(en) NICHT freigegeben: ${candidates.map((num) => num.id).join(",")}`,
      );
    return { released: 0, aborted: 0, observed: candidates.length };
  }
  let released = 0;
  let aborted = 0;
  for (const candidate of candidates) {
    const ok = await releaseCandidate({ store, provisioner, audit, logger, nowMs, graceMs, numberId: candidate.id, sipRegistrar });
    if (ok) released++;
    else aborted++;
  }
  return { released, aborted, observed: 0 };
}

export async function releaseTenantNumbersOnErase({ store, provisioner, audit, logger = console, tenantId, sipRegistrar }) {
  const { release, hold } = tenantNumbersForErase(store.load(), tenantId);
  let released = 0;
  let aborted = 0;
  for (const { number, reason } of hold) {
    aborted++;
    logger.warn(`[did-release] HOLD number=${number.id} tenant=${tenantId} grund=${reason}`);
    await recordDidAudit(audit, {
      actor: ERASE_ACTOR,
      tenantId,
      action: AUDIT_ACTION.ABORTED,
      detail: `number=${number.id} grund=${reason}`,
    });
  }
  for (const number of release) {
    const ok = await performNumberRelease({
      store, provisioner, audit, logger, actor: ERASE_ACTOR, number, sipRegistrar,
    });
    if (ok) released++;
    else aborted++;
  }
  return { released, aborted };
}
