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
import { activatePaidTenant } from "./activation.js";
import { customerMatches } from "./card-setup.js";

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

// BK-Discount-Fix1: Idempotenz-Key der subscription-Mode-Checkout-Session (tenant+plan+price,
// OHNE PM-Suffix - beim Session-Aufbau existiert noch keine gespeicherte Karte, die
// Karte entsteht bei Stripe erst WAEHREND des gehosteten Checkouts). Schliesst die TOCTOU-
// Luecke des Vor-Checks (hasActiveSubscription): zwei nahezu gleichzeitige setup-checkout-
// Aufrufe fuer denselben Tenant+Plan+Price (Doppelklick/zwei Tabs) bestehen BEIDE den
// Vor-Check, weil noch keine Session abgeschlossen ist - mit demselben Key liefert Stripe
// beiden Aufrufen dieselbe Checkout-Session zurueck, sodass nur EINE Session abschliessbar
// ist (Stripe verwehrt ein zweites Payment auf einer bereits abgeschlossenen Session) statt
// zweier echter, real abgerechneter Stripe-Abos.
// IDEMP-KEY-FIX: priceId ist Teil des Keys, weil Stripe einen Key 24h an die ERSTEN
// Request-Params bindet. Ein legitimer Preis-Wechsel (neue Stripe-Price-Id fuer denselben
// Plan) aenderte sonst line_items[0][price] unter dem ALTEN Key -> HTTP 400
// idempotency_error, 24h Checkout-Lockout fuer jeden Tenant mit juengstem Versuch.
// priceId ist ein oeffentlicher Stripe-Identifier (kein Secret) -> voller Wert im Key;
// das Suffix-Truncation-Pattern oben (PM_KEY_SUFFIX_LEN) gilt der Invariante AM4 fuer
// Payment-Method-Ids und greift hier nicht.
export function checkoutSessionIdempotencyKey(tenant, planSlug, priceId) {
  return `subcs_${tenant}_${planSlug}_${priceId}`;
}

// G5/S2: das gemeinsame Praedikat "Tenant hat bereits ein aktives Abo" - stand vorher
// wortgleich dreifach dupliziert (hier zweimal + im Route-Layer). Eine Aenderungsstelle,
// falls sich die Bedingung je erweitert (z.B. Status statt nur Id).
export function hasActiveSubscription(store, tenant) {
  return !!store.tenantSubscription(tenant).subscriptionId;
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
  if (hasActiveSubscription(store, tenant)) return { ok: false, reason: "already_subscribed" };
  const stripe = store.tenantStripe(tenant);
  if (!hasCardOnFile(stripe)) return { ok: false, reason: "no_card" };
  const { subscriptionId, currentPeriodEnd, currentPeriodStart } = await billing.createSubscription({
    tenantRef: tenant,
    customerId: stripe.customerId,
    // Die on-file-Karte als Default-Zahlungsmittel des Abos (sonst kann Stripe die erste
    // Rechnung off_session nicht belasten -> HTTP 400). hasCardOnFile oben garantiert sie.
    paymentMethodId: stripe.paymentMethodId,
    priceId,
    idempotencyKey: subscribeIdempotencyKey(tenant, planSlug, stripe.paymentMethodId),
  });
  store.setTenantSubscription(tenant, { subscriptionId, planSlug, currentPeriodEnd, currentPeriodStart });
  return { ok: true, subscriptionId, planSlug, currentPeriodEnd };
}

