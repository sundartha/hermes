// Geteilte Abo-Orchestrierung (W4): erstellt ein echtes monatliches Stripe-Recurring
// fuer einen Tenant mit Karte-on-file und persistiert die Abo-Referenzen. Reine
// Orchestrierung ueber die injizierten Ports (store-Fassade + BillingPort, P4/DIP);
// kein direkter Stripe-/IO-Zugriff. Loest ECHTES Geld aus (Recurring) -> nur ueber
// die gegatete Self-Service-Route (PAYMENT_ENABLED) erreichbar.
//
// Aktiviert NICHT selbst (Status-Flip liegt im Route-Layer ueber accounts.setStatus,
// damit der webAuthMw-Status-Seam EINE Schreibquelle behaelt - kein Drift zur
// Store-Fassade). Diese Schicht persistiert nur die Abo-Referenzen am Tenant.

import { hasCardOnFile } from "../self-service.js";
import { CATALOG_SLUGS } from "../plans.js";

// Buchbare Plan-Slugs = die EINE Quelle aus dem Plan-Katalog (src/plans.js, SSoT).
// Kein zweites Slug-Literal hier (G5/S2): der Katalog definiert die Tiers, diese
// Schicht nur die Tier->Stripe-Price-Bindung (PLAN_PRICE_CONFIG_KEY). Unbekannter
// Slug bleibt fail-closed (createTenantSubscription -> unknown_plan).
export const PLAN_SLUGS = CATALOG_SLUGS;

// Plan-slug -> der config-Schluessel mit der Stripe-Price-Id. Lokal gehalten (G13):
// die Tier->Price-Zuordnung gehoert in diese Schicht, nicht in config.js.
const PLAN_PRICE_CONFIG_KEY = Object.freeze({
  starter: "stripeStarterPriceId",
  business: "stripeBusinessPriceId",
});

// Loest den Stripe-Price aus dem Plan-slug ueber config auf. Unbekannter/fehlender
// Slug ODER fehlende Price-Id -> null (Aufrufer -> 400/500, kein Stripe-Call mit Muell).
export function priceIdForPlan(slug, config) {
  const key = PLAN_PRICE_CONFIG_KEY[slug];
  if (!key) return null;
  return config[key] || null;
}

// Suffix-Laenge der paymentMethodId im Idempotenz-Key. Genug Entropie, um zwei
// verschiedene Karten desselben Tenants sicher zu unterscheiden (Stripe-pm-Ids enden
// auf Zufall), ohne den vollen PM-Wert in den Key zu schreiben (Invariante AM4: nur Suffix).
const PM_KEY_SUFFIX_LEN = 12;

// Idempotenz-Key je (Tenant, Plan, Karte): ein echter Doppelklick mit DERSELBEN Karte
// dedupt weiter (gleiche Params -> Stripe liefert dieselbe Subscription). Eine KORRIGIERTE
// Karte (neue paymentMethodId nach Neu-Erfassung) erzeugt einen NEUEN Key und kollidiert
// nicht mit den geaenderten Stripe-Params unter dem alten Key (behebt den idempotency_error,
// der einen Retry mit anderer Karte sonst gesperrt hat). Nur das PM-Suffix, nie der Vollwert
// (Invariante). paymentMethodId ist hier garantiert gesetzt (no_card-Gate laeuft davor).
function subscribeIdempotencyKey(tenant, slug, paymentMethodId) {
  return `sub_${tenant}_${slug}_${paymentMethodId.slice(-PM_KEY_SUFFIX_LEN)}`;
}

// Erstellt das Abo fail-closed und persistiert seine Referenzen am Tenant.
// Reihenfolge der Gates (M3, alle fail-closed): unbekannter Plan -> unkonfigurierter
// Price -> bereits aktives Abo (Doppelabbuchungs-Schutz) -> Karte-on-file Pflicht.
// Erst dann createSubscription (off_session, error_if_incomplete, Idempotency-Key)
// und store.setTenantSubscription. Nebeneffekt (Anlegen + Speichern) im Namen (N7).
// Aktiviert NICHT (Status-Flip liegt im Route-Layer ueber accounts.setStatus).
export async function createTenantSubscription({ store, billing, config, tenant, planSlug }) {
  if (!PLAN_SLUGS.includes(planSlug)) return { ok: false, reason: "unknown_plan" };
  const priceId = priceIdForPlan(planSlug, config);
  if (!priceId) return { ok: false, reason: "plan_unconfigured" };
  // Doppelabbuchungs-Schutz: ein Tenant mit bereits gespeichertem Abo bucht nicht
  // erneut (der Idempotency-Key schuetzt nur den identischen Retry, nicht einen
  // zweiten Plan). Vorhandenes Abo -> 409 im Route-Layer.
  if (store.tenantSubscription(tenant).subscriptionId)
    return { ok: false, reason: "already_subscribed" };
  const stripe = store.tenantStripe(tenant);
  if (!hasCardOnFile(stripe)) return { ok: false, reason: "no_card" };
  const { subscriptionId, currentPeriodEnd } = await billing.createSubscription({
    tenantRef: tenant,
    customerId: stripe.customerId,
    // Die on-file-Karte als Default-Zahlungsmittel des Abos (sonst kann Stripe die erste
    // Rechnung off_session nicht belasten -> HTTP 400). hasCardOnFile oben garantiert sie.
    paymentMethodId: stripe.paymentMethodId,
    priceId,
    idempotencyKey: subscribeIdempotencyKey(tenant, planSlug, stripe.paymentMethodId),
  });
  store.setTenantSubscription(tenant, { subscriptionId, planSlug, currentPeriodEnd });
  return { ok: true, subscriptionId, planSlug, currentPeriodEnd };
}
