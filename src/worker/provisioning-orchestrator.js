import { makeSingleFlight } from "../single-flight.ts";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.js";
import {
  PROVIDER,
  PROVISION_NUMBER_JOB,
  shouldPersistProvisionResult,
} from "../begriffe/nummern-vergabe.js";
import { KYC_OUTBOUND_MIN } from "../begriffe/mandant.js";
import { searchParamsForCountry, holdAmountForCountry } from "../telephony/provisioning-geo.js";
import { speicherBereiche } from "../store.js";
import { PROVISION_REASON } from "../billing/provision-outcome.ts";
import { sipRegistrarWennAktiv, inboundTrunkSchreiberWennErlaubt } from "../elevenlabs/nummern-registrierung.js";

const TAKT_INTERVALL_MS = 30_000;
const ABGESCHALTET_MELDUNG = "Warteschlange gestoppt - Auftrag wird zurueckgestellt";

function jobOptionsFor(number, billingConfig) {
  const country = number?.country;
  const geo = searchParamsForCountry(country);
  if (!billingConfig.paymentEnabled) return geo;
  return {
    ...geo,
    holdAmountCents: holdAmountForCountry(country, billingConfig.numberSetupFeeCents),
    currency: billingConfig.paymentCurrency,
  };
}

function skippedOverFailedNumber(result) {
  return Boolean(result.skipped && result.status === NUMBER_STATUS.FAILED);
}

function isNewPaidNumber(result, billingConfig) {
  return Boolean(billingConfig.paymentEnabled && result.number);
}

function enqueueProvisioningJob(einreihen, job) {
  return einreihen({
    kind: PROVISION_NUMBER_JOB,
    payload: { numberId: job.numberId },
    idempotencyKey: job.idempotencyKey,
  });
}

