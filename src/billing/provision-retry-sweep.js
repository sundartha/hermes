// GP-P4 (PLAN-GELDPFAD.md 2, "Zeitgesteuerter Wiederanlauf"): der zweite Ausloeser des
// automatischen Nummern-Wiederanlaufs. GP-P3 stoesst nur nach einem Kartenwechsel an -
// einem MENSCHLICHEN Ereignis. Bleibt es aus, haengt der zahlende Mandant unbegrenzt auf
// 'failed' (Vorfall 11.09.2026), denn fuer terminal gescheiterte Nummern gab es gar
// keinen Zweig: PROVISIONING_REDRIVE_MAX_AGE_MS deckt offene Jobs ab und steht ausserdem
// auf 0 (Observe-Only). Dieser Zweig schliesst genau diese Luecke, zeitgesteuert.
//
// KEIN zweiter Entscheidungskern (G5/S2): ob ein Mandant angestossen wird, entscheidet
// AUSSCHLIESSLICH der geteilte Kern (provision-retry.js resolveAutoProvisionRetry) -
// Not-Aus, 'failed'-Zustand, Abo+KYC, Eignung der Zahlungsmethode, Versuchsdeckel. Dieses
// Modul steuert nur den TAKT bei: die Mandanten-Schleife und die Mindestfrist.
//
// Strukturell vs. temporaer haengt am PERSISTIERTEN Typ-Gate (GP-P2,
// tenant.stripePaymentMethodType -> isHoldCapablePaymentMethodType), NICHT an einem
// Freitext: eine nicht hold-faehige Methode ist strukturell und wird nie angestossen; ein
// Scheitern trotz hold-faehiger Methode gilt als temporaer. Der getypte Ablehnungsgrund
// aus GP-P1 haengt an einem FEHLEROBJEKT und ist zur Sweep-Zeit nicht mehr da - hier wird
// bewusst keine Fehlermeldung geparst (GP-P1-Struktur-Waechter).
//
// Der Entprell-Marker ist ein reiner ZEITANKER (Muster outbound-drift-watch.js LAUF_MARKER
// "drift:lauf"), KEIN Befund: er wird nie geschlossen und bedeutet nie "hier ist etwas
// kaputt" - er haelt nur fest, wann dieser Mandant zuletzt automatisch angestossen wurde.
import * as ops from "../store/state-ops.js";
import { PROVISION_RETRY_OUTCOME, retriggerFailedProvisioning } from "./provision-retry.js";

const FRIST_BUCKET_PREFIX = "provision-retry:";
const SWEEP_EVENT = "provision_retry_sweep";
const LOG_PREFIX = "[provision-retry-sweep]";

// EXPORTIERT, weil der Marker-Code ein durabler Vertrag ist (outage_alert.code): eine
// zweite, anderswo getippte Zusammensetzung koennte abdriften, ohne dass ein Test es
// merkt (G5, Muster paid-without-number-watch.js#paidWithoutNumberBucket).
export const provisionRetryBucket = (tenantId) => `${FRIST_BUCKET_PREFIX}${tenantId}`;

// Ausgang -> Zaehlername der Umfangs-Zeile. EIN Dispatch-Table statt verstreuter ifs
// (G23); jeder andere Ausgang zaehlt nur in "geprueft" mit.
const ZAEHLER_JE_AUSGANG = Object.freeze({
  [PROVISION_RETRY_OUTCOME.RETRY]: "angestossen",
  [PROVISION_RETRY_OUTCOME.THROTTLED]: "gedrosselt",
  [PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED]: "erschoepft",
  // GP-P2-Nachtrag: dieser Ausgang ist KEIN Rauschen. Er liegt HINTER dem 'failed'-Gate
  // und hinter dem Abo-/KYC-Gate - wer ihn erreicht, ist ein ZAHLENDER Mandant ohne
  // Nummer, dessen Zahlungsmethode keinen Hold traegt. Der Wiederanlauf wird ihn nie
  // anstossen, und zwar dauerhaft: es gibt keinen Versuchszaehler, der irgendwann
  // ueberlaeuft und den Handbetrieb meldet. Ohne diese Zahl bleibt genau die Population
  // unsichtbar, fuer die der Sweep gebaut wurde - belegt am 15.09.2026, als der Mandant
  // aus dem Vorfall vom 11.09. seit dem Deploy in JEDEM Lauf lautlos abgewiesen wurde.
  [PROVISION_RETRY_OUTCOME.PAYMENT_METHOD_UNSUITABLE]: "ungeeignet",
});

