// Stripe-Webhook-Signaturpruefung + Event-Interpretation (W4). Trennt die Krypto +
// reine Event-Interpretation von der Route (wie der Telnyx-Signatur-Adapter die
// Krypto vom /voice-Gate trennt). Kein express, kein store - reine Funktionen ->
// unit-testbar ohne Server. Kein Stripe-SDK (Regel: wenige Deps); node:crypto reicht.
import crypto from "node:crypto";
import { activatePaidTenant, profileAuditDetail } from "./activation.js";
import { provisionAuditDetail } from "./provision-outcome.js";
import { customerMatches } from "./card-setup.js";
import { hasCardOnFile } from "../self-service.js";
import { makeKeyedChainMutex } from "../chain-mutex.js";
import { isKnownPlanSlug } from "../plans.js";
import { moneyActionFor, graceDueAtIso, MONEY_ACTION, MONEY_EVENT } from "./money-events.js";
import { attemptContractEndCleanup } from "./contract-end-cleanup.js";
import { clearSubscriptionReference } from "./subscribe.js";

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
  // GAP-03 (O2): eines der vier bisher wirkungslosen Geld-Ereignisse (money-events.js).
  MONEY: "money_event",
  // 312k-P1 (Teil A): cancel_at_period_end=true bei einer BESTAETIGTEN Subscription.
  // Der Tenant bleibt aktiv (er hat fuer die laufende Periode bezahlt) - nur der
  // Kuendigungszustand wird gespeichert, KEINE der drei ACTIVATE-Wirkungen (KYC-Hebung/
  // Provisioning/Statuswechsel) laeuft (s. applyStripeWebhook).
  CANCEL_SCHEDULED: "cancel_scheduled",
});

// Plattform-Alarm-SMS-Praefixe (kein Magic-String, G25). GAP-04: die Aktivierung wartet auf
// ein Provisioning-Ergebnis, das nicht rechtzeitig geklaert wurde. GAP-03: ein Geld-Ereignis
// mit Alarm-Wirkung (aktuell nur charge.dispute.created, s. money-events.js).
const ACTIVATION_PENDING_ALARM_SMS_PREFIX = "[Hermes] Aktivierung wartet auf Provisioning: ";
const MONEY_EVENT_ALARM_SMS_PREFIX = "[Hermes] Zahlungsereignis: ";

// Stripe-Subscription-Status, die eine BESTAETIGTE Zahlung bedeuten und das Gate
// oeffnen duerfen (Stripe-API-Werte). Stripe feuert .created auch bei 'incomplete'
// (vor erster Zahlung) und .updated bei Dunning (past_due/unpaid); solche Events duerfen
// weder KYC=CARD setzen noch Provisioning ausloesen (Invariante 1/2). Nur active/trialing
// aktivieren; alle anderen Status -> ignore. Suspend laeuft weiter ausschliesslich ueber
// DELETED/PAYMENT_FAILED (Spec: nur diese beiden suspenden).
const CONFIRMED_SUBSCRIPTION_STATUS = Object.freeze(new Set(["active", "trialing"]));

