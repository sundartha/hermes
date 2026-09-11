// GP-P3 (PLAN-GELDPFAD.md 2): Wiederanlauf des Nummern-Provisionings nach einem
// Kartenwechsel - und der Deckel, ohne den er ein Kostenvektor waere.
//
// Vorfall 11.09.2026: eine Zahlungsmethode, die keinen Hold traegt, laesst das
// Nummern-Setup terminal auf 'failed' laufen. Der Kunde zahlt, hat aber keine Nummer.
// Die eine Handlung, die daran etwas aendert, ist ein Kartenwechsel - danach muss das
// Provisioning von SELBST wieder anlaufen, sonst bleibt der Kunde haengen.
//
// E1: der Versuchszaehler IST die Anzahl der terminal 'failed' Nummern-Datensaetze des
// Mandanten (state-ops failedNumberCount) - keine zweite Buchfuehrung ueber dieselbe
// Tatsache (G5). Jeder Neuanlauf legt eine NEUE numberId mit frischen Idempotenz-
// Schluesseln an, und occupiesCapacity zaehlt 'failed' nicht, also greift
// MAX_NUMBERS_PER_TENANT an dieser Achse strukturell nie.
// E3: der Deckel gilt AUSSCHLIESSLICH an diesem automatischen Anstoss - nicht am
// Admin-Retry (POST /api/onboard/retry) und nicht am Webhook-Aktivierungspfad.
// needs_manual_reconcile heisst Handbetrieb; ein Deckel, der auch den sperrt, haette
// keinen Ausweg.
// E5: fail-soft. Die Karte ist zum Zeitpunkt des Aufrufs bereits gebunden und
// persistiert - ein Wurf von hier wuerde dem Kunden faelschlich "Karte nicht
// hinterlegt" zeigen. Diese Funktion wirft deshalb NIE.
// E6: maxAttempts === 0 heisst "automatischer Wiederanlauf komplett AUS" (Rollback-
// Hebel, Muster PROVISIONING_REDRIVE_MAX_AGE_MS=0), ausdruecklich NICHT "sofort
// erschoepft" - sonst markierte der Hebel jeden Kartenwechsel als reparaturbeduerftig.
import { KYC_OUTBOUND_MIN } from "../store/defaults.js";
import {
  failedNumberCount,
  markTenantNeedsManualReconcile,
  tenantActiveSubscriber,
  tenantStripe,
} from "../store/state-ops.js";
import { NUMBER_DISPLAY_STATUS, numberStatusFor } from "../store/views.js";
import { isHoldCapablePaymentMethodType } from "./payment-method-eligibility.js";

// Die Ergebnisse der Entscheidung als Enum (G25/G11): der Audit-Text der Route liest
// sie, die Tests pinnen sie - kein verstreutes String-Literal.
export const PROVISION_RETRY_OUTCOME = Object.freeze({
  RETRY: "retry",
  DISABLED: "disabled",
  NOT_FAILED: "not_failed",
  NO_ACTIVE_SUBSCRIPTION: "no_active_subscription",
  PAYMENT_METHOD_UNSUITABLE: "payment_method_unsuitable",
  ATTEMPTS_EXHAUSTED: "attempts_exhausted",
  ERROR: "error",
});

// Kein Wiederanlauf, kein verbrannter Versuch: die abweisenden Zweige melden den
// Zaehler als 0, weil sie ihn gar nicht erst lesen (die Frage stellt sich dort nicht).
const NO_RETRY_ATTEMPTS = 0;

// REIN: liest state, mutiert nicht, kein IO, kein Date.now (Muster resolveProvisionRetry).
// Die Reihenfolge ist fail-closed und nicht beliebig: erst der Not-Aus, dann "gibt es
// ueberhaupt etwas zu reparieren", dann das Geld-Gate, dann die Eignung der frisch
// gebundenen Methode, zuletzt der Deckel.
// Pre-Mortem 1: eine hold-UNFAEHIGE Methode loest gar keinen Anstoss aus und verbrennt
// deshalb auch keinen Versuch - sonst haette ein Link-Zahler mit drei Klicks seinen
// Deckel weggeworfen, ohne dass je ein Kauf moeglich gewesen waere.
// Pre-Mortem 2: diese Route wird mit dem Anstoss geldbewegend und traegt das Abo-/KYC-
// Gate deshalb SELBST - provision-trigger.js sagt ausdruecklich, dass es beim Aufrufer
// liegt und dort nicht dupliziert ist.
export function resolveCardRebindRetry(state, { tenantId, maxAttempts, kycMinLevel = KYC_OUTBOUND_MIN }) {
  if (maxAttempts <= 0)
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.DISABLED, attempts: NO_RETRY_ATTEMPTS };
  if (numberStatusFor(state, tenantId) !== NUMBER_DISPLAY_STATUS.FAILED)
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.NOT_FAILED, attempts: NO_RETRY_ATTEMPTS };
  if (!tenantActiveSubscriber(state, tenantId, kycMinLevel))
    return {
      retry: false,
      outcome: PROVISION_RETRY_OUTCOME.NO_ACTIVE_SUBSCRIPTION,
      attempts: NO_RETRY_ATTEMPTS,
    };
  if (!isHoldCapablePaymentMethodType(tenantStripe(state, tenantId).paymentMethodType))
    return {
      retry: false,
      outcome: PROVISION_RETRY_OUTCOME.PAYMENT_METHOD_UNSUITABLE,
      attempts: NO_RETRY_ATTEMPTS,
    };
  const attempts = failedNumberCount(state, tenantId);
  if (attempts >= maxAttempts)
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED, attempts };
  return { retry: true, outcome: PROVISION_RETRY_OUTCOME.RETRY, attempts };
}

// Kurzer Schreibabschnitt unter withStoreLock OHNE Netz-await (Muster queueProvisioning).
async function markExhausted({ store, tenantId }) {
  await store.withStoreLock(() => {
    const state = store.load();
    if (markTenantNeedsManualReconcile(state, tenantId).changed) store.save();
  });
}

// Unrein: Marker schreiben + den BESTEHENDEN Anstoss rufen. Kein zweiter Kaufpfad, keine
// Kopie des Hold-vor-Order-Kerns - provision ist triggerTenantProvisioning, injiziert.
// WIRFT NIE (E5): die Karte ist bereits gebunden, ein Fehlschlag hier darf daraus nie
// "Karte fehlgeschlagen" machen.
export async function retriggerProvisioningAfterCardBind({ store, provision, tenantId, maxAttempts }) {
  try {
    const decision = resolveCardRebindRetry(store.load(), { tenantId, maxAttempts });
    if (decision.outcome === PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED)
      await markExhausted({ store, tenantId });
    if (decision.retry) await provision(tenantId);
    return decision;
  } catch (err) {
    // PII-/secret-frei: nur die Fehlermeldung, kein Tenant-Datum, keine Stripe-Referenz.
    console.error("[provision-retry]", err.message);
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.ERROR, attempts: NO_RETRY_ATTEMPTS };
  }
}
