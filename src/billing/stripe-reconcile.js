// Stripe-Abgleich-Sweep: heilt VERLORENE Stripe-Webhooks (Betreiber-Befund 2026-08-13,
// Stripe-Dashboard "Alle Zustellungsversuche sind fehlgeschlagen"). Auf dem kostenlosen
// Render-Plan schlaeft der Dienst nach 15 min; das Aufwachen (30-60 s) dauert laenger als
// Stripes Webhook-Timeout - trifft JEDER Retry-Versuch (Stripe: ~3 Tage, dann endgueltig
// aufgegeben) einen schlafenden Dienst, ist das Event fuer immer weg. Ein verlorenes
// customer.subscription.deleted ist der teuerste Fall: der Kunde wird nie gesperrt
// (telefoniert gratis weiter), die Telnyx-Nummer wird nie freigegeben (kostet weiter).
//
// Heilung ueber EINE Quelle (G5): der Sweep fragt Stripe AKTIV (billing.retrieve-
// Subscription -> status) und speist bei status="canceled" ein synthetisches
// customer.subscription.deleted-Event in applyStripeWebhookSerialized ein - EXAKT den
// Pfad, den das echte Webhook-Event genommen haette (Suspend + Session-Invalidierung +
// Vertragsende-Aufraeumen nach Kuendigung, inkl. Ordnungswache/Mutex). KEINE zweite
// Suspend-Implementierung, die driften koennte. Die Signaturpruefung des Route-Layers
// wird dabei nicht umgangen, sondern ERSETZT durch etwas Staerkeres: die Antwort kommt
// aus einem selbst initiierten, authentifizierten GET an die Stripe-API - nicht aus
// einem hereingereichten Request.
//
// Ordnungswache-Vertraeglichkeit: "canceled" ist bei Stripe TERMINAL (ein beendetes Abo
// kann nicht reaktiviert werden; eine Rueckkehr des Kunden erzeugt eine NEUE Subscription
// mit neuer sub_-id = eigener Korrelationsschluessel). Ein synthetisches DELETED mit
// created=jetzt kann daher nie ein legitimes spaeteres ACTIVATE desselben Abos verdraengen.
//
// Fail-closed in jeder Richtung: nur der EINE Stripe-Status "canceled" heilt; jeder
// andere Status (active/trialing/past_due/...), status=null (Feld fehlt) und jeder
// API-/Netzfehler fuehren zu KEINER Mutation (naechster Lauf prueft erneut). Die
// Kuendigung-vs-Zahlungsausfall-Unterscheidung bleibt unveraendert im SUSPEND-Zweig
// (billing/webhook.js liest cancelAtPeriodEnd VOR jeder Mutation) - der Sweep trifft
// diese Entscheidung NICHT selbst.
//
// Muster runReleaseReconcile (release-reconcile.js): EIN Selektor (tenantsForStripe-
// Reconcile, state-ops.js - reiner Kern) + EIN Executor, Boot-Lauf + Sweep-Intervall
// (wiring/web-login.js), alle IO injiziert (store/billing/Webhook-Deps/logger), nowMs
// als Argument -> testbar/repeatable (F.I.R.S.T.), kein Date.now im Kern. Idempotent:
// der Suspend stempelt suspendedAt, damit faellt der Tenant aus dem Selektor.
import { applyStripeWebhookSerialized, SUBSCRIPTION_EVENT } from "./webhook.js";
import { tenantsForStripeReconcile } from "../store/state-ops.js";

// Der EINE Stripe-Status, der heilt (kein Magic-String, G25). BEWUSST nicht auch
// incomplete_expired: ein nie bestaetigtes Abo hat das Aktivierungs-Gate nie geoeffnet
// (CONFIRMED_SUBSCRIPTION_STATUS, webhook.js) - dort gibt es nichts zu sperren, und ein
// Fehl-Suspend eines legitimen Tenants waere teurer als ein ausgelassener Randfall.
const HEALING_STRIPE_STATUS = "canceled";

// Synthetisches customer.subscription.deleted in der Form, die interpretStripeEvent
// (webhook.js DELETED-Zweig) liest: object.id -> subscriptionId-Korrelation,
// metadata.tenant_ref -> direkte Tenant-Aufloesung (beide gesetzt - doppelter Anker,
// Muster createSubscription-Metadata). id ist eindeutig (Dedup der Ordnungswache greift
// pro Lauf), created=nowMs in Stripe-Sekunden (Ordnungswache vergleicht Sekunden).
// Exportiert fuer den Test (der Vertrag dieser Form IST der Vertrag mit webhook.js).
export function syntheticSubscriptionDeletedEvent({ tenantId, subscriptionId, nowMs }) {
  return {
    id: `evt_reconcile_${tenantId}_${nowMs}`,
    created: Math.floor(nowMs / 1000),
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subscriptionId, metadata: { tenant_ref: tenantId } } },
  };
}

// Ein Sweep-Lauf. webhookDeps = EXAKT die Deps, die auch die Webhook-Route an
// applyStripeWebhookSerialized reicht (store/accounts/sessions/audit/provision/billing/
// numberProvisioner/workos/auditStore - EINE Quelle, kein Drift; req fehlt bewusst ->
// audit() loggt ip=system, Muster TTS_QUOTA_WARN_EVENT in server.js). Liefert
// {checked, healed, errors} fuer Log/Observability. Wirft NIE pro Tenant (ein
// unerreichbares Stripe darf den Sweep-Timer nicht reissen); der Aufrufer (wiring)
// haengt zusaetzlich seinen catch-Riegel an (Muster scheduleContractEndCleanup).
export async function runStripeSubscriptionReconcile({ store, billing, webhookDeps, logger = console, nowMs }) {
  const candidates = tenantsForStripeReconcile(store.load());
  let healed = 0;
  let errors = 0;
  for (const tenant of candidates) {
    let status;
    try {
      ({ status } = await billing.retrieveSubscription(tenant.stripeSubscriptionId));
    } catch (err) {
      // PII-/Key-frei (Regel 4): nur interne Tenant-id + Adapter-Meldung (assertOk-Fehler
      // tragen Status+Op, nie den Stripe-Key oder Kundendaten).
      logger.warn(`[stripe-reconcile] Statusabfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
      errors++;
      continue;
    }
    if (status !== HEALING_STRIPE_STATUS) continue;
    // Verlorener Webhook erkannt: Stripe sagt beendet, der Store sagt nicht suspendiert.
    logger.warn(
      `[stripe-reconcile] Abo bei Stripe beendet, Tenant nicht suspendiert (verlorener Webhook) -> heile tenant=${tenant.id}`,
    );
    const event = syntheticSubscriptionDeletedEvent({
      tenantId: tenant.id,
      subscriptionId: tenant.stripeSubscriptionId,
      nowMs,
    });
    try {
      await applyStripeWebhookSerialized(event, webhookDeps);
      healed++;
    } catch (err) {
      logger.warn(`[stripe-reconcile] Heilung fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
      errors++;
    }
  }
  return { checked: candidates.length, healed, errors };
}
