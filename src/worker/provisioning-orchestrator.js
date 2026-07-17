// Provisioning-Orchestrator (Server-Slim P6): enqueue/trigger/drain(single-flight)/reconcile
// fuer den Nummern-Kauf. Reine Verschiebung aus server.js. Factory schliesst die injizierten
// Deps; reine Konstanten/Geo-Helfer importiert das Modul selbst (EINE Quelle, G5). INV-7: der
// makeSingleFlight-Guard lebt im Factory-Scope = EIN Drain-Guard pro Prozess (kein Doppelkauf).
// Die Gating-Bedingung `if (config.paymentEnabled)` bleibt beim Aufrufer (runProvisioningDrain-
// Body), nicht ausgelagert. Geld-Invarianten (Hold-vor-Order, kein active ohne Capture,
// Rollback) liegen unveraendert in provisionNumber/handleProvisionJob.
import { makeSingleFlight } from "../single-flight.js";
import {
  PROVIDER,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  KYC_OUTBOUND_MIN,
  shouldPersistProvisionResult,
} from "../store/defaults.js";
import { searchParamsForCountry, holdAmountForCountry } from "../telephony/provisioning-geo.js";

export function makeProvisioningOrchestrator({
  store,
  config,
  queue, // = provisioningQueue (INV-7: DIE eine Queue-Instanz)
  billing, // = stripeBilling
  metering, // = DIE eine metering-Instanz (INV-7)
  numberProvisioning, // Provider-Registry-Dispatch (DIP)
  handleProvisionJob, // Provider-Kauf-Worker (Domaenen-Schritt)
  resolveProvisionRetry, // Retry-Entscheidungskern (Domaenen-Schritt)
  audit, // util.audit (nur Keys, keine PII)
  recordProvisioningJob, // store-op
  markProvisioningJob, // store-op
  classifyQueuedProvisioningJobs, // store-op
  findNumber, // store-op
}) {
  // Provisioning-Job einreihen + Job-Spur persistieren (geteilt von /api/onboard UND dem
  // Webhook-Aktivierungs-Trigger, G5). Enqueue ist idempotent ueber den number-id-Key;
  // recordProvisioningJob dedupt die Spur. Liefert {ok, jobId} | {ok:false}. Der Aufrufer
  // stoesst den Drain an (Reihenfolge bleibt aufrufer-spezifisch).
  async function queueProvisioning(numberId, tenantId) {
    const idempotencyKey = `provision_${numberId}`;
    queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
    return store
      .withStoreLock(() => {
        const s = store.load();
        const job = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
        store.save();
        return { ok: true, jobId: job.id };
      })
      .catch((e) => {
        console.error("[provision] Job-Spur fehlgeschlagen:", e.message);
        return { ok: false };
      });
  }

  // Webhook-Aktivierungs-Trigger (P3): nach bestaetigter Zahlung GENAU EINE Nummer pro
  // Tenant anfragen und (bei PROVISIONING_ENABLED) den Kauf-Job einreihen. Idempotent
  // (Invariante 4): hat der Tenant schon eine lebende Nummer -> No-op (Webhook-Retry/Folge-
  // 'updated' kaufen nie doppelt). Land aus dem Tenant-Geo (onboard) mit config-Fallback;
  // Sprache aus dem Land (eine Quelle, wie onboard). Geld-/Kauf-Invarianten (Hold-vor-Order,
  // kein active ohne Capture, Rollback) bleiben in provisionNumber. Ein geblockter Kauf
  // (Cap/persist_error) landet PII-frei (tenantId/Grund) im Audit-Trail (BK3); der Trigger
  // hat keinen req-Kanal, daher req=null (audit markiert die Quelle als "system").
  async function triggerTenantProvisioning(tenantId) {
    // Liefert {ok, reason, numberId?, jobId?}: der Stripe-Webhook (provision-Seam) ignoriert
    // das Ergebnis, der Operator-Re-Trigger POST /api/onboard/retry (P2) nutzt es fuer die
    // HTTP-Antwort. reason: already_provisioned | tenant_cap | global_cap | persist_error |
    // dry_run | queued.
    // Spiegel-Nachzug VOR der Provisionierung: activatePaidTenant aktiviert den Tenant nur in
    // der DB (accounts.setStatus) - der Store-Spiegel traegt noch den suspended-Login-Wert.
    // requestNumber liest den Spiegel-status; ohne Nachzug -> tenant_inactive -> kein Kauf
    // trotz bezahltem Abo (still uebersprungen). ensureTenant zieht den realen (jetzt active)
    // status nach. Laeuft VOR dem withStoreLock (eigener DB-Read via withClient, fail-safe,
    // kein Re-Entrancy-Konflikt mit dem Lock-Body).
    await store.ensureTenant(tenantId);
    const numberResult = await store
      .withStoreLock(() => {
        const s = store.load();
        // PROV-01/F7: Decision-Core prueft zuerst einen stuck-requested+queued (Crash-Recovery)
        // und faellt sonst unveraendert auf requestNumberForPaidTenant zurueck (G5, EINE Quelle).
        // save bleibt hier (IO, P15). nowMs/maxAgeMs config-frei hineingereicht.
        const r = resolveProvisionRetry(s, {
          tenantId,
          nowMs: Date.now(),
          maxAgeMs: config.provisioningRedriveMaxAgeMs,
          fallbackCountry: config.provisioningCountry,
          forceNumberCountry: config.forceNumberCountry,
          maxNumbers: config.maxNumbers,
          maxNumbersPerTenant: config.maxNumbersPerTenant,
        });
        // Fix B (G5/S2): dieselbe Persistenz-Entscheidung wie POST /api/onboard. Fuer redrive/
        // needs_manual_reconcile mutiert der Core NICHT; nur der fresh-Pfad (requestNumber) schreibt.
        if (shouldPersistProvisionResult(r)) store.save();
        return r;
      })
      .catch((e) => {
        console.error("[webhook-provision] Persistenz fehlgeschlagen:", e.message);
        return { ok: false, reason: "persist_error" };
      });
    if (!numberResult.ok) {
      // already_provisioned ist ein erwarteter idempotenter No-op (Webhook-Retry/Folge-
      // event) - kein Audit-Wert. Jeder andere Grund (tenant_cap/global_cap = Kosten-
      // Notbremse, persist_error, needs_manual_reconcile) ist forensisch relevant: kein Kauf
      // trotz bezahltem Abo -> in den Audit-Trail (Spec BK3: "Limit ueberschritten -> kein Kauf,
      // Audit-Eintrag"). req=null -> audit-util markiert die Quelle als "system" (kein HTTP-
      // Kontext im Webhook-Trigger). Nur die tenantId + Grund-Code, kein Secret/PII (H4).
      if (numberResult.reason !== "already_provisioned")
        audit("webhook_provision_skipped", null, `tenant=${tenantId} grund=${numberResult.reason}`);
      return { ok: false, reason: numberResult.reason };
    }
    // Beide ok-Faelle liefern eine numberId (redrive: numberResult.numberId; fresh: numberResult.number.id).
    const numberId = numberResult.reason === "redrive" ? numberResult.numberId : numberResult.number.id;
    // Dry-Run (PROVISIONING_ENABLED=false, P3-Default): Nummer bleibt 'requested', KEIN Kauf/
    // Re-Drive - EINE Stelle fuer beide Pfade (G5, kein doppelter Gate).
    if (!config.provisioningEnabled) return { ok: true, reason: "dry_run", numberId };
    // Redrive: KEINE neue Nummer/Job (queueProvisioning), sondern den bestehenden stuck-Job in
    // den single-flight-Drain zurueckgeben (dieselbe numberId/idempotencyKey -> kein Doppelkauf).
    if (numberResult.reason === "redrive") {
      redriveProvisioningJobs([numberResult.job]);
      return { ok: true, reason: "redrive", numberId, jobId: numberResult.jobId };
    }
    const jobRes = await queueProvisioning(numberId, tenantId);
    if (!jobRes.ok) return { ok: false, reason: "persist_error" };
    void runProvisioningDrainExclusive();
    return { ok: true, reason: "queued", numberId, jobId: jobRes.jobId };
  }

  // Verarbeitet wartende provision_number-Jobs deterministisch (In-Memory-Drain).
  // Baut deps (provisioner + optional Stripe-Billing bei PAYMENT_ENABLED) genau wie
  // der frueher synchrone Onboard-Pfad. KEIN active ohne Capture / Rollback liegen in
  // provisionNumber. Persistiert nach jedem Job (Worker selbst ist save-frei, reine Fn).
  async function runProvisioningDrain() {
    const s = store.load();
    const deps = { provisioner: numberProvisioning(PROVIDER.TELNYX) };
    // Geld-/Zahlungs-Optionen sind land-unabhaengig (global). Die Suchparameter
    // (countryCode/connectionId) werden PRO JOB aus dem Number-Record abgeleitet
    // (P7, Geo-Provisioning) - nicht mehr global aus config.provisioningCountry.
    const moneyOpts = {};
    if (config.paymentEnabled) {
      deps.billing = billing;
      moneyOpts.holdAmountCents = config.numberSetupFeeCents;
      moneyOpts.currency = config.paymentCurrency;
    }
    await queue.drain(async (queuedJob) => {
      const record = s.provisioningJobs.find((j) => j.idempotencyKey === queuedJob.idempotencyKey);
      // Per-Job-Suchparameter aus dem Land des Number-Records (P7). Fehlender Record
      // (Re-Drain einer geloeschten Number) -> Worker skippt ueber den Zustandscheck;
      // searchParamsForCountry(undefined) liefert den globalen DE-Fallback (byte-identisch).
      const number = findNumber(s, queuedJob.payload.numberId);
      const geo = searchParamsForCountry(number?.country);
      // Per-Land-Hold (P9, R3): ueberschreibt den globalen moneyOpts.holdAmountCents nur,
      // wenn das Land einen eigenen Tarif hat; sonst = numberSetupFeeCents (byte-identisch).
      // Fehlender Record / DE -> Default. NUR im Geld-Pfad (PAYMENT_ENABLED), sonst undefined.
      const holdAmountCents = config.paymentEnabled
        ? holdAmountForCountry(number?.country, config.numberSetupFeeCents)
        : undefined;
      const opts = {
        ...moneyOpts,
        ...geo,
        ...(holdAmountCents !== undefined ? { holdAmountCents } : {}),
      };
      try {
        const r = await handleProvisionJob(s, queuedJob, deps, opts);
        if (record) markProvisioningJob(s, record.id, PROVISIONING_JOB_STATUS.DONE);
        // number_month-Meter (P6b3, Meter 1): NUR wenn eine Nummer NEU aktiviert wurde
        // (r.number, nicht skipped) UND im Metering-Pfad. Erste Periode bei Aktivierung
        // (monatlicher Scheduler = P8). costCents = der Setup-Tarif (numberSetupFeeCents).
        if (config.paymentEnabled) metering.recordNumberMonthMeter(r.number);
        store.save();
        return r;
      } catch (err) {
        if (record) markProvisioningJob(s, record.id, PROVISIONING_JOB_STATUS.FAILED, err.message);
        store.save(); // 'failed'-Number + Job persistieren
        console.error("[provision-worker]", err.message);
        throw err; // drain markiert den Queue-Job failed; provisionNumber hat schon gerollbackt
      }
    });
  }

  // Single-Flight um den Drain (PROV-01/F3): prozessweit laeuft nie mehr als EIN Drain
  // gleichzeitig. Zwei fast-gleichzeitige Ausloeser (POST /api/onboard + Webhook-/Retry-Trigger)
  // wuerden sonst denselben QUEUED-Job doppelt verarbeiten - der Adapter-drain markiert 'done'
  // erst NACH dem langen Provider-await -> Doppel-Order/Doppel-Capture. EIGENE Kette (nicht
  // store.withStoreLock): der lange Drain-await darf die kurze Store-Schreib-Serialisierung
  // nicht blockieren. Definiert direkt am Drain (G10); die Aufrufer (triggerTenantProvisioning
  // hier, POST /api/onboard extern) sehen den Factory-Scope-const zur Laufzeit initialisiert.
  const runProvisioningDrainExclusive = makeSingleFlight(runProvisioningDrain);

  // PROV-01/F5: die geld-sicher nachfuehrbare Teilmenge (classify -> redrive) erneut in die
  // Queue geben und den single-flight-Drain anstossen. Reihenfolge/Idempotenz wie
  // queueProvisioning (derselbe number-id-Key -> KEINE neue Nummer, KEIN Doppelkauf, nur
  // innerhalb des Anbieter-Idempotenz-Fensters ueber das Alters-Gate in classify). Geteilt mit
  // dem Retry-Lever (F7).
  function redriveProvisioningJobs(jobs) {
    for (const j of jobs)
      queue.enqueue({
        kind: PROVISION_NUMBER_JOB,
        payload: { numberId: j.numberId },
        idempotencyKey: j.idempotencyKey,
      });
    if (jobs.length) void runProvisioningDrainExclusive();
  }

  // close-Korb (Nummer aktiv/terminal/fehlt): den gegenstandslosen QUEUED-Job terminal auf DONE
  // setzen - KEIN Kauf, die Recovery-Tuer fuer mid-flight bleibt zu (nur close). Kurzer
  // Schreibabschnitt unter withStoreLock (kein Netz-await). Fehler fail-closed geloggt
  // (secret-/PII-frei), NIE als unhandled rejection (Muster releaseReserve/queueProvisioning).
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

  // PROV-01/F5: Boot-Sweep-Reconciler. Klassifiziert die persistierten QUEUED-Job-Spuren (Crash
  // zwischen Enqueue und Drain, store.save NUR am Job-Ende) und handelt pro Korb: close -> Job
  // schliessen; hold -> Owner-Reconcile-Runbook (nur Log, KEIN Auto-Kauf); redrive -> geld-sicher
  // nachfuehren. fail-closed auf PROVISIONING_ENABLED (Dry-Run kauft nichts nach). maxAge=0
  // (Default) = Observe-Only -> jeder requested-Job faellt in hold. Aufruf fire-and-forget im
  // app.listen-Callback (blockiert weder listen noch Healthcheck). Log PII-/Secret-frei (nur
  // interne job/number/tenant-IDs + Grund, kein e164/PaymentIntent/Key, Regel 4).
  function reconcileOrphanedProvisioning() {
    if (!config.provisioningEnabled) return;
    const buckets = classifyQueuedProvisioningJobs(store.load(), {
      nowMs: Date.now(),
      maxAgeMs: config.provisioningRedriveMaxAgeMs,
      kycMinLevel: KYC_OUTBOUND_MIN,
    });
    closeSettledProvisioningJobs(buckets.close);
    for (const { job, reason } of buckets.hold)
      console.warn(
        `[provision-reconcile] hold job=${job.id} number=${job.numberId} tenant=${job.tenantId} grund=${reason}`,
      );
    redriveProvisioningJobs(buckets.redrive);
  }

  // Minimale oeffentliche Flaeche (G8): nur die 4 extern gerufenen Funktionen.
  return {
    queueProvisioning,
    triggerTenantProvisioning,
    runProvisioningDrainExclusive,
    reconcileOrphanedProvisioning,
  };
}
