// Stripe-Webhook-Signaturpruefung + Event-Interpretation (W4). Trennt die Krypto +
// reine Event-Interpretation von der Route (wie der Twilio-Signatur-Adapter die
// Krypto vom /voice-Gate trennt). Kein express, kein store - reine Funktionen ->
// unit-testbar ohne Server. Kein Stripe-SDK (Regel: wenige Deps); node:crypto reicht.
import crypto from "node:crypto";
import { KYC_LEVEL } from "../store/defaults.js"; // reine Konstante, kein IO

// Replay-Fenster (Stripe-Default 5 min): ein abgefangener+spaeter wiedereingespielter
// Webhook mit gueltiger Signatur faellt nach diesem Fenster durch (G25).
const SIGNATURE_TOLERANCE_S = 300;

// In-scope Subscription-Lifecycle-Event-Typen (kein Magic-String, G25). Alles andere
// -> interpretStripeEvent liefert action="ignore" (idempotent, kein Fehler).
export const SUBSCRIPTION_EVENT = Object.freeze({
  CREATED: "customer.subscription.created",
  UPDATED: "customer.subscription.updated",
  DELETED: "customer.subscription.deleted",
  PAYMENT_FAILED: "invoice.payment_failed",
});

// Webhook-Wirkungen (kein Magic-String, G25). Der Route-Layer mappt activate/suspend
// auf accounts.setStatus + Session-Invalidierung; ignore ist ein No-Op (idempotent).
export const WEBHOOK_ACTION = Object.freeze({
  ACTIVATE: "activate",
  SUSPEND: "suspend",
  IGNORE: "ignore",
});

// Stripe-Subscription-Status, die eine BESTAETIGTE Zahlung bedeuten und das Gate
// oeffnen duerfen (Stripe-API-Werte). Stripe feuert .created auch bei 'incomplete'
// (vor erster Zahlung) und .updated bei Dunning (past_due/unpaid); solche Events duerfen
// weder KYC=CARD setzen noch Provisioning ausloesen (Invariante 1/2). Nur active/trialing
// aktivieren; alle anderen Status -> ignore. Suspend laeuft weiter ausschliesslich ueber
// DELETED/PAYMENT_FAILED (Spec: nur diese beiden suspenden).
const CONFIRMED_SUBSCRIPTION_STATUS = Object.freeze(new Set(["active", "trialing"]));

// Parst den Stripe-Signature-Header "t=<ts>,v1=<hex>[,v1=<hex>...]" in {timestamp, v1[]}.
// Fail-closed: fehlt t oder ein v1, -> null (Aufrufer lehnt ab). Mehrere v1 (Secret-
// Rotation) werden alle gesammelt.
function parseSignatureHeader(header) {
  if (typeof header !== "string" || header.length === 0) return null;
  let timestamp = null;
  const v1 = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "t") timestamp = value;
    else if (key === "v1") v1.push(value);
  }
  if (!timestamp || v1.length === 0) return null;
  return { timestamp, v1 };
}

// Timing-sicherer Hex-Vergleich gleicher Laenge. Ungleiche Laenge -> false (kein
// timingSafeEqual-Wurf bei Laengen-Mismatch). leak-frei (nur boolean).
function safeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

