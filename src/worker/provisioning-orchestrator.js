import { makeSingleFlight } from "../single-flight.js";
import {
  PROVIDER,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  KYC_OUTBOUND_MIN,
  shouldPersistProvisionResult,
} from "../store/defaults.js";
import { searchParamsForCountry, holdAmountForCountry } from "../telephony/provisioning-geo.js";
import { PROVISION_REASON } from "../billing/provision-outcome.js";
import { sipRegistrarWennAktiv, inboundTrunkSchreiberWennErlaubt } from "../elevenlabs/nummern-registrierung.js";

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
  async function queueProvisioning(numberId, tenantId) {
    const idempotencyKey = `provision_${numberId}`;
    return store
      .withStoreLock(() => {
        const s = store.load();
        const job = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
        store.save();
        return { ok: true, jobId: job.id };
      })
      .then((res) => {
        queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
        return res;
      })
      .catch((e) => {
        console.error("[provision] Job-Spur fehlgeschlagen:", e.message);
        return { ok: false };
      });
  }

  async function triggerTenantProvisioning(tenantId) {
    await store.ensureTenant(tenantId);
    await settleDueNumberMonthMeters({ tenantId });
    const numberResult = await store
      .withStoreLock(() => {
        const s = store.load();
        const r = resolveProvisionRetry(s, {
          tenantId,
          nowMs: Date.now(),
          maxAgeMs: config.provisioning.provisioningRedriveMaxAgeMs,
          fallbackCountry: config.provisioning.provisioningCountry,
          forceNumberCountry: config.provisioning.forceNumberCountry,
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

  async function runProvisioningDrain() {
    const s = store.load();
    const deps = { provisioner: numberProvisioning(PROVIDER.TELNYX) };
    deps.sipRegistrar = sipRegistrarWennAktiv(config);
    deps.inboundTrunkSchreiber = inboundTrunkSchreiberWennErlaubt(config);
    const moneyOpts = {};
    if (config.billing.paymentEnabled) {
      deps.billing = billing;
      moneyOpts.holdAmountCents = config.billing.numberSetupFeeCents;
      moneyOpts.currency = config.billing.paymentCurrency;
    }
    await queue.drain(async (queuedJob) => {
      const record = s.provisioningJobs.find((j) => j.idempotencyKey === queuedJob.idempotencyKey);
      const number = findNumber(s, queuedJob.payload.numberId);
      const geo = searchParamsForCountry(number?.country);
      const holdAmountCents = config.billing.paymentEnabled
        ? holdAmountForCountry(number?.country, config.billing.numberSetupFeeCents)
        : undefined;
      const opts = {
        ...moneyOpts,
        ...geo,
        ...(holdAmountCents !== undefined ? { holdAmountCents } : {}),
      };
      try {
        const r = await handleProvisionJob(s, queuedJob, deps, opts);
        if (record) markProvisioningJob(s, record.id, PROVISIONING_JOB_STATUS.DONE);
        if (config.billing.paymentEnabled)
          metering.recordNumberMonthMeter(r.number, new Date().toISOString());
        store.save();
        return r;
      } catch (err) {
        if (record) markProvisioningJob(s, record.id, PROVISIONING_JOB_STATUS.FAILED, err.message);
        store.save();
        console.error("[provision-worker]", err.message);
        throw err;
      }
    });
  }

  const runProvisioningDrainExclusive = makeSingleFlight(runProvisioningDrain);

  function redriveProvisioningJobs(jobs) {
    for (const j of jobs)
      queue.enqueue({
        kind: PROVISION_NUMBER_JOB,
        payload: { numberId: j.numberId },
        idempotencyKey: j.idempotencyKey,
      });
    if (jobs.length) void runProvisioningDrainExclusive();
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
    queueProvisioning,
    triggerTenantProvisioning,
    runProvisioningDrainExclusive,
    reconcileOrphanedProvisioning,
    settleDueNumberMonthMeters,
  };
}