export function makeProvisioningOrchestrator({
  store,
  config,
  queue,
  billing,
  metering,
  numberProvisioning,
  handleProvisionJob,
  resolveProvisionRetry,
  audit,
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  findNumber,
}) {
  const bereiche = speicherBereiche(store);
  let gestoppt = false;

  function einreihen(auftrag) {
    if (gestoppt) return Promise.resolve(null);
    return queue.enqueue(auftrag);
  }

  async function queueProvisioning(numberId, tenantId) {
    const idempotencyKey = `provision_${numberId}`;
    return store
      .withStoreLock(() => {
        const s = store.load();
        const job = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
        store.save();
        return { ok: true, jobId: job.id };
      })
      .then(async (res) => {
        await einreihen({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
        return res;
      })
      .catch((e) => {
        console.error("[provision] Job-Spur fehlgeschlagen:", e.message);
        return { ok: false };
      });
  }

  async function triggerTenantProvisioning(tenantId) {
    await bereiche.nummernkauf.ensureTenant(tenantId);
    await settleDueNumberMonthMeters({ tenantId });
    const numberResult = await store
      .withStoreLock(() => {
        const s = store.load();
        const r = resolveProvisionRetry(s, {
          tenantId,
          nowMs: Date.now(),
          maxAgeMs: config.provisioning.provisioningRedriveMaxAgeMs,
          maxNumbers: config.provisioning.maxNumbers,
          maxNumbersPerTenant: config.provisioning.maxNumbersPerTenant,
        });
        if (shouldPersistProvisionResult(r)) store.save();
        return r;
      })
      .catch((e) => {
        console.error("[webhook-provision] Persistenz fehlgeschlagen:", e.message);
        return { ok: false, reason: PROVISION_REASON.PERSIST_ERROR };
      });
    if (!numberResult.ok) {
      if (numberResult.reason !== PROVISION_REASON.ALREADY_PROVISIONED)
        audit("webhook_provision_skipped", null, `tenant=${tenantId} grund=${numberResult.reason}`);
      return { ok: false, reason: numberResult.reason };
    }
    const numberId =
      numberResult.reason === PROVISION_REASON.REDRIVE ? numberResult.numberId : numberResult.number.id;
    if (!config.provisioning.provisioningEnabled) return { ok: true, reason: PROVISION_REASON.DRY_RUN, numberId };
    if (numberResult.reason === PROVISION_REASON.REDRIVE) {
      redriveProvisioningJobs([numberResult.job]);
      return { ok: true, reason: PROVISION_REASON.REDRIVE, numberId, jobId: numberResult.jobId };
    }
    const jobRes = await queueProvisioning(numberId, tenantId);
    if (!jobRes.ok) return { ok: false, reason: PROVISION_REASON.PERSIST_ERROR };
    void runProvisioningDrainExclusive();
    return { ok: true, reason: PROVISION_REASON.QUEUED, numberId, jobId: jobRes.jobId };
  }

  async function runQueuedJob(state, queuedJob, deps) {
    if (gestoppt) throw new Error(ABGESCHALTET_MELDUNG);
    const record = state.provisioningJobs.find(
      (j) => j.idempotencyKey === queuedJob.idempotencyKey,
    );
    const opts = jobOptionsFor(findNumber(state, queuedJob.payload.numberId), config.billing);
    let result;
    try {
      result = await handleProvisionJob(state, queuedJob, deps, opts);
      if (skippedOverFailedNumber(result)) return;
      if (record) markProvisioningJob(state, record.id, PROVISIONING_JOB_STATUS.DONE);
      store.save();
    } catch (err) {
      if (record)
        markProvisioningJob(state, record.id, PROVISIONING_JOB_STATUS.FAILED, err.message);
      store.save();
      console.error("[provision-worker]", err.message);
      throw err;
    }
    meterNewNumber(result);
  }

  function meterNewNumber(result) {
    if (!isNewPaidNumber(result, config.billing)) return;
    try {
      metering.recordNumberMonthMeter(result.number, new Date().toISOString());
    } catch (err) {
      console.error("[provision-worker] Monatsbeleg fehlgeschlagen:", err.message);
    }
  }

  async function runProvisioningDrain() {
    if (gestoppt) return;
    const state = store.load();
    const deps = { provisioner: numberProvisioning(PROVIDER.TELNYX) };
    deps.sipRegistrar = sipRegistrarWennAktiv(config);
    deps.inboundTrunkSchreiber = inboundTrunkSchreiberWennErlaubt(config);
    if (config.billing.paymentEnabled) deps.billing = billing;
    await queue.drain((queuedJob) => runQueuedJob(state, queuedJob, deps));
  }

  const runProvisioningDrainExclusive = makeSingleFlight(runProvisioningDrain);

  function redriveProvisioningJobs(jobs) {
    if (!jobs.length) return;
    Promise.all(jobs.map((job) => enqueueProvisioningJob(einreihen, job)))
      .then(() => runProvisioningDrainExclusive())
      .catch((err) => console.error("[provision-redrive]", err.message));
  }

  function closeSettledProvisioningJobs(jobs) {
    if (!jobs.length) return;
    store
      .withStoreLock(() => {
        const s = store.load();
        for (const j of jobs) markProvisioningJob(s, j.id, PROVISIONING_JOB_STATUS.DONE);
        store.save();
      })
      .catch((e) => console.error("[provision-reconcile] close:", e.message));
  }

  function reconcileOrphanedProvisioning() {
    if (!config.provisioning.provisioningEnabled) return;
    const buckets = classifyQueuedProvisioningJobs(store.load(), {
      nowMs: Date.now(),
      maxAgeMs: config.provisioning.provisioningRedriveMaxAgeMs,
      kycMinLevel: KYC_OUTBOUND_MIN,
    });
    closeSettledProvisioningJobs(buckets.close);
    for (const { job, reason } of buckets.hold)
      console.warn(
        `[provision-reconcile] hold job=${job.id} number=${job.numberId} tenant=${job.tenantId} grund=${reason}`,
      );
    redriveProvisioningJobs(buckets.redrive);
  }

  let taktAbrufLaeuft = false;

  function beginneTaktAbruf() {
    if (taktAbrufLaeuft) return;
    taktAbrufLaeuft = true;
    runProvisioningDrainExclusive()
      .catch((err) => console.error("[provision-takt]", err.message))
      .finally(() => {
        taktAbrufLaeuft = false;
      });
  }

  let takt = null;

  async function startQueue() {
    if (typeof queue.start !== "function") return;
    await queue.start();
    if (config.provisioning.provisioningEnabled)
      takt = setInterval(beginneTaktAbruf, TAKT_INTERVALL_MS).unref();
  }

  async function stopQueue() {
    if (typeof queue.stop !== "function") return false;
    clearInterval(takt);
    gestoppt = true;
    await runProvisioningDrainExclusive();
    await queue.stop();
    return true;
  }

  async function settleDueNumberMonthMeters({ tenantId = null } = {}) {
    if (!config.billing.paymentEnabled) return { gebucht: 0 };
    try {
      const bilanz = await store.withStoreLock(() =>
        metering.recordDueNumberMonthMeters(store.load(), {
          nowIso: new Date().toISOString(),
          tenantId,
        }),
      );
      if (bilanz.faellig)
        console.log(
          `[number-month] faellig=${bilanz.faellig} gebucht=${bilanz.gebucht} ` +
            `ohne_preis=${bilanz.ohnePreis} fehler=${bilanz.fehler}`,
        );
      return { gebucht: bilanz.gebucht };
    } catch (e) {
      console.error("[number-month] Buchung fehlgeschlagen:", e.message);
      return { gebucht: 0 };
    }
  }

  return {
    startQueue,
    stopQueue,
    queueProvisioning,
    triggerTenantProvisioning,
    runProvisioningDrainExclusive,
    reconcileOrphanedProvisioning,
    settleDueNumberMonthMeters,
  };
}