// CL1-B1: WARUM suspendiert wird. Beide Ereignisse falten weiter auf action=suspend
// (WELCHE Events suspendieren, aendert sich NICHT) - aber der SUSPEND-Zweig muss
// unterscheiden koennen, ob das Stripe-Abo noch EXISTIERT: nach deleted ist die
// gespeicherte sub_-Referenz tot, im Dunning lebt sie weiter (Doppelabbuchungs-
// Schutz). Die Unterscheidung faellt HIER, in der reinen Interpretation - der
// Effekt-Zweig wertet das Roh-Event NICHT erneut aus (G5/G23: eine Auswertungsstelle).
export const SUSPEND_REASON = Object.freeze({
  SUBSCRIPTION_DELETED: "subscription_deleted", // Abo bei Stripe beendet -> Referenz ist tot
  PAYMENT_FAILED: "payment_failed",             // Dunning -> Abo lebt, Referenz bleibt
});

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
    case SUBSCRIPTION_EVENT.UPDATED: {
      // Nur eine bestaetigte Subscription (status active/trialing) oeffnet Gate +
      // Provisioning. incomplete/past_due/unpaid/... -> ignore: kein faelschliches
      // Gate-Open fuer eine unbezahlte Subscription, keine Re-Aktivierung eines gerade
      // ueber PAYMENT_FAILED gesperrten Tenants durch ein nachgelagertes Dunning-Event.
      if (!CONFIRMED_SUBSCRIPTION_STATUS.has(object.status)) {
        return { action: WEBHOOK_ACTION.IGNORE, tenantRef: null, subscriptionId: null };
      }
      // Perioden-Anker ueber periodFieldsOf (items.data[0]-Fallback): aktuelle
      // API-Versionen tragen die Felder NUR am Item - ohne Fallback bliebe der
      // Quota-/Gate-Anker leer (fail-closed 0 Minuten).
      const period = periodFieldsOf(object);
      const shared = {
        tenantRef: tenantRefOf(object),
        subscriptionId: object.id ?? null,
        planSlug: planSlugOf(object),
        currentPeriodEnd: period.currentPeriodEnd ?? null,
        currentPeriodStart: period.currentPeriodStart ?? null,
        // Race-Fix: das Event traegt customer + default_payment_method (signatur-
        // verifiziert) - damit kann der Webhook-Pfad die Karte selbst binden, statt
        // auf den Browser-Return zu warten (s. applyStripeWebhook).
        customerId: object.customer ?? null,
        paymentMethodId: paymentMethodIdOf(object.default_payment_method),
      };
      // 312k-P1 (Teil A, der gefaehrliche Befund): Stripe setzt bei "kuendigt zum
      // Periodenende" status weiterhin auf active/trialing UND cancel_at_period_end=true.
      // Der Bestandscode las das als ACTIVATE und haette ueber activatePaidTenant
      // clearSuspendedAt/clearBillingHold ausgeloest - der gerade gesetzte Kuendigungs-
      // zustand waere im selben Atemzug wieder geloescht. Eigener Zweig: Tenant bleibt
      // aktiv (er hat fuer die laufende Periode bezahlt), NUR der Kuendigungszustand wird
      // gespeichert (s. applyStripeWebhook - keine der drei ACTIVATE-Wirkungen laeuft).
      if (object.cancel_at_period_end === true) {
        return { action: WEBHOOK_ACTION.CANCEL_SCHEDULED, ...shared, cancelAtPeriodEnd: true };
      }
      // cancel_at_period_end===false ist eine EXPLIZITE Ruecknahme (Kunde hat es sich
      // anders ueberlegt, oder der Betreiber hat die Kuendigung im Stripe-Dashboard
      // zurueckgenommen) -> der Store-Vermerk wird aktiv geloescht (selektiver Patch-Key
      // unten in applyStripeWebhook). Fehlt das Feld (undefined, aeltere/synthetische
      // Events ohne diese Property) bleibt der Key bewusst weg - kein "nicht gekuendigt"
      // ohne Beleg, Bestandsverhalten fuer alle Aufrufer, die das Feld nie gesetzt hatten.
      return {
        action: WEBHOOK_ACTION.ACTIVATE,
        ...shared,
        ...(object.cancel_at_period_end === false ? { cancelAtPeriodEnd: false } : {}),
      };
    }
    case SUBSCRIPTION_EVENT.DELETED:
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        suspendReason: SUSPEND_REASON.SUBSCRIPTION_DELETED,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.id ?? null,
      };
    case SUBSCRIPTION_EVENT.PAYMENT_FAILED:
      // invoice.payment_failed traegt subscription + customer; den Tenant loest der
      // Route-Layer ueber die gespeicherte subscriptionId auf (kein metadata.tenant_ref
      // garantiert auf der Invoice).
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        suspendReason: SUSPEND_REASON.PAYMENT_FAILED,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.subscription ?? null,
      };
    default: {
      // GAP-03 (O2): vier bisher wirkungslose Geld-Ereignisse ausserhalb der Subscription-
      // Lifecycle-Allowlist. moneyActionFor liefert null fuer jeden anderen Typ -> IGNORE
      // bleibt fuer alles Unbekannte unveraendert (Bestandsverhalten).
      const money = moneyActionFor(event && event.type);
      if (!money) return { action: WEBHOOK_ACTION.IGNORE, tenantRef: null, subscriptionId: null };
      return {
        action: WEBHOOK_ACTION.MONEY,
        tenantRef: tenantRefOf(object),
        subscriptionId: moneyEventSubscriptionId(event.type, object),
        customerId: object.customer ?? null,
        moneyAction: money.action,
        moneyAlarm: money.alarm,
      };
    }
  }
}

