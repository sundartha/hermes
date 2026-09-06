// CL1-B3: Bestandsheiler fuer TOTE Stripe-Abo-Referenzen. Der Code-Fix (B1/B2) wirkt
// nur auf kuenftige Ereignisse; Datensaetze, die den Aussperrungs-Zustand bereits
// tragen (status != active PLUS gesetzte stripeSubscriptionId), heilt niemand von
// selbst. Dieser Lauf fragt fuer jeden Kandidaten AKTIV bei Stripe nach und entwertet
// die Referenz NUR, wenn Stripe das Abo als beendet meldet.
//
// KEIN BLIND-UPDATE (die teuerste Fehlentscheidung dieses Bausteins): verloere ein
// Tenant mit LEBENDEM Abo seine Referenz, buchte Stripe weiter ab, waehrend Kuendigen
// und Resume unmoeglich wuerden. Deshalb fail-closed in jede Richtung: unbekannter/
// fehlender Status, jeder andere Status und JEDER API-/Netzfehler lassen den Tenant
// unveraendert (der naechste Lauf prueft erneut).
//
// Muster backfill-profiles.js: testbarer Kern (DIP, alle IO-Seams injiziert), Dry-Run
// als Default, strukturierter Report; das Skript daneben (scripts/reconcile-stale-
// subscriptions.js) ist nur Verdrahtung. Schreibt ueber DIESELBE Stelle wie der
// Webhook-Zweig (clearSubscriptionReference, G5) - keine zweite Entwertungs-Logik,
// die driften koennte.
import { clearSubscriptionReference } from "./subscribe.js";
import { tenantsForStaleSubscriptionReconcile } from "../store/state-ops.js";

// Stripe-Status, die eine TOTE Referenz beweisen (kein Magic-String, G25).
// Bewusst eine ANDERE Menge als HEALING_STRIPE_STATUS in stripe-reconcile.js: dort
// geht es ums SPERREN (ein nie bestaetigtes incomplete_expired hat nie ein Gate
// geoeffnet, ein Fehl-Suspend waere teuer), hier nur um die Frage, ob die gespeicherte
// Referenz noch etwas bezeichnet - und ein incomplete_expired bezeichnet nichts mehr.
const DEAD_SUBSCRIPTION_STATUS = Object.freeze(new Set(["canceled", "incomplete_expired"]));

// Report-Gruende (kein Magic-String, G25).
export const STALE_SUB_OUTCOME = Object.freeze({
  CLEARED: "cleared", // Stripe meldet beendet -> Referenz entwertet (nur bei apply)
  ALIVE: "alive", // Stripe meldet ein lebendes/unklares Abo -> unveraendert
  LOOKUP_FAILED: "lookup_failed", // Stripe unerreichbar/Fehler -> unveraendert (fail-closed)
});

// Ein Lauf. apply=false (Default) = reiner Trockenlauf: es wird gefragt und berichtet,
// aber NICHTS geschrieben. Wirft NIE pro Tenant (ein unerreichbares Stripe darf den
// Lauf nicht reissen). Liefert einen PII-freien Report (nur interne Tenant-ids + der
// opake Stripe-Status). Nebeneffekt (Store-Schreibung) NUR bei apply -> N7.
export async function reconcileStaleSubscriptions({ store, billing, apply = false, logger = console }) {
  const candidates = tenantsForStaleSubscriptionReconcile(store.load());
  const report = { apply, scanned: candidates.length, cleared: [], alive: [], errors: [] };
  for (const tenant of candidates) {
    let status;
    try {
      ({ status } = await billing.retrieveSubscription(tenant.stripeSubscriptionId));
    } catch (err) {
      // PII-/Key-frei (Regel 4): interne Tenant-id + Adapter-Meldung (die traegt
      // Status+Operation, nie den Stripe-Key oder Kundendaten).
      logger.warn(`[stale-subs] Statusabfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
      report.errors.push({ id: tenant.id, reason: STALE_SUB_OUTCOME.LOOKUP_FAILED });
      continue;
    }
    if (!DEAD_SUBSCRIPTION_STATUS.has(status)) {
      report.alive.push({ id: tenant.id, status: status ?? null });
      continue;
    }
    report.cleared.push({ id: tenant.id, status });
    if (apply) clearSubscriptionReference(store, tenant.id);
  }
  return report;
}