// Nur diese beiden Ausgaenge bekommen eine durable Audit-Zeile: ein echter Kaufanstoss und
// der terminale Uebergang in den Handbetrieb. Alles andere waere stuendliches Rauschen
// ueber die schweigende Mehrheit (jeder Mandant ohne 'failed'-Nummer).
const AUDIT_AUSGAENGE = new Set([
  PROVISION_RETRY_OUTCOME.RETRY,
  PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED,
]);

// REIN: liest den Entprell-Marker, mutiert nicht, kein Date.now (nowMs injiziert).
// Kein Marker / kein lastSeenAt -> faellig (dieser Mandant wurde nie automatisch
// angestossen). Unlesbarer Zeitanker -> NICHT faellig (fail-closed, Muster der
// NaN-Wachen in paidWithoutNumberCandidates): ein kaputter Anker kauft nichts.
export function provisionRetryDue(state, { tenantId, nowMs, minIntervalMs }) {
  const marker = ops.openOutageAlert(state, provisionRetryBucket(tenantId));
  if (!marker || !marker.lastSeenAt) return true;
  const letzteMs = Date.parse(marker.lastSeenAt);
  if (Number.isNaN(letzteMs)) return false;
  return nowMs - letzteMs >= minIntervalMs;
}

// Faelligkeits-Urteil UND Reservierung ATOMAR im SELBEN Lock (Muster
// outbound-drift-watch.js#beanspruchen): ein Deploy-Sturm mit zwei parallelen Sweeps
// darf nicht zweimal kaufen. Kein Netz-await im Lock; das Lock von
// triggerTenantProvisioning wird NICHT verschachtelt (der Anstoss laeuft danach).
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

// REIN: verdichtet die Ausgaenge eines Laufs zur Umfangs-Zeile. Eigener lokaler Zaehler
// statt einer Mutation von aussen - die Schleife sammelt nur, verdichtet wird einmal.
function zaehleAusgaenge(ausgaenge) {
  const zaehler = { angestossen: 0, gedrosselt: 0, erschoepft: 0, ungeeignet: 0 };
  for (const outcome of ausgaenge) {
    const name = ZAEHLER_JE_AUSGANG[outcome];
    if (name) zaehler[name] += 1;
  }
  return zaehler;
}

// PII-frei (Regel 4/10): interne Mandanten-Kennung, Enum, Zahl - keine e164, kein Name,
// keine Stripe-Referenz.
function meldeAusgang({ audit, tenantId, entscheidung }) {
  if (!AUDIT_AUSGAENGE.has(entscheidung.outcome)) return;
  audit(SWEEP_EVENT, null, `tenant=${tenantId} ausgang=${entscheidung.outcome} versuche=${entscheidung.attempts}`);
}

// Fail-soft wie jeder andere Sweep-Zweig: ein Fehler HIER darf den Stunden-Sweep nie
// abbrechen. nowMs injizierbar (Muster runPaidWithoutNumberSweep). minIntervalMs <= 0
// haelt den ZEITGESTEUERTEN Zweig komplett aus (Rollback-Hebel, Muster
// outboundDriftMinIntervalMs); der Wiederanlauf nach Kartenwechsel bleibt unberuehrt.
export async function runProvisionRetrySweep({ store, config, provision, audit, nowMs = Date.now() }) {
  try {
    const minIntervalMs = config.provisioning.provisioningRetryMinIntervalMs;
    if (minIntervalMs <= 0) return;
    const maxAttempts = config.provisioning.provisioningRetryMaxAttempts;
    const tenantIds = ops.allTenantIds(store.load());
    const ausgaenge = [];
    for (const tenantId of tenantIds) {
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
    // Umfangs-Zeile IMMER (Lehre pruefkommando-ohne-positiv-kontrolle): ein Zweig, der
    // nichts anstoesst, muss von einem, der gar nicht laeuft, unterscheidbar bleiben.
    console.log(
      `${LOG_PREFIX} geprueft=${tenantIds.length} angestossen=${zaehler.angestossen} ` +
        `gedrosselt=${zaehler.gedrosselt} erschoepft=${zaehler.erschoepft} ungeeignet=${zaehler.ungeeignet}`,
    );
  } catch (err) {
    console.error(LOG_PREFIX, err.message);
  }
}

// Fabrik (Muster makePaidWithoutNumberWatch): EINMAL beim Boot verdrahtet (INV-7).
export function makeProvisionRetryWatch({ store, config, provision, audit }) {
  return { runProvisionRetrySweep: () => runProvisionRetrySweep({ store, config, provision, audit }) };
}