// Money-Events tragen die Subscription-Referenz je nach Stripe-Objekttyp anders (O2, s.
// money-events.js-Tabelle): customer.subscription.paused IST eine Subscription (object.id),
// invoice.payment_action_required traegt sie am Feld subscription; charge.dispute.created/
// charge.refunded (Objekttyp Charge) kennen KEINE Subscription-Referenz - dort loest die
// Route ausschliesslich ueber customerId auf.
function moneyEventSubscriptionId(type, object) {
  if (type === MONEY_EVENT.SUBSCRIPTION_PAUSED) return object.id ?? null;
  if (type === MONEY_EVENT.PAYMENT_ACTION_REQUIRED) return object.subscription ?? null;
  return null;
}

// default_payment_method kommt expandiert als Objekt (id) oder unexpandiert als
// String (Webhook-Events sind IMMER unexpandiert) - beide Formen auf die opake
// pm_-Referenz reduzieren; fehlt beides -> null. EINE Quelle (G5): der Stripe-
// Adapter (stripe.js, getSubscriptionCheckoutResult) importiert sie von hier
// (Abhaengigkeitsrichtung Adapter -> pures Modul).
export function paymentMethodIdOf(defaultPaymentMethod) {
  if (typeof defaultPaymentMethod === "string") return defaultPaymentMethod;
  return (defaultPaymentMethod && defaultPaymentMethod.id) || null;
}

