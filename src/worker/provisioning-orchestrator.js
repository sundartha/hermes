import { makeSingleFlight } from "../single-flight.ts";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.js";
import {
  PROVIDER,
  PROVISION_NUMBER_JOB,
  SKIP_VERMERK_SCHLUESSEL,
  shouldPersistProvisionResult,
} from "../begriffe/nummern-vergabe.js";
import { ANRUFSTART_JOB } from "../begriffe/anrufe.js";
import { KYC_OUTBOUND_MIN } from "../begriffe/mandant.js";
import { searchParamsForCountry, holdAmountForCountry } from "../telephony/provisioning-geo.ts";
import { speicherBereiche } from "../store.js";
import { PROVISION_REASON } from "../billing/provision-outcome.ts";
import { elevenlabsNummern } from "../elevenlabs/nummern-port.ts";

const TAKT_INTERVALL_MS = 30_000;
const ANRUFSTART_TAKT_MS = 2000;
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
  anrufstartHandler = null,
}) {
  const bereiche = speicherBereiche(store);
  let gestoppt = false;

  function einreihen(auftrag) {
    if (gestoppt) return Promise.resolve(null);
    return queue.enqueue(auftrag);
  }

  async function jobAnlegen(zustand, eingabe) {
    const number = findNumber(zustand, eingabe.numberId);
    if (!number) return recordProvisioningJob(zustand, eingabe);
    const inDatenbank = await bereiche.nummernkauf.legeAuftragAn({
      ...eingabe,
      number,
      jetztIso: new Date().toISOString(),
    });
    if (!inDatenbank) return recordProvisioningJob(zustand, eingabe);
    const vorhanden = zustand.provisioningJobs.find((job) => job.idempotencyKey === eingabe.idempotencyKey);
    if (vorhanden) return vorhanden;
    zustand.provisioningJobs.push(inDatenbank);
    return inDatenbank;
  }

  async function nummerUnterSperre(zustand, ergebnis, tenantId) {
    if (!ergebnis.ok || ergebnis.reason === PROVISION_REASON.REDRIVE) return null;
    const zurueck = async () => {
      zustand.numbers.splice(zustand.numbers.indexOf(ergebnis.number), 1);
      await bereiche.nummernkauf.entferneNummer({ tenantId, numberId: ergebnis.number.id });
    };
    let gebucht;
    try {
      gebucht = await bereiche.nummernkauf.legeNummerAn({
        tenantId,
        number: ergebnis.number,
        hoechstens: Math.min(1, config.provisioning.maxNumbersPerTenant),
      });
    } catch (fehler) {
      await zurueck().catch(() => undefined);
      throw fehler;
    }
    if (!gebucht || gebucht.ok) return null;
    await zurueck();
    return { ok: false, reason: PROVISION_REASON.ALREADY_PROVISIONED };
  }

  async function queueProvisioning(numberId, tenantId) {
    const idempotencyKey = `provision_${numberId}`;
    return store
      .withStoreLock(async () => {
        const zustand = store.load();
        const job = await jobAnlegen(zustand, { numberId, tenantId, idempotencyKey });
        store.save();
        return { ok: true, jobId: job.id };
      })
      .then(async (res) => {
        await einreihen({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
        return res;
      })
      .catch((fehler) => {
        console.error("[provision] Job-Spur fehlgeschlagen:", Reflect.get(Object(fehler), "message"));
        return { ok: false };
      });
  }

  async function triggerTenantProvisioning(tenantId) {
    await bereiche.nummernkauf.ensureTenant(tenantId);
    await settleDueNumberMonthMeters({ tenantId });
    const numberResult = await store
      .withStoreLock(async () => {
        const zustand = store.load();
        const retry = resolveProvisionRetry(zustand, {
          tenantId,
          nowMs: Date.now(),
          maxAgeMs: config.provisioning.provisioningRedriveMaxAgeMs,
          maxNumbers: config.provisioning.maxNumbers,
          maxNumbersPerTenant: config.provisioning.maxNumbersPerTenant,
        });
        const abgelehnt = await nummerUnterSperre(zustand, retry, tenantId);
        if (abgelehnt) return abgelehnt;
        if (shouldPersistProvisionResult(retry)) {
          store.save();
          store.stammdatenSchreiben?.(tenantId, SKIP_VERMERK_SCHLUESSEL);
        }
        return retry;
      })
      .catch((fehler) => {
        console.error(
          "[webhook-provision] Persistenz fehlgeschlagen:",
          Reflect.get(Object(fehler), "message"),
        );
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
    runProvisioningDrainExclusive().catch((fehler) => {
      console.error("[provision-drain]", Reflect.get(Object(fehler), "message"));
    });
    return { ok: true, reason: PROVISION_REASON.QUEUED, numberId, jobId: jobRes.jobId };
  }

  async function runQueuedJob(state, queuedJob, deps) {
    if (gestoppt) throw new Error(ABGESCHALTET_MELDUNG);
    const record = state.provisioningJobs.find(
      (eintrag) => eintrag.idempotencyKey === queuedJob.idempotencyKey,
    );
    const opts = jobOptionsFor(findNumber(state, queuedJob.payload.numberId), config.billing);
    let result;
    try {
      result = await handleProvisionJob(state, queuedJob, { ...deps, opts });
      if (skippedOverFailedNumber(result)) return;
      if (record) markProvisioningJob(state, record.id, PROVISIONING_JOB_STATUS.DONE);
      store.save();
    } catch (fehler) {
      if (record)
        markProvisioningJob(
          state,
          record.id,
          PROVISIONING_JOB_STATUS.FAILED,
          Reflect.get(Object(fehler), "message"),
        );
      store.save();
      console.error("[provision-worker]", Reflect.get(Object(fehler), "message"));
      throw fehler;
    }
    meterNewNumber(result);
  }

  function meterNewNumber(result) {
    if (!isNewPaidNumber(result, config.billing)) return;
    try {
      metering.recordNumberMonthMeter(result.number, new Date().toISOString());
    } catch (fehler) {
      console.error(
        "[provision-worker] Monatsbeleg fehlgeschlagen:",
        Reflect.get(Object(fehler), "message"),
      );
    }
  }

  async function runProvisioningDrain() {
    if (gestoppt) return;
    const state = store.load();
    const deps = { provisioner: numberProvisioning(PROVIDER.TELNYX) };
    deps.sipRegistrar = elevenlabsNummern().sipRegistrarWennAktiv(config);
    deps.inboundTrunkSchreiber = elevenlabsNummern().inboundTrunkSchreiberWennErlaubt(config);
    if (config.billing.paymentEnabled) deps.billing = billing;
    await queue.drain((queuedJob) => runQueuedJob(state, queuedJob, deps), PROVISION_NUMBER_JOB);
  }

  const runProvisioningDrainExclusive = makeSingleFlight(runProvisioningDrain);

  function redriveProvisioningJobs(jobs) {
    if (!jobs.length) return;
    Promise.all(jobs.map((job) => enqueueProvisioningJob(einreihen, job)))
      .then(() => runProvisioningDrainExclusive())
      .catch((fehler) => {
        console.error("[provision-redrive]", Reflect.get(Object(fehler), "message"));
      });
  }

  function closeSettledProvisioningJobs(jobs) {
    if (!jobs.length) return;
    store
      .withStoreLock(() => {
        const zustand = store.load();
        for (const eintrag of jobs)
          markProvisioningJob(zustand, eintrag.id, PROVISIONING_JOB_STATUS.DONE);
        store.save();
      })
      .catch((fehler) => {
        console.error("[provision-reconcile] close:", Reflect.get(Object(fehler), "message"));
      });
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

  let anrufstartGestoppt = false;

  async function runAnrufstartDrain() {
    if (anrufstartGestoppt) return;
    await queue.drain(anrufstartHandler, ANRUFSTART_JOB);
  }

  const runAnrufstartDrainExclusive = makeSingleFlight(runAnrufstartDrain);

  function macheTakt(abruf, praefix) {
    let laeuft = false;
    return function beginneTaktAbruf() {
      if (laeuft) return;
      laeuft = true;
      abruf()
        .catch((fehler) => {
          console.error(praefix, Reflect.get(Object(fehler), "message"));
        })
        .finally(() => {
          laeuft = false;
        });
    };
  }

  let takt;
  let anrufstartTakt;

  async function startQueue() {
    if (anrufstartHandler)
      anrufstartTakt = setInterval(
        macheTakt(runAnrufstartDrainExclusive, "[anrufstart-takt]"),
        ANRUFSTART_TAKT_MS,
      ).unref();
    if (typeof queue.start !== "function") return;
    await queue.start();
    if (config.provisioning.provisioningEnabled)
      takt = setInterval(
        macheTakt(runProvisioningDrainExclusive, "[provision-takt]"),
        TAKT_INTERVALL_MS,
      ).unref();
  }

  async function stopQueue() {
    clearInterval(anrufstartTakt);
    anrufstartGestoppt = true;
    await runAnrufstartDrainExclusive();
    if (typeof queue.stop !== "function") return false;
    clearInterval(takt);
    gestoppt = true;
    await runProvisioningDrainExclusive();
    await queue.stop();
    return true;
  }

  const plane = (name, intervallMs, lauf) => queue.plane(name, intervallMs, lauf);
  const ueberfaelligeZeitplaene = () => queue.ueberfaellige();

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
          `[number-month] faellig=${String(bilanz.faellig)} gebucht=${String(bilanz.gebucht)} ` +
            `ohne_preis=${String(bilanz.ohnePreis)} fehler=${String(bilanz.fehler)}`,
        );
      return { gebucht: bilanz.gebucht };
    } catch (fehler) {
      console.error("[number-month] Buchung fehlgeschlagen:", Reflect.get(Object(fehler), "message"));
      return { gebucht: 0 };
    }
  }

  const reiheAnrufstartEin = (callId) =>
    einreihen({ kind: ANRUFSTART_JOB, payload: { callId }, idempotencyKey: `${ANRUFSTART_JOB}_${callId}` });

  return {
    startQueue,
    stopQueue,
    reiheAnrufstartEin,
    plane,
    ueberfaelligeZeitplaene,
    queueProvisioning,
    triggerTenantProvisioning,
    runProvisioningDrainExclusive,
    reconcileOrphanedProvisioning,
    settleDueNumberMonthMeters,
  };
}
