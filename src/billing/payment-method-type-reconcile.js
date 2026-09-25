// GP-P2-Nachtrag: Bestandsheiler fuer den FEHLENDEN Typ der Zahlungsmethode.
//
// GP-P2 hat tenant.stripePaymentMethodType additiv eingefuehrt und bewusst keinen
// Backfill gefahren. Fuer die ANZEIGE waere das folgenlos - fuer die STEUERUNG ist es
// das nicht: isHoldCapablePaymentMethodType ist fail-closed, null gilt als ungeeignet.
// Der automatische Wiederanlauf (resolveAutoProvisionRetry, GP-P3/GP-P4) ueberspringt
// damit dauerhaft und lautlos genau die Mandanten, fuer die er gebaut wurde - jeden,
// der seine Zahlungsmethode VOR GP-P2 gebunden hat. Belegt am Produktionsbestand
// (2026-09-15): der Mandant aus dem Vorfall vom 11.09. traegt null und wird seit dem
// Deploy in jedem Stunden-Sweep als PAYMENT_METHOD_UNSUITABLE abgewiesen.
//
// Dieser Lauf fragt den Typ AKTIV bei Stripe nach, statt ihn aus dem lokalen Zustand zu
// raten - dasselbe Muster wie stale-subscription-reconcile.js (Lehre aus CL2: "tot oder
// lebendig beantwortet nur eine Rueckfrage beim Anbieter").
//
// FAIL-CLOSED IN JEDE RICHTUNG. Geschrieben wird NUR ein nicht-leerer Typ-String aus
// einer erfolgreichen Antwort:
//   - API-/Netzfehler -> unveraendert (der naechste Lauf fragt erneut),
//   - Antwort ohne verwertbaren Typ -> unveraendert (unbekannt bleibt unbekannt).
// Ein geratener Typ waere die teuerste Fehlentscheidung dieses Bausteins: ein
// faelschlich als 'card' eingetragenes Wallet liesse den Wiederanlauf einen Hold
// versuchen, der strukturell nie gelingen kann - drei Versuche, dann Handbetrieb.
//
// Muster stale-subscription-reconcile.js: testbarer Kern (DIP, alle IO-Seams injiziert),
// Dry-Run als Default, PII-freier Report; das Skript daneben
// (scripts/reconcile-payment-method-types.js) ist nur Verdrahtung. Geschrieben wird ueber
// DIESELBE Stelle wie jeder andere Bindepfad (bindPaymentMethodOnTenant, G5) - keine
// zweite Schreiblogik, die den Typ anders behandeln koennte als die Karten-Rueckkehr.
import { bindPaymentMethodOnTenant } from "./card-setup.js";
import { tenantsForPaymentMethodTypeReconcile } from "../store/state-ops.js";

// Report-Gruende (kein Magic-String, G25). Muster STALE_SUB_OUTCOME.
export const PM_TYPE_OUTCOME = Object.freeze({
  FILLED: "filled", // Stripe nennt einen Typ -> nachgetragen (nur bei apply)
  UNKNOWN: "unknown", // Antwort ohne verwertbaren Typ -> unveraendert (fail-closed)
  LOOKUP_FAILED: "lookup_failed", // Stripe unerreichbar/Fehler -> unveraendert (fail-closed)
});

// Die EINE Lookup-und-Schreib-Regel fuer einen Mandanten (G5). Zwei Aufrufer teilen sie:
// der Stapellauf unten (Ops, auf Kommando) und der Stunden-Sweep (provision-retry-sweep.js),
// der einen unbekannten Typ selbst aufloest, BEVOR er ueber den Wiederanlauf entscheidet -
// sonst haenge die Heilung des Bestands an einem Skript, das jemand ausfuehren muss.
// Wirft NIE: ein unerreichbares Stripe darf weder den Stapellauf reissen noch den Sweep.
// Liefert { outcome, paymentMethodType } - PII-frei (Enum + Typ-Enum, nie die Referenz).
// Nebeneffekt (Store-Schreibung) NUR bei apply -> N7.
export async function fillPaymentMethodType({ store, billing, tenant, apply = false, logger = console }) {
  let paymentMethodType;
  try {
    paymentMethodType = await billing.retrievePaymentMethodType(tenant.stripePaymentMethodId);
  } catch (err) {
    // PII-/Key-frei (Regel 4): interne Kennung + Adapter-Meldung (die traegt Operation
    // und Status, nie den Stripe-Schluessel und nie Kundendaten).
    logger.warn(`[pm-type] Typ-Abfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
    return { outcome: PM_TYPE_OUTCOME.LOOKUP_FAILED, paymentMethodType: null };
  }
  if (typeof paymentMethodType !== "string" || !paymentMethodType)
    return { outcome: PM_TYPE_OUTCOME.UNKNOWN, paymentMethodType: null };
  // NUR den Typ nachtragen: paymentMethodId unveraendert mitgeben (die Bindung selbst
  // ist in Ordnung), customerId gar nicht (bindPaymentMethodOnTenant laesst ein
  // fehlendes customerId unberuehrt) - hier wird EIN Feld korrigiert.
  if (apply)
    bindPaymentMethodOnTenant(store, tenant.id, {
      paymentMethodId: tenant.stripePaymentMethodId,
      paymentMethodType,
    });
  return { outcome: PM_TYPE_OUTCOME.FILLED, paymentMethodType };
}

// Der Stapellauf (Ops, auf Kommando). apply=false (Default) = reiner Trockenlauf: es wird
// gefragt und berichtet, aber NICHTS geschrieben. Liefert einen PII-freien Report.
// Bleibt bestehen, obwohl der Sweep inzwischen selbst heilt: er erlaubt den bewussten,
// sofortigen Durchlauf ueber den ganzen Bestand (Trockenlauf zuerst), statt bis zum
// naechsten Takt zu warten - und deckt Mandanten ab, die gar nicht auf 'failed' stehen.
export async function reconcilePaymentMethodTypes({ store, billing, apply = false, logger = console }) {
  const candidates = tenantsForPaymentMethodTypeReconcile(store.load());
  const report = { apply, scanned: candidates.length, filled: [], unknown: [], errors: [] };
  for (const tenant of candidates) {
    const { outcome, paymentMethodType } = await fillPaymentMethodType({
      store,
      billing,
      tenant,
      apply,
      logger,
    });
    if (outcome === PM_TYPE_OUTCOME.LOOKUP_FAILED) report.errors.push({ id: tenant.id, reason: outcome });
    else if (outcome === PM_TYPE_OUTCOME.UNKNOWN) report.unknown.push({ id: tenant.id, reason: outcome });
    else report.filled.push({ id: tenant.id, paymentMethodType });
  }
  return report;
}