// Die aktuelle Stripe-API liefert current_period_end/-start NICHT mehr top-level an
// der Subscription, sondern pro Item (items.data[0]); Fallback auf top-level fuer
// aeltere API-Versionen. Ohne diesen Fallback persistierte der Webhook-Pfad ein Abo
// OHNE Perioden-Anker -> quotaView/planMinutesExceeded fail-closed = "0 von X min"
// trotz frischem Abo (Live-Befund 2026-07-06). EINE Quelle (G5) wie paymentMethodIdOf:
// stripe.js (createSubscription/getSubscriptionCheckoutResult) importiert von hier.
export function periodFieldsOf(subLike) {
  const item = subLike.items && subLike.items.data && subLike.items.data[0];
  return {
    currentPeriodStart: (item && item.current_period_start) ?? subLike.current_period_start,
    currentPeriodEnd: (item && item.current_period_end) ?? subLike.current_period_end,
  };
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
// provision-Seam das (idempotente, payment-gegatete) Nummern-Provisioning an. cancel_scheduled
// (312k-P1) patcht NUR Plan/Periode + den Kuendigungsvermerk - KEINEN der drei ACTIVATE-
// Effekte (der Tenant war/bleibt aktiv, er hat bezahlt). suspend setzt
// suspended + invalidiert alle Sessions des Tenants und ruft provision NIE. ignore = No-Op.
// Nebeneffekt (Status-/Abo-/KYC-Schreibung + Provisioning) im Namen.
//
// CL1-B2 (Geld-Invariante): NUR das echte Vertragsende entwertet die Abo-Referenz. Nach
// customer.subscription.deleted existiert bei Stripe kein Abo mehr - bliebe die sub_-
// Referenz stehen, behauptete sie dauerhaft "es gibt ein Abo" und der Kunde kaeme weder
// ins Dashboard (status=suspended -> 403) noch zu einem neuen Abo (hasActiveSubscription
// -> 409 already_subscribed): ein Zustand ohne Ausgang. Bei invoice.payment_failed wird an
// den Abo-Referenzen NICHTS geaendert - dort LEBT das Stripe-Abo weiter; eine geleerte
// Referenz liesse denselben Kunden ein ZWEITES Abo kaufen (Doppelabbuchung). Das Gate
// hasActiveSubscription bleibt unveraendert.
// Ausgelagert aus applyStripeWebhook (G30: eine Aufgabe pro Funktion, haelt die ohnehin
// grosse Orchestrierungs-Funktion unter der Zeilen-/Komplexitaetsgrenze) - EIN Aufrufer,
// direkt darunter. Nebeneffekt (Abo-Schreibung + Audit) im Namen.
function clearEndedSubscriptionRefAndAudit({ store, tenant, suspendReason, audit, req }) {
  const subscriptionEnded = suspendReason === SUSPEND_REASON.SUBSCRIPTION_DELETED;
  if (subscriptionEnded) clearSubscriptionReference(store, tenant);
  audit(
    "stripe_webhook_suspend",
    req,
    `tenant=${tenant} reason=${suspendReason} subscription_ref=${subscriptionEnded ? "cleared" : "kept"}`,
  );
}

export async function applyStripeWebhook(
  event,
  {
    store,
    accounts,
    sessions,
    audit,
    req,
    provision,
    billing,
    // 312k-Phase 4 (Vertragsende-Aufraeumarbeiten): NUR im SUSPEND-Zweig gelesen, NUR wenn
    // der Vertrag durch eine Kuendigung endete (s. dort). numberProvisioner = derselbe
    // Telnyx-NumberProvisioning-Port wie der DID-Release-Reconciler; workos = der WorkOS-
    // Management-Adapter (null, wenn WORKOS_MANAGEMENT_API_KEY nicht gesetzt ist - die
    // Loeschung wird dann nicht versucht); auditStore = der durable Postgres-audit_log-
    // Nachweis (Default No-Op, Muster self-service-routes.js makeSelfServiceRoutes) fuer
    // Aufrufer/Tests, die diesen Pfad nicht beruehren.
    numberProvisioner,
    workos,
    auditStore = { record: async () => {} },
    // E5-01: derselbe EL-Registrar wie wireWebLogin (sipRegistrarWennAktiv) - NUR im
    // SUSPEND-Zweig gelesen, an attemptContractEndCleanup weitergereicht.
    sipRegistrar,
  },
) {
  const interpreted = interpretStripeEvent(event);
  const {
    action, tenantRef, subscriptionId, planSlug, currentPeriodEnd, currentPeriodStart,
    customerId, paymentMethodId, cancelAtPeriodEnd, suspendReason,
  } = interpreted;
  if (action === WEBHOOK_ACTION.IGNORE) return;
  // GAP-03: Geld-Ereignisse ausserhalb der Subscription-Lifecycle-Allowlist auditieren SICH
  // SELBST zuerst (vor jeder Tenant-Aufloesung) - eigener Zweig, eigene Tenant-Aufloesungs-
  // Reihenfolge (s. applyMoneyEvent).
  if (action === WEBHOOK_ACTION.MONEY) return applyMoneyEvent(event, interpreted, { store, audit, req });
  const tenant = tenantRef || store.findTenantBySubscription(subscriptionId)?.id || null;
  if (!tenant) {
    audit("stripe_webhook_ignored", req, `action=${action} no_tenant`);
    return;
  }
  if (action === WEBHOOK_ACTION.CANCEL_SCHEDULED) {
    // 312k-P1: derselbe Fail-closed-Riegel wie ACTIVATE (S1-1) - ein GESETZTER, aber
    // unbekannter Plan-Slug erreicht den Store nicht.
    if (planSlug != null && !isKnownPlanSlug(planSlug)) {
      audit("stripe_webhook_ignored", req, `action=${action} tenant=${tenant} unknown_plan`);
      return;
    }
    // Selektiver Patch wie im ACTIVATE-Zweig: nur die tatsaechlich gelieferten Felder
    // nachziehen, damit "gekuendigt zum TT.MM." (currentPeriodEnd) aktuell bleibt.
    const patch = { cancelAtPeriodEnd: true };
    if (subscriptionId != null) patch.subscriptionId = subscriptionId;
    if (planSlug != null) patch.planSlug = planSlug;
    if (currentPeriodEnd != null) patch.currentPeriodEnd = currentPeriodEnd;
    if (currentPeriodStart != null) patch.currentPeriodStart = currentPeriodStart;
    store.setTenantSubscription(tenant, patch);
    // Bewusst KEIN accounts.setStatus, KEIN clearSuspendedAt/clearBillingHold, KEIN
    // activatePaidTenant (KYC/Provisioning): der Tenant war/bleibt aktiv (er hat fuer die
    // laufende Periode bezahlt) - dieser Zweig speichert NUR den Kuendigungszustand
    // (Owner-Entscheidung: Kuendigung wirkt zum Ende des bezahlten Zeitraums).
    audit(
      "stripe_webhook_cancel_scheduled",
      req,
      `tenant=${tenant} current_period_end=${currentPeriodEnd ?? "unknown"}`,
    );
    return { cancelScheduled: true };
  }
  if (action === WEBHOOK_ACTION.ACTIVATE) {
    // S1-1 (G11): einen GESETZTEN, aber unbekannten Plan-Slug NIE an den Store weiterreichen
    // (Muster createTenantSubscription, subscribe.js: unknown_plan fail-closed - hier fehlte
    // dieses Gate als einzigem der beiden Schwester-Aufrufer). store.setTenantSubscription lehnt
    // einen unbekannten Slug zwar atomar ab (wirft), aber die Route hat KEIN try/catch um
    // applyStripeWebhookSerialized -> der Wurf liefe als unhandled rejection durch (haengende
    // Antwort/Stripe-Timeout). Hier fail-closed abfangen: NICHT aktivieren (Ueberbuchung fail-
    // closed, die richtige Decke ist bei unbekanntem Plan unbestimmbar). planSlug==null ist der
    // erlaubte selektive Patch (gespeicherter Slug bleibt) und wird NIE abgelehnt.
    if (planSlug != null && !isKnownPlanSlug(planSlug)) {
      audit("stripe_webhook_ignored", req, `action=${action} tenant=${tenant} unknown_plan`);
      return;
    }
    // Nur die wirklich gelieferten Felder nachziehen (selektiver Patch): planSlug/
    // currentPeriodEnd/currentPeriodStart koennen fehlen -> der gespeicherte Wert bleibt unveraendert.
    const patch = {};
    if (subscriptionId != null) patch.subscriptionId = subscriptionId;
    if (planSlug != null) patch.planSlug = planSlug;
    if (currentPeriodEnd != null) patch.currentPeriodEnd = currentPeriodEnd;
    if (currentPeriodStart != null) patch.currentPeriodStart = currentPeriodStart;
    // 312k-P1 (Teil A): cancel_at_period_end===false ist die EXPLIZITE Ruecknahme einer
    // vorher vermerkten Kuendigung - nur dann patchen (interpretStripeEvent liefert den Key
    // nur bei echtem false, s. dort); fehlt das Feld (undefined), bleibt ein bestehender
    // Vermerk unberuehrt (kein falsches "nicht gekuendigt" ohne Beleg).
    if (cancelAtPeriodEnd != null) patch.cancelAtPeriodEnd = cancelAtPeriodEnd;
    store.setTenantSubscription(tenant, patch);
    // Race-Fix (Abo-ohne-Nummer): der Webhook gewinnt das Rennen gegen den Checkout-
    // Return regelmaessig (Stripe stellt in ms zu, der Browser-Redirect braucht
    // Sekunden). Ohne Karte am Tenant liefe das folgende Provisioning fail-closed ins
    // Leere (provisionNumber: kein Zahlungsmittel -> Nummer failed). Das Event traegt
    // customer + default_payment_method signatur-verifiziert -> NUR die Luecke fuellen:
    // NIE eine vorhandene Karte ueberschreiben (eine bewusst neu erfasste bleibt) und
    // NUR bei Customer-Match (R4: nie ein fremdes payment_method an den Tenant binden).
    if (
      customerId && paymentMethodId &&
      !hasCardOnFile(store.tenantStripe(tenant)) &&
      customerMatches(store, tenant, customerId)
    ) {
      store.setTenantStripe(tenant, { paymentMethodId });
    }
    // P5: dieselbe 3-Effekt-Aktivierung wie der Subscribe-Handler (KYC=CARD + Wartezustand +
    // payment-gegatetes, idempotentes Provisioning + Status ERST nach geklaertem Ergebnis,
    // GAP-04) - EINE Quelle (activation.js). Idempotent im provision-Trigger (kein Doppelkauf
    // bei Webhook-Retry/Folge-Events); bei PROVISIONING_ENABLED=false bleibt die Nummer
    // 'requested' (KEIN Kauf, aber dry_run gilt als geklaert -> Tenant wird aktiv).
    const { profile, activated, provisioned, budgetPeriodStarted } = await activatePaidTenant({
      store, accounts, provision, billing, tenant,
    });
    // GAP-01/O4: der Perioden-Reset ist eine Geld-Kante und gehoert damit in dieselbe
    // Audit-Zeile wie Profil und Provisioning (kein zweites Ereignis, keine neue Senke).
    audit(
      "stripe_webhook_activate",
      req,
      `tenant=${tenant} ${profileAuditDetail(profile)} ${provisionAuditDetail(provisioned)} budget_period=${budgetPeriodStarted ? "reset" : "kept"}`,
    );
    // GAP-03/O2: ein bestaetigtes aktives Abo hebt jede Beanstandungs-Wirkung auf
    // (Reversibilitaet) - ein zuvor gesetzter billing_hold/periodCreditRevoked darf einen
    // wieder zahlenden Tenant nicht dauerhaft sperren.
    if (activated) {
      store.clearBillingHold(tenant);
      store.setTenantSubscription(tenant, { periodCreditRevoked: false });
      return { activated: true };
    }
    // GAP-04: das Provisioning-Ergebnis ist NICHT geklaert - der Wartezustands-Marker bleibt
    // gesetzt (activation.js), der Operator-Retry findet den Tenant wieder. Plattform-Alarm-
    // Wunsch geht an den Route-Layer zurueck (routes/stripe-webhook.js sendet die SMS - kein
    // messaging-Import in dieser IO-freien Domaenenschicht).
    return {
      activated: false,
      alarm: {
        prefix: ACTIVATION_PENDING_ALARM_SMS_PREFIX,
        detail: `tenant=${tenant} ${provisionAuditDetail(provisioned)}`,
      },
    };
  }
  // SUSPEND (Zahlung gescheitert / Abo geloescht): Status + Sessions sperren (gesperrter
  // Kunde kann nicht bis Cookie-Expiry weiterlesen).
  //
  // 312k-Phase 4 (die eine Bedingung, die alles traegt): customer.subscription.deleted UND
  // invoice.payment_failed fuehren BEIDE hierher (Spec: nur diese beiden suspenden) - ob
  // NUR gesperrt wird oder ZUSAETZLICH die Rufnummer freigegeben + die WorkOS-Identitaet
  // geloescht werden, entscheidet AUSSCHLIESSLICH der gespeicherte Kuendigungszustand
  // (cancelAtPeriodEnd), gelesen VOR jeder Mutation dieses Zweigs. War er gesetzt, endete
  // der Vertrag durch eine KUENDIGUNG (312k-P1 CANCEL_SCHEDULED hat ihn gesetzt, nichts hat
  // ihn seither zurueckgenommen) - dann UND NUR dann greift das Aufraeumen. Ein Zahlungs-
  // ausfall OHNE vorherige Kuendigung liefert hier IMMER false (das Feld wurde nie gesetzt)
  // -> Identitaet und Nummer bleiben unangetastet, byte-identisches Bestandsverhalten.
  const endedViaCancellation = store.tenantSubscription(tenant).cancelAtPeriodEnd;
  await accounts.setStatus(tenant, "suspended");
  // tenant-prolif-c: Grace-Anker fuer den spaeteren DID-Release (Phase D). SET-IF-ABSENT stempelt
  // den Zeitpunkt der ERSTEN Suspendierung; ein Dunning-Retry (weiteres invoice.payment_failed)
  // bewegt ihn NICHT (die Set-if-absent-Regel lebt in state-ops). Best-effort (kein throw): der
  // DB-Status via accounts.setStatus oben ist davon unabhaengig gesetzt.
  store.setSuspendedAtIfAbsent(tenant);
  await sessions.invalidateByTenant(tenant);
  clearEndedSubscriptionRefAndAudit({ store, tenant, suspendReason, audit, req });
  // Die Sperre ist an dieser Stelle bereits VOLLZOGEN (setStatus/setSuspendedAtIfAbsent/
  // invalidateByTenant sind oben durchgelaufen) - das Aufraeumen laeuft danach, best-effort,
  // und darf die Antwort NIE blockieren (try/catch: attemptContractEndCleanup ist selbst
  // schon fail-soft, dies ist ein zusaetzlicher Riegel gegen einen unerwarteten Fehler in
  // der Verdrahtung). Was nicht klappt, bleibt am Tenant offen vermerkt (durabler Audit-
  // Nachweis in attemptContractEndCleanup) und wird vom periodischen Sweep erneut versucht.
  if (endedViaCancellation) {
    try {
      await attemptContractEndCleanup({ store, numberProvisioner, workos, auditStore, tenantId: tenant, sipRegistrar });
    } catch (e) {
      console.error(`[contract-end] Aufraeumen fehlgeschlagen tenant=${tenant}: ${e.message}`);
    }
  }
  return { suspended: true };
}

// GAP-03 (O2): wendet eines der vier Geld-Ereignisse an. Reihenfolge fail-closed: ERST das
// unbedingte Audit (mit Ereignis-ID, Idempotenz-Nachweisbarkeit), DANN die Tenant-Aufloesung
// (tenantRef -> customerId), DANN die Wirkung. Tenant-Aufloesung laeuft bewusst NICHT ueber
// subscriptionId: charge.dispute.created/charge.refunded (Objekttyp Charge) kennen gar keine
// Subscription-Referenz, und die einzige "id" auf einem Subscription-/Invoice-Objekt waere
// sonst eine Zufallsuebereinstimmung ohne belastbare Semantik - customerId ist das einzige
// Feld, das ALLE vier Stripe-Objekttypen zuverlaessig tragen. Ohne jeden Korrelations-
// schluessel -> "no_tenant"-Audit UND KEIN weiterer Store-Zugriff (der Katalogtest fuehrt
// genau diesen Fall mit store={} - ein Store-Zugriff waere hier ein TypeError).
async function applyMoneyEvent(event, interpreted, { store, audit, req }) {
  const { tenantRef, customerId, moneyAction, moneyAlarm } = interpreted;
  const eventType = event && event.type;
  const eventId = (event && event.id) ?? "unknown";
  audit("stripe_money_event", req, `type=${eventType} event=${eventId} action=${moneyAction}`);
  const tenant = tenantRef
    ? tenantRef
    : (customerId && store.findTenantByCustomer(customerId)?.id) || null;
  if (!tenant) {
    audit("stripe_money_event_ignored", req, "no_tenant");
    return { action: WEBHOOK_ACTION.MONEY, tenant: null, alarm: null };
  }
  applyMoneyAction(store, tenant, moneyAction);
  return {
    action: WEBHOOK_ACTION.MONEY,
    tenant,
    alarm: moneyAlarm
      ? { prefix: MONEY_EVENT_ALARM_SMS_PREFIX, detail: `type=${eventType} tenant=${tenant}` }
      : null,
  };
}

// Wirkung je Money-Event (O2, Tabelle in money-events.js). WARN schreibt NICHTS (nur das
// unbedingte Audit oben) - der Katalogtest pinnt genau das (Dispute -> kein Store-Write).
function applyMoneyAction(store, tenant, moneyAction) {
  switch (moneyAction) {
    case MONEY_ACTION.WARN:
      return;
    case MONEY_ACTION.REVOKE_PERIOD_CREDIT:
      store.setTenantSubscription(tenant, { periodCreditRevoked: true });
      return;
    case MONEY_ACTION.HOLD_OUTBOUND:
      store.setBillingHold(tenant, { reason: "paused" });
      return;
    case MONEY_ACTION.GRACE_THEN_HOLD:
      store.setBillingHold(tenant, {
        reason: "payment_action",
        dueAtIso: graceDueAtIso(new Date().toISOString()),
      });
      return;
    default:
      return; // unbekannte Wirkung (sollte durch moneyActionFor nie vorkommen) -> No-Op
  }
}

// ---- P1 (C1 Stripe-Webhook-Race, S1-1): Serialisierter Entry-Point -----------------
// Pro Stripe-Korrelationsschluessel (subscriptionId, Fallback tenantRef) darf hoechstens
// EIN applyStripeWebhook-Effekt gleichzeitig laufen, und nur das nach event.created
// NEUESTE Event darf den Tenant-Zustand noch veraendern (G31: Invariante strukturell
// erzwungen statt per Konvention/Zufall der Event-Reihenfolge). EIGENE Chain-Instanz,
// bewusst NICHT store.withStoreLock (HARD-RULE store.js: ein withStoreLock-Body darf
// NICHT erneut withStoreLock aufrufen - der ACTIVATE-Zweig laeuft ueber activatePaidTenant
// -> provision -> triggerTenantProvisioning in einen verschachtelten withStoreLock-Aufruf;
// wuerde applyStripeWebhook selbst in withStoreLock liegen, deadlockt das). In-Process
// (kein persistentes Ledger) - akzeptiertes Restrisiko bei Prozess-Neustart, siehe
// PLAN-SECURITY.md.
const webhookLock = makeKeyedChainMutex();

// Letztes je erfolgreich angewendetes Event pro Korrelationsschluessel (Ordnungswache).
// key -> { eventId, createdAt, action }. action = WEBHOOK_ACTION.ACTIVATE|SUSPEND, gebraucht
// fuer den Gleichstand-Tie-Break in isStaleEvent (AUDIT-1). NIE geloescht (Dedup muss ueber
// die gesamte Prozesslaufzeit gelten) - im Unterschied zum self-cleaning webhookLock (siehe
// chain-mutex.js).
const lastAppliedByKey = new Map();

// Baut den Vergleichs-Anker fuer ein Event (gleiche Form wie der gespeicherte lastApplied-
// Eintrag in lastAppliedByKey) - EINE Quelle (G5) statt Duplizierung zwischen dem
// isStaleEvent-Aufruf und dem lastAppliedByKey.set() danach.
function eventAnchorOf(event, action) {
  return { eventId: event.id ?? null, createdAt: Number(event.created), action };
}

// Ist `candidate` gegenueber dem zuletzt fuer den Schluessel angewendeten Event (`lastApplied`)
// veraltet? Faelle: (a) exakte Stripe-Redelivery (gleiche event.id) -> immer stale (Dedup).
// (b) event.created fehlt/nicht auswertbar (NaN) -> NIE stale (Bestandsverhalten: kein Event
// wird verworfen, das sich zeitlich nicht einordnen laesst). (c) event.created echt aelter ->
// stale, echt neuer -> nicht stale. (d) GLEICHSTAND (identisches event.created, andere
// event.id, AUDIT-1): fail-closed Tie-Break statt Ankunfts-/Lock-Reihenfolge - ein SUSPEND
// (gate-schliessend) darf ein zeitgleiches ACTIVATE (gate-oeffnend) NIE als stale verwerfen;
// umgekehrt bleibt ein zeitgleiches ACTIVATE gegenueber einem bereits angewendeten SUSPEND
// weiterhin stale (das Gate bleibt zu). Gleichstand mit identischer Wirkung (z.B. zwei SUSPEND-
// Events derselben Sekunde) bleibt ebenfalls stale - kein redundantes Re-Apply. Reine Funktion,
// kein Seiteneffekt.
function isStaleEvent(lastApplied, candidate) {
  if (!lastApplied) return false;
  if (candidate.eventId != null && candidate.eventId === lastApplied.eventId) return true;
  // Symmetrischer Guard zum candidate-Check darunter (Review-Blocker S1, defensive
  // Asymmetrie): ohne diesen Check waere bei einem nicht auswertbaren (NaN) lastApplied.
  // createdAt sowohl `candidate.createdAt < NaN` als auch `> NaN` false, und der Ablauf
  // faellt faelschlich in die Gleichstand-/Tie-Break-Logik weiter unten, obwohl gar kein
  // echter Gleichstand vorliegt - ein spaeteres gueltiges ACTIVATE wuerde dauerhaft als
  // stale verworfen.
  if (!Number.isFinite(lastApplied.createdAt)) return false; // Anker selbst unvergleichbar -> Bestandsverhalten (nie stale), Ordnungswache wird nicht vergiftet
  if (!Number.isFinite(candidate.createdAt)) return false;
  if (candidate.createdAt < lastApplied.createdAt) return true;
  if (candidate.createdAt > lastApplied.createdAt) return false;
  // Gleichstand: nur ein gate-oeffnendes ACTIVATE nach einem bereits angewendeten SUSPEND
  // bleibt stale - jede andere Kombination (insbesondere SUSPEND nach ACTIVATE) wird angewendet.
  if (candidate.action === WEBHOOK_ACTION.SUSPEND && lastApplied.action !== WEBHOOK_ACTION.SUSPEND) {
    return false;
  }
  return true;
}

// Serialisiert applyStripeWebhook (unveraendert, s.o.) pro Korrelationsschluessel + verwirft
// veraltete/doppelte Events. Das ist der Entry-Point, den die Route ab jetzt ruft (s.
// routes/stripe-webhook.js) - applyStripeWebhook bleibt daneben direkt exportiert/aufrufbar fuer
// test/p3-payment-webhook.test.js (Signatur/Verhalten unveraendert). Ohne Korrelations-
// schluessel (Event traegt weder subscriptionId noch tenantRef, seltener Malformed-Fall) ->
// direkter Passthrough OHNE Lock; applyStripeWebhook's bestehendes no_tenant-Ignore greift
// dann fail-closed. IGNORE-Events brauchen keinen Lock (kein Seiteneffekt moeglich, reine
// interpretStripeEvent-Pruefung reicht). Nebeneffekt (Tenant-Zustandsschreibung, oder No-op
// bei Stale/Ignore) im Namen (N7).
export async function applyStripeWebhookSerialized(event, deps) {
  const interpreted = interpretStripeEvent(event);
  if (interpreted.action === WEBHOOK_ACTION.IGNORE) return;
  // GAP-03: Money-Events koennen NUR eine customerId tragen (Charge-Objekte kennen keine
  // Subscription) - dritte Faellstufe, damit auch sie serialisiert werden.
  const key = interpreted.subscriptionId || interpreted.tenantRef || interpreted.customerId;
  if (!key) return applyStripeWebhook(event, deps);
  const candidate = eventAnchorOf(event, interpreted.action);
  return webhookLock(key, async () => {
    if (isStaleEvent(lastAppliedByKey.get(key), candidate)) return;
    const outcome = await applyStripeWebhook(event, deps);
    // Anker ERST nach erfolgreichem Aufruf setzen: ein werfender Aufruf darf einen
    // legitimen Stripe-Retry desselben Events nicht faelschlich als "stale" blockieren.
    lastAppliedByKey.set(key, candidate);
    return outcome;
  });
}
