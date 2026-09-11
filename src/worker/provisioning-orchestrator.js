// Provisioning-Orchestrator (Server-Slim P6): enqueue/trigger/drain(single-flight)/reconcile
// fuer den Nummern-Kauf. Reine Verschiebung aus server.js. Factory schliesst die injizierten
// Deps; reine Konstanten/Geo-Helfer importiert das Modul selbst (EINE Quelle, G5). INV-7: der
// makeSingleFlight-Guard lebt im Factory-Scope = EIN Drain-Guard pro Prozess (kein Doppelkauf).
// Die Gating-Bedingung `if (config.billing.paymentEnabled)` bleibt beim Aufrufer (runProvisioningDrain-
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
import { PROVISION_REASON } from "../billing/provision-outcome.js";
import { providerErrorDetail } from "../billing/errors.js";
// OUTBOUND-E5 (F3/Nachbesserung Blocker 4+5): EIN Bauplatz fuer das Dreifach-Gate
// (sipRegistrarWennAktiv), nicht zwei - s. runProvisioningDrain.
import { sipRegistrarWennAktiv } from "../elevenlabs/nummern-registrierung.js";

// PROV-402-DIAG: die EINE Diagnose-Zeile eines gescheiterten Provisioning-Laufs - sie geht
// wortgleich ins Log UND in den persistierten provisioning_job.last_error. Modulweit (nicht
// in der Fabrik) definiert: sie haengt an nichts aus dem Closure und die Fabrik ist ohnehin
// zu lang. Hintergrund: bei einem gescheiterten Hold der Nummern-Einrichtungsgebuehr stand
// an beiden Stellen nur "Stripe placeHold fehlgeschlagen: HTTP 402" - ob die Bank ablehnte,
// das Guthaben fehlte, 3-D Secure verlangt war oder die Karte abgelaufen: nicht
// rekonstruierbar, obwohl genau das entscheidet, ob ein Retry helfen kann. Ohne
// Provider-Token bleibt das Suffix leer -> Zeile byte-identisch zum Bestand.
function failureLine(err) {
  return `${err.message}${providerErrorDetail(err)}`;
}

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
  // Job-Spur persistieren, DANN den Provisioning-Job einreihen (geteilt von /api/onboard UND
  // dem Webhook-Aktivierungs-Trigger, G5). Enqueue ist idempotent ueber den number-id-Key;
  // recordProvisioningJob dedupt die Spur. Liefert {ok, jobId} | {ok:false}. Der Aufrufer
  // stoesst den Drain an (Reihenfolge bleibt aufrufer-spezifisch).
  async function queueProvisioning(numberId, tenantId) {
    const idempotencyKey = `provision_${numberId}`;
    // Enqueue erst NACH persistierter Job-Spur (fail-closed, G31): stand das enqueue davor,
    // kaufte ein spaeterer Fremd-Drain (anderer Tenant) den Queue-Job auch bei gescheiterter
    // Persistenz -> eine aktivierte Nummer (echtes Geld) OHNE provisioningJobs-Spur, die
    // reconcileOrphanedProvisioning nie klassifizieren kann. Reihenfolge jetzt strukturell:
    // erst Commit, dann fuer den Drain sichtbar machen.
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
    // GAP-06 (Uhr): die Stripe-Abo-Verlaengerung ist der eine der beiden Ausloeser der
    // DID-Monatsmiete - die Buchung liegt damit auf genau der Periode, fuer die der Kunde
    // zahlt. Dieser Trigger IST der Seam, den applyStripeWebhook im ACTIVATE-Zweig ueber
    // activatePaidTenant ruft (customer.subscription.updated mit status=active); ein
    // eigener Seam durch app.js/web-login/stripe-webhook waere eine zweite Verdrahtung
    // desselben Ereignisses. Idempotent (ein Beleg je Nummer und Monat), also bei
    // Webhook-Retry, .created und beim Operator-Re-Trigger ein No-op. Wirft nie und
    // beeinflusst das Provisioning-Ergebnis NICHT. SEQUENTIELL vor dem withStoreLock -
    // nie darin verschachtelt (Re-Entrancy).
    await settleDueNumberMonthMeters({ tenantId });
    const numberResult = await store
      .withStoreLock(() => {
        const s = store.load();
        // PROV-01/F7: Decision-Core prueft zuerst einen stuck-requested+queued (Crash-Recovery)
        // und faellt sonst unveraendert auf requestNumberForPaidTenant zurueck (G5, EINE Quelle).
        // save bleibt hier (IO, P15). nowMs/maxAgeMs config-frei hineingereicht.
        const r = resolveProvisionRetry(s, {
          tenantId,
          nowMs: Date.now(),
          maxAgeMs: config.provisioning.provisioningRedriveMaxAgeMs,
          fallbackCountry: config.provisioning.provisioningCountry,
          forceNumberCountry: config.provisioning.forceNumberCountry,
          maxNumbers: config.provisioning.maxNumbers,
          maxNumbersPerTenant: config.provisioning.maxNumbersPerTenant,
        });
        // Fix B (G5/S2): dieselbe Persistenz-Entscheidung wie POST /api/onboard. Fuer redrive/
        // needs_manual_reconcile mutiert der Core NICHT; nur der fresh-Pfad (requestNumber) schreibt.
        if (shouldPersistProvisionResult(r)) store.save();
        return r;
      })
      .catch((e) => {
        console.error("[webhook-provision] Persistenz fehlgeschlagen:", e.message);
        return { ok: false, reason: PROVISION_REASON.PERSIST_ERROR };
      });
    if (!numberResult.ok) {
      // already_provisioned ist ein erwarteter idempotenter No-op (Webhook-Retry/Folge-
      // event) - kein Audit-Wert. Jeder andere Grund (tenant_cap/global_cap = Kosten-
      // Notbremse, persist_error, needs_manual_reconcile) ist forensisch relevant: kein Kauf
      // trotz bezahltem Abo -> in den Audit-Trail (Spec BK3: "Limit ueberschritten -> kein Kauf,
      // Audit-Eintrag"). req=null -> audit-util markiert die Quelle als "system" (kein HTTP-
      // Kontext im Webhook-Trigger). Nur die tenantId + Grund-Code, kein Secret/PII (H4).
      if (numberResult.reason !== PROVISION_REASON.ALREADY_PROVISIONED)
        audit("webhook_provision_skipped", null, `tenant=${tenantId} grund=${numberResult.reason}`);
      return { ok: false, reason: numberResult.reason };
    }
    // Beide ok-Faelle liefern eine numberId (redrive: numberResult.numberId; fresh: numberResult.number.id).
    const numberId =
      numberResult.reason === PROVISION_REASON.REDRIVE ? numberResult.numberId : numberResult.number.id;
    // Dry-Run (PROVISIONING_ENABLED=false, P3-Default): Nummer bleibt 'requested', KEIN Kauf/
    // Re-Drive - EINE Stelle fuer beide Pfade (G5, kein doppelter Gate).
    if (!config.provisioning.provisioningEnabled) return { ok: true, reason: PROVISION_REASON.DRY_RUN, numberId };
    // Redrive: KEINE neue Nummer/Job (queueProvisioning), sondern den bestehenden stuck-Job in
    // den single-flight-Drain zurueckgeben (dieselbe numberId/idempotencyKey -> kein Doppelkauf).
    if (numberResult.reason === PROVISION_REASON.REDRIVE) {
      redriveProvisioningJobs([numberResult.job]);
      return { ok: true, reason: PROVISION_REASON.REDRIVE, numberId, jobId: numberResult.jobId };
    }
    const jobRes = await queueProvisioning(numberId, tenantId);
    if (!jobRes.ok) return { ok: false, reason: PROVISION_REASON.PERSIST_ERROR };
    void runProvisioningDrainExclusive();
    return { ok: true, reason: PROVISION_REASON.QUEUED, numberId, jobId: jobRes.jobId };
  }

  // Verarbeitet wartende provision_number-Jobs deterministisch (In-Memory-Drain).
  // Baut deps (provisioner + optional Stripe-Billing bei PAYMENT_ENABLED) genau wie
  // der frueher synchrone Onboard-Pfad. KEIN active ohne Capture / Rollback liegen in
  // provisionNumber. Persistiert nach jedem Job (Worker selbst ist save-frei, reine Fn).
  async function runProvisioningDrain() {
    const s = store.load();
    const deps = { provisioner: numberProvisioning(PROVIDER.TELNYX) };
    // OUTBOUND-E5 (F3/Nachbesserung Blocker 4+5): der Registrar ist der EINZIGE neue
    // Anbieter-SCHREIBZUGRIFF dieser Etappe. Das Dreifach-Gate (PROVISIONING_ENABLED plus
    // die zwei EL-Riegel) beantwortet NUR sipRegistrarWennAktiv - hier NICHT noch einmal
    // inline nachbauen, sonst pruefen die vier Gate-Tests in
    // test/e5-01-sipregistrar-produktionspfad.test.js eine Funktion, die der Produktionspfad
    // gar nicht ruft.
    deps.sipRegistrar = sipRegistrarWennAktiv(config);
    // Geld-/Zahlungs-Optionen sind land-unabhaengig (global). Die Suchparameter
    // (countryCode/connectionId) werden PRO JOB aus dem Number-Record abgeleitet
    // (P7, Geo-Provisioning) - nicht mehr global aus config.provisioning.provisioningCountry.
    const moneyOpts = {};
    if (config.billing.paymentEnabled) {
      deps.billing = billing;
      moneyOpts.holdAmountCents = config.billing.numberSetupFeeCents;
      moneyOpts.currency = config.billing.paymentCurrency;
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
        // number_month-Meter (P6b3, Meter 1): NUR wenn eine Nummer NEU aktiviert wurde
        // (r.number, nicht skipped) UND im Metering-Pfad - der Beleg der ERSTEN Periode.
        // Die Folgemonate bucht settleDueNumberMonthMeters (GAP-06); weil dieser Beleg
        // numberId + Monat traegt, sieht der wiederkehrende Pfad ihn und bucht denselben
        // Monat NICHT erneut. costCents = die Monatsmiete aus dem Nummern-Datensatz (P4).
        if (config.billing.paymentEnabled)
          metering.recordNumberMonthMeter(r.number, new Date().toISOString());
        store.save();
        return r;
      } catch (err) {
        // PROV-402-DIAG: dieselbe Diagnose-Zeile in den persistierten last_error UND ins
        // Log (failureLine, EINE Quelle - s. dort, warum das noetig wurde).
        if (record) markProvisioningJob(s, record.id, PROVISIONING_JOB_STATUS.FAILED, failureLine(err));
        store.save(); // 'failed'-Number + Job persistieren
        console.error("[provision-worker]", failureLine(err));
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

  // GAP-06 (Miete, wiederkehrend): bucht die offenen DID-Monatsmieten. ZWEI Ausloeser
  // teilen sich diese EINE Funktion (Owner-Vorgabe 2026-07-27): die Stripe-Abo-
  // Verlaengerung (tenantId gesetzt, ueber triggerTenantProvisioning) und ein Schritt im
  // bestehenden stuendlichen Sweep (tenantId null = alle Tenants, boot.js) - KEIN Cron,
  // KEIN neuer Endpunkt, KEINE neue Ressource. Hier liegt - wie beim Aktivierungs-Beleg
  // im Drain - das paymentEnabled-Gate (INV-9: das Metering-Modul bucht ungated, der
  // Aufrufer gated). Kurzer Schreibabschnitt unter withStoreLock OHNE Netz-IO (Muster
  // queueProvisioning). WIRFT NIE: der stuendliche Sweep darf daran nicht scheitern.
  // EINE Log-Zeile, und nur wenn ueberhaupt etwas faellig war - eine stuendlich
  // identische Zeile ist Rauschen, kein Betrieb. PII-frei (Zahlen, keine e164).
  // Nebeneffekt (Ledger-Schreibung) im Namen (N7).
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

  // Minimale oeffentliche Flaeche (G8): nur die extern gerufenen Funktionen.
  return {
    queueProvisioning,
    triggerTenantProvisioning,
    runProvisioningDrainExclusive,
    reconcileOrphanedProvisioning,
    settleDueNumberMonthMeters,
  };
}