// BK-Discount: Aktivierung aus einer abgeschlossenen subscription-Checkout-Session.
// Stripe hat Karte + Abo dort BEREITS angelegt - hier wird NUR verifiziert, persistiert
// und aktiviert (kein zweiter Geld-Call). Spiegelt subscribeAndActivate; die Abo-Daten
// kommen aus der Session statt aus createSubscription. Gates fail-closed in FESTER
// Reihenfolge (sicherheitsrelevant, nicht umsortieren):
//   1. Customer-Match - ueber customerMatches (card-setup.js, G5/S2): dieselbe
//      R4-Invariante wie bindCardFromSession, EINE Stelle statt Kopie. Eine fremde
//      session_id darf NIE fremde Karte/Abo an diesen Tenant binden.
//   2. Plan-Match - der zurueckgetragene Query-Plan muss dem tatsaechlich bezahlten
//      Plan der Session (subscription_data-Metadata) entsprechen, sonst buchte ein
//      manipulierter return-Aufruf ein teureres Kontingent zum falschen Preis.
//   3. already_subscribed/subscription_conflict - ein bereits gespeichertes Abo
//      aktiviert nie ein zweites Mal. Review-Blocker Runde 2 (Cross-Plan-Race):
//      zwei nahezu gleichzeitige setup-checkout-Aufrufe fuer VERSCHIEDENE Plaene
//      (verschiedene Idempotency-Keys, s. checkoutSessionIdempotencyKey) koennen
//      BEIDE bei Stripe real abgerechnet werden, bevor je ein /return laeuft. Die
//      erste Rueckkehr persistiert normal; die zweite traegt eine ANDERE, ebenfalls
//      real bezahlte outcome.subscriptionId. Nur eine IDENTISCHE subscriptionId ist
//      ein harmloser Doppel-Redirect derselben Session (already_subscribed, idempotent-
//      erfolgreich). Eine ABWEICHENDE subscriptionId ist eine verwaiste, unverwaltete
//      Zweit-Subscription -> eigener reason (subscription_conflict), NIE als Erfolg
//      werten (der Route-Layer darf das NIE auf sub=ok mappen).
// Nebeneffekt (Persistenz + Aktivierung) im Namen (N7).
export async function activateSubscriptionFromCheckoutSession({
  store,
  billing,
  accounts,
  provision,
  tenant,
  sessionId,
  expectedPlanSlug,
}) {
  const outcome = await billing.getSubscriptionCheckoutResult(sessionId);
  if (!customerMatches(store, tenant, outcome.customerId))
    return { ok: false, reason: "customer_mismatch" };
  if (!outcome.planSlug || outcome.planSlug !== expectedPlanSlug)
    return { ok: false, reason: "plan_mismatch" };
  if (hasActiveSubscription(store, tenant)) {
    const existing = store.tenantSubscription(tenant);
    if (existing.subscriptionId === outcome.subscriptionId) {
      // MIT Karte-on-file: echter Doppel-Redirect/Reload derselben Session -> reiner
      // No-op (idempotent-erfolgreich, wie bisher).
      if (hasCardOnFile(store.tenantStripe(tenant)))
        return { ok: false, reason: "already_subscribed" };
      // OHNE Karte: der Stripe-Webhook hat das Rennen gegen diesen Return gewonnen
      // (Abo bereits gespeichert), kann aber im Fehlerfall die Karte nicht gebunden
      // haben -> ohne Heilung bliebe der Tenant dauerhaft abonniert-aber-kartenlos
      // und jedes Provisioning schluege fail-closed fehl (Abo-ohne-Nummer-Bug).
      // Session ist oben customer- + plan-verifiziert -> Karte binden + dieselbe
      // idempotente Aktivierung wie der ok-Pfad (tenantHasLiveNumber-Guard: kein
      // Doppelkauf, falls der Webhook-Pfad die Nummer schon beschafft hat).
      store.setTenantStripe(tenant, {
        customerId: outcome.customerId,
        paymentMethodId: outcome.paymentMethodId,
      });
      // Heilung komplett machen: auch die Abo-Referenzen aus der Session persistieren
      // (identische subscriptionId -> idempotent). Fuellt insbesondere den Perioden-
      // Anker (currentPeriodStart/End), falls der Webhook-Write ihn nicht trug -
      // ohne Anker zeigte quotaView fail-closed 0 Minuten und das Plan-Minuten-Gate
      // blockte Outbound trotz frischem Abo.
      store.setTenantSubscription(tenant, {
        subscriptionId: outcome.subscriptionId,
        planSlug: outcome.planSlug,
        currentPeriodEnd: outcome.currentPeriodEnd,
        currentPeriodStart: outcome.currentPeriodStart,
      });
      const { profile } = await activatePaidTenant({ store, accounts, provision, tenant });
      return { ok: false, reason: "already_subscribed", profile };
    }
    // Verwaiste, real bei Stripe abgerechnete Zweit-Subscription (s. Kommentar oben).
    // subscriptionId bleibt im Ergebnis (opake Referenz, KEIN Secret - wie ueberall
    // sonst in diesem Modul), damit Ops sie ueber den Audit-Log manuell stornieren kann.
    return { ok: false, reason: "subscription_conflict", subscriptionId: outcome.subscriptionId };
  }
  store.setTenantStripe(tenant, {
    customerId: outcome.customerId,
    paymentMethodId: outcome.paymentMethodId,
  });
  store.setTenantSubscription(tenant, {
    subscriptionId: outcome.subscriptionId,
    planSlug: outcome.planSlug,
    currentPeriodEnd: outcome.currentPeriodEnd,
    currentPeriodStart: outcome.currentPeriodStart,
  });
  const { profile } = await activatePaidTenant({ store, accounts, provision, tenant });
  return {
    ok: true,
    subscriptionId: outcome.subscriptionId,
    planSlug: outcome.planSlug,
    currentPeriodEnd: outcome.currentPeriodEnd,
    profile,
  };
}
