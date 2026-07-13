// Geteilte Karten-Erfassungs-Logik (Pay3): die Stripe-Customer-Idempotenz und die
// Customer-Match-Sicherheitsinvariante leben hier an EINER Stelle (G5/S2), weil sie
// von ZWEI Routen gebraucht werden, die sich NUR in Identitaetsquelle, Audit-Name
// und Antwortform unterscheiden: der Pay1-Admin-Pfad (POST /api/billing/*, JSON,
// requireTenant) und der Pay3-Self-Service-Pfad (POST /api/self-service/billing/*,
// 302, web-session). Die Sicherheits-Invariante (fremde session_id darf NIE ein
// fremdes payment_method binden, R4) gehoert genau einmal in den Code.
//
// Reine Orchestrierung ueber die injizierten Ports (store-Fassade + BillingPort, P4/DIP);
// kein direkter Stripe-/IO-Zugriff hier. Geld wird NICHT bewegt (setup-Mode, keine
// Abbuchung) - die Karte wird nur am Customer gespeichert.

import { CustomerMissingError } from "./errors.js";

// Injizierbarer Sleep (Muster defaultSleep in llm.js): Tests reichen einen Spy,
// die Suite wartet nie echt (F.I.R.S.T./T9).
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Legt den Stripe-Customer eines Tenants idempotent an: existiert er bereits, wird
// er wiederverwendet (kein Doppel-Customer bei wiederholtem Klick). Liefert die
// customerId. Nebeneffekt (Anlegen + Speichern) ist im Namen sichtbar (N7).
export async function ensureCustomer({ store, billing, tenant }) {
  let { customerId } = store.tenantStripe(tenant);
  if (!customerId) {
    ({ customerId } = await billing.createCustomer({ tenantRef: tenant }));
    store.setTenantStripe(tenant, { customerId });
  }
  return customerId;
}

// Self-Heal fuer tote Customer-Referenzen (PLAN-CHECKOUT-STALE-STRIPE-CUSTOMER.md, Fix B):
// ermittelt den Customer idempotent (ensureCustomer) und startet den Checkout. Meldet der
// Provider CustomerMissing (gespeicherte ODER frisch angelegte Id existiert dort nicht -
// Test/Live-Wechsel, Dashboard-Cleanup, Sichtbarkeits-Verzoegerung), werden die stale
// Referenzen verworfen (paymentMethodId haengt am toten Customer und ist ohne ihn wertlos),
// EIN frischer Customer angelegt und der Checkout nach retryDelayMs GENAU EINMAL wiederholt.
// Ein zweiter Fehlschlag propagiert unveraendert (kein Loop; Route -> 502 wie bisher).
// healed=true signalisiert dem Route-Layer den alarmierbaren Audit-Event (gehaeufte Heals
// deuten auf ein Stripe-Account-Problem - Heal darf das nie stumm maskieren). startCheckout
// ist ein reiner Callback (customerId) => Promise<session>; die Mode-Wahl (setup/
// subscription) bleibt beim Aufrufer. Kein HTTP/Audit hier (G34, Muster subscribeAndActivate).
export async function startCheckoutWithStaleCustomerHeal(
  { store, billing, tenant, retryDelayMs, sleep = defaultSleep },
  startCheckout,
) {
  const customerId = await ensureCustomer({ store, billing, tenant });
  try {
    return { session: await startCheckout(customerId), healed: false };
  } catch (err) {
    if (!(err instanceof CustomerMissingError)) throw err;
    // Erst nullen, DANN neu anlegen: schlaegt createCustomer fehl, bleibt ein sauberer
    // leerer Zustand (naechster Klick startet frisch) statt der stalen Referenz.
    store.setTenantStripe(tenant, { customerId: null, paymentMethodId: null });
    const freshCustomerId = await ensureCustomer({ store, billing, tenant });
    // Wartezeit vor dem Retry: ueberbrueckt die live beobachtete Stripe-Sichtbarkeits-
    // Verzoegerung zwischen createCustomer und dem naechsten API-Call (Nachtrag 3).
    if (retryDelayMs > 0) await sleep(retryDelayMs);
    return { session: await startCheckout(freshCustomerId), healed: true };
  }
}

// G5/S2 (Review-Blocker Runde 3): die Customer-Match-Sicherheitsinvariante (R4) an
// EINER Stelle statt wortgleich in bindCardFromSession UND activateSubscriptionFrom-
// CheckoutSession (src/billing/subscribe.js) dupliziert. Fail-closed: ohne gespeicherten
// Customer ODER bei Abweichung ist es NIE ein Match - eine fremde session_id darf NIE
// fremde Karte/Abo an diesen Tenant binden.
export function customerMatches(store, tenant, customerId) {
  const { customerId: stored } = store.tenantStripe(tenant);
  return !!stored && stored === customerId;
}

// Bindet das in einer abgeschlossenen Checkout-Session erfasste payment_method an
// den Tenant - fail-closed ueber customerMatches (R4). Bei Mismatch wird NICHTS
// gespeichert und { ok: false } geliefert; der Aufrufer uebersetzt das in seine
// Antwortform + Audit. Bei Erfolg ist die Karte hinterlegt (Nebeneffekt im Namen, N7).
export async function bindCardFromSession({ store, billing, tenant, sessionId }) {
  const { customerId, paymentMethodId } = await billing.getCheckoutSessionResult(sessionId);
  if (!customerMatches(store, tenant, customerId)) return { ok: false };
  store.setTenantStripe(tenant, { customerId, paymentMethodId });
  return { ok: true };
}