// Verifiziert den Stripe-Signature-Header gegen das Webhook-Secret per HMAC-SHA256
// ueber "<timestamp>.<rawBody>", timing-sicher. Fail-closed: fehlender Header/Secret/
// rawBody, falsches Schema, Toleranzfenster ueberschritten oder HMAC-Mismatch -> false.
// Secret NIE in einer Fehlermeldung leaken (liefert nur boolean). nowS = aktuelle
// Unix-Sekunden (vom Aufrufer, damit der Test die Uhr kontrolliert, P12/R).
export function verifyStripeSignature({ rawBody, signatureHeader, secret, nowS }) {
  if (!secret || rawBody == null) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const timestampS = Number(parsed.timestamp);
  if (!Number.isFinite(timestampS)) return false;
  if (Math.abs(nowS - timestampS) > SIGNATURE_TOLERANCE_S) return false;
  const payload = `${parsed.timestamp}.${Buffer.from(rawBody).toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  // Bei Secret-Rotation kann Stripe mehrere v1 senden - ein Treffer genuegt.
  return parsed.v1.some((candidate) => safeHexEqual(candidate, expected));
}

// Reine Event-Interpretation: liefert {tenantRef|null, subscriptionId|null, action,
// planSlug?, currentPeriodEnd?} aus einem geparsten Stripe-Event. tenantRef kommt aus
// metadata.tenant_ref (das createSubscription mitgibt); fehlt es, loest der Route-Layer
// den Tenant ueber subscriptionId auf. Nur die in-scope Typen wirken; alles andere ->
// action=ignore (idempotent, kein Fehler). CREATED/UPDATED=activate NUR bei bestaetigter
// Subscription (status active/trialing -> CONFIRMED_SUBSCRIPTION_STATUS; incomplete/
// past_due/unpaid/... -> ignore), DELETED/PAYMENT_FAILED=suspend (Spec: nur diese beiden
// suspenden).
export function interpretStripeEvent(event) {
  const object = (event && event.data && event.data.object) || {};
  switch (event && event.type) {
    case SUBSCRIPTION_EVENT.CREATED:
    case SUBSCRIPTION_EVENT.UPDATED:
      // Nur eine bestaetigte Subscription (status active/trialing) oeffnet Gate +
      // Provisioning. incomplete/past_due/unpaid/... -> ignore: kein faelschliches
      // Gate-Open fuer eine unbezahlte Subscription, keine Re-Aktivierung eines gerade
      // ueber PAYMENT_FAILED gesperrten Tenants durch ein nachgelagertes Dunning-Event.
      if (!CONFIRMED_SUBSCRIPTION_STATUS.has(object.status)) {
        return { action: WEBHOOK_ACTION.IGNORE, tenantRef: null, subscriptionId: null };
      }
      return {
        action: WEBHOOK_ACTION.ACTIVATE,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.id ?? null,
        planSlug: planSlugOf(object),
        currentPeriodEnd: object.current_period_end ?? null,
      };
    case SUBSCRIPTION_EVENT.DELETED:
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.id ?? null,
      };
    case SUBSCRIPTION_EVENT.PAYMENT_FAILED:
      // invoice.payment_failed traegt subscription + customer; den Tenant loest der
      // Route-Layer ueber die gespeicherte subscriptionId auf (kein metadata.tenant_ref
      // garantiert auf der Invoice).
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.subscription ?? null,
      };
    default:
      return { action: WEBHOOK_ACTION.IGNORE, tenantRef: null, subscriptionId: null };
  }
}

// tenant_ref aus der Event-Metadata (createSubscription gibt es mit). Fehlt -> null
// (Route loest ueber subscriptionId auf, fail-closed).
function tenantRefOf(object) {
  return (object.metadata && object.metadata.tenant_ref) || null;
}

// plan-slug aus der Subscription-Metadata (createSubscription gibt es nicht direkt mit,
// aber Stripe spiegelt Subscription-metadata in UPDATED-Events). Fehlt -> null (der
// Aufrufer behaelt dann den gespeicherten Slug, kein erzwungenes Ueberschreiben).
function planSlugOf(object) {
  return (object.metadata && object.metadata.plan_slug) || null;
}

// Wendet ein verifiziertes Stripe-Subscription-Event auf den Tenant an. Reine
// Orchestrierung ueber die injizierten Seams (store-Fassade + accounts/sessions, P4/DIP);
// kein express, kein direkter IO/Stripe-Zugriff -> unit-testbar ohne Server-Spawn.
// Tenant-Aufloesung: zuerst metadata.tenant_ref (createSubscription gibt es mit), sonst
// ueber die gespeicherte subscriptionId (store.findTenantBySubscription) - kein Treffer ->
// still ignorieren (fail-closed, KEIN Cross-Tenant-Suspend). activate hat DREI Effekte:
// Plan/Periode nachziehen, KYC auf CARD heben (store.setKycLevel - oeffnet das Outbound-Gate
// nach bestaetigter Zahlung) und ueber accounts.setStatus aktivieren (DERSELBE Status-Seam
// wie webAuthMw/Admin-approve - eine Schreibquelle, kein Drift); danach stoesst der injizierte
// provision-Seam das (idempotente, payment-gegatete) Nummern-Provisioning an. suspend setzt
// suspended + invalidiert alle Sessions des Tenants und ruft provision NIE. ignore = No-Op.
// Nebeneffekt (Status-/Abo-/KYC-Schreibung + Provisioning) im Namen.
export async function applyStripeWebhook(
  event,
  { store, accounts, sessions, audit, req, provision },
) {
  const { action, tenantRef, subscriptionId, planSlug, currentPeriodEnd } =
    interpretStripeEvent(event);
  if (action === WEBHOOK_ACTION.IGNORE) return;
  const tenant = tenantRef || store.findTenantBySubscription(subscriptionId)?.id || null;
  if (!tenant) {
    audit("stripe_webhook_ignored", req, `action=${action} no_tenant`);
    return;
  }
  if (action === WEBHOOK_ACTION.ACTIVATE) {
    // Nur die wirklich gelieferten Felder nachziehen (selektiver Patch): planSlug/
    // currentPeriodEnd koennen fehlen -> der gespeicherte Wert bleibt unveraendert.
    const patch = {};
    if (subscriptionId != null) patch.subscriptionId = subscriptionId;
    if (planSlug != null) patch.planSlug = planSlug;
    if (currentPeriodEnd != null) patch.currentPeriodEnd = currentPeriodEnd;
    store.setTenantSubscription(tenant, patch);
    // P3 Kern-Fix: bestaetigte Zahlung hebt den KYC-Reifegrad auf CARD - ohne das bleibt
    // das Outbound-Gate (tenantActiveSubscriber, KYC>=CARD) trotz aktivem Abo zu.
    store.setKycLevel(tenant, KYC_LEVEL.CARD);
    await accounts.setStatus(tenant, "active");
    // P3: Provisioning (Telnyx, payment-gated) anstossen. Idempotent im Trigger (kein
    // Doppelkauf bei Webhook-Retry/Folge-Events); bei PROVISIONING_ENABLED=false bleibt
    // die Nummer 'requested' (KEIN Kauf, KEIN Geld). Injizierter Seam -> applyStripeWebhook
    // bleibt rein/unit-testbar (der Trigger kennt Queue/Provider und lebt in server.js).
    await provision(tenant);
    audit("stripe_webhook_activate", req, `tenant=${tenant}`);
    return;
  }
  // SUSPEND (Zahlung gescheitert / Abo geloescht): Status + Sessions sperren (gesperrter
  // Kunde kann nicht bis Cookie-Expiry weiterlesen).
  await accounts.setStatus(tenant, "suspended");
  await sessions.invalidateByTenant(tenant);
  audit("stripe_webhook_suspend", req, `tenant=${tenant}`);
}
