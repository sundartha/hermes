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

// Ein Lauf. apply=false (Default) = reiner Trockenlauf: es wird gefragt und berichtet,
// aber NICHTS geschrieben. Wirft NIE pro Mandant (ein unerreichbares Stripe darf den
// Lauf nicht reissen). Liefert einen PII-freien Report: interne Mandanten-Kennung und
// der Typ-Enum, NIE die Zahlungsmittel-Referenz und nie Kundendaten. Nebeneffekt
// (Store-Schreibung) NUR bei apply -> N7.
export async function reconcilePaymentMethodTypes({ store, billing, apply = false, logger = console }) {
  const candidates = tenantsForPaymentMethodTypeReconcile(store.load());
  const report = { apply, scanned: candidates.length, filled: [], unknown: [], errors: [] };
  for (const tenant of candidates) {
    let paymentMethodType;
    try {
      paymentMethodType = await billing.retrievePaymentMethodType(tenant.stripePaymentMethodId);
    } catch (err) {
      // PII-/Key-frei (Regel 4): interne Kennung + Adapter-Meldung (die traegt Operation
      // und Status, nie den Stripe-Schluessel und nie Kundendaten).
      logger.warn(`[pm-type] Typ-Abfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
      report.errors.push({ id: tenant.id, reason: PM_TYPE_OUTCOME.LOOKUP_FAILED });
      continue;
    }
    if (typeof paymentMethodType !== "string" || !paymentMethodType) {
      report.unknown.push({ id: tenant.id, reason: PM_TYPE_OUTCOME.UNKNOWN });
      continue;
    }
    report.filled.push({ id: tenant.id, paymentMethodType });
    // NUR den Typ nachtragen: paymentMethodId unveraendert mitgeben (die Bindung selbst
    // ist in Ordnung), customerId gar nicht (bindPaymentMethodOnTenant laesst ein
    // fehlendes customerId unberuehrt) - dieser Lauf korrigiert EIN Feld.
    if (apply)
      bindPaymentMethodOnTenant(store, tenant.id, {
        paymentMethodId: tenant.stripePaymentMethodId,
        paymentMethodType,
      });
  }
  return report;
}
