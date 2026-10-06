import * as ops from "../store/state-ops.js";
import { NUMBER_DISPLAY_STATUS, numberStatusFor } from "../store/views.js";
import { PM_TYPE_OUTCOME, fillPaymentMethodType } from "./payment-method-type-reconcile.js";
import { PROVISION_RETRY_OUTCOME, retriggerFailedProvisioning } from "./provision-retry.js";

const FRIST_BUCKET_PREFIX = "provision-retry:";
const SWEEP_EVENT = "provision_retry_sweep";
const LOG_PREFIX = "[provision-retry-sweep]";

export const provisionRetryBucket = (tenantId) => `${FRIST_BUCKET_PREFIX}${tenantId}`;

const ZAEHLER_JE_AUSGANG = Object.freeze({
  [PROVISION_RETRY_OUTCOME.RETRY]: "angestossen",
  [PROVISION_RETRY_OUTCOME.THROTTLED]: "gedrosselt",
  [PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED]: "erschoepft",
  [PROVISION_RETRY_OUTCOME.PAYMENT_METHOD_UNSUITABLE]: "ungeeignet",
});

const AUDIT_AUSGAENGE = new Set([
  PROVISION_RETRY_OUTCOME.RETRY,
  PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED,
]);

export function provisionRetryDue(state, { tenantId, nowMs, minIntervalMs }) {
  const marker = ops.openOutageAlert(state, provisionRetryBucket(tenantId));
  if (!marker || !marker.lastSeenAt) return true;
  const letzteMs = Date.parse(marker.lastSeenAt);
  if (Number.isNaN(letzteMs)) return false;
  return nowMs - letzteMs >= minIntervalMs;
}

async function beanspruche({ store, tenantId, nowMs, minIntervalMs }) {
  const beansprucht = await store.withStoreLock(() => {
    const state = store.load();
    if (!provisionRetryDue(state, { tenantId, nowMs, minIntervalMs })) return false;
    ops.claimOutageAlert(state, { code: provisionRetryBucket(tenantId), nowMs });
    return true;
  });
  store.save();
  return beansprucht;
}

function zaehleAusgaenge(ausgaenge) {
  const zaehler = { angestossen: 0, gedrosselt: 0, erschoepft: 0, ungeeignet: 0 };
  for (const outcome of ausgaenge) {
    const name = ZAEHLER_JE_AUSGANG[outcome];
    if (name) zaehler[name] += 1;
  }
  return zaehler;
}

function meldeAusgang({ audit, tenantId, entscheidung }) {
  if (!AUDIT_AUSGAENGE.has(entscheidung.outcome)) return;
  audit(SWEEP_EVENT, null, `tenant=${tenantId} ausgang=${entscheidung.outcome} versuche=${entscheidung.attempts}`);
}

async function heileUnbekanntenTyp({ store, billing, tenantId }) {
  if (!billing || typeof billing.retrievePaymentMethodType !== "function") return null;
  const state = store.load();
  if (numberStatusFor(state, tenantId) !== NUMBER_DISPLAY_STATUS.FAILED) return null;
  const { paymentMethodId, paymentMethodType } = ops.tenantStripe(state, tenantId);
  if (!paymentMethodId || paymentMethodType) return null;
  const { outcome } = await fillPaymentMethodType({
    store,
    billing,
    tenant: { id: tenantId, stripePaymentMethodId: paymentMethodId },
    apply: true,
  });
  if (outcome === PM_TYPE_OUTCOME.FILLED) store.save();
  return outcome;
}

export async function runProvisionRetrySweep({
  store,
  config,
  provision,
  audit,
  billing = null,
  nowMs = Date.now(),
}) {
  try {
    const minIntervalMs = config.provisioning.provisioningRetryMinIntervalMs;
    if (minIntervalMs <= 0) return;
    const maxAttempts = config.provisioning.provisioningRetryMaxAttempts;
    const tenantIds = ops.allTenantIds(store.load());
    const ausgaenge = [];
    for (const tenantId of tenantIds) {
      await heileUnbekanntenTyp({ store, billing, tenantId });
      const entscheidung = await retriggerFailedProvisioning({
        store,
        provision,
        tenantId,
        maxAttempts,
        claimAttempt: () => beanspruche({ store, tenantId, nowMs, minIntervalMs }),
      });
      ausgaenge.push(entscheidung.outcome);
      meldeAusgang({ audit, tenantId, entscheidung });
    }
    const zaehler = zaehleAusgaenge(ausgaenge);
    console.log(
      `${LOG_PREFIX} geprueft=${tenantIds.length} angestossen=${zaehler.angestossen} ` +
        `gedrosselt=${zaehler.gedrosselt} erschoepft=${zaehler.erschoepft} ungeeignet=${zaehler.ungeeignet}`,
    );
  } catch (err) {
    console.error(LOG_PREFIX, err.message);
  }
}

export function makeProvisionRetryWatch({ store, config, provision, audit, billing = null }) {
  return {
    runProvisionRetrySweep: () => runProvisionRetrySweep({ store, config, provision, audit, billing }),
  };
}
