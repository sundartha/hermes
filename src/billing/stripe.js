// Stripe-Billing-Adapter (P6b1): BillingPort (placeHold/captureHold/cancelHold)
// ueber die Stripe-v1-REST-API. Loest ECHTES Geld aus (Hold + Capture) -> nur ueber
// die gegatete Onboarding-Route (PAYMENT_ENABLED) erreichbar. Kein SDK: fetch +
// Bearer. Stripe /v1 erwartet application/x-www-form-urlencoded (NICHT JSON).
// Secret-Key NIE in Fehlermeldungen leaken (Regel 4).
//
// Verifiziert gegen die Stripe-Doku (manual capture), live UNBESTAETIGT (mit dem
// Owner im Test-Mode live fixen, falls Felder abweichen): confirm=true +
// capture_method=manual setzt den PaymentIntent direkt auf 'requires_capture'.
// off_session=true + gespeicherter customer/payment_method belasten die hinterlegte
// Karte ohne Kunden-Interaktion (kein automatic_payment_methods/return_url noetig).
//   hold:    POST /v1/payment_intents  {amount, currency, capture_method=manual, confirm=true, customer, payment_method, off_session=true}
//   capture: POST /v1/payment_intents/{id}/capture  {amount_to_capture}
//   cancel:  POST /v1/payment_intents/{id}/cancel
//   meter:   POST /v1/billing/meter_events  {event_name, payload[value], ...}  (P6b3)
//   subscription-cancel-toggle: POST /v1/subscriptions/{id}  {cancel_at_period_end}  (312k-P2;
//     scheduleCancellation=true, unscheduleCancellation=false - DIESELBE Operation, KEIN
//     eigener Stripe-Endpunkt fuer "kuendigen"; nicht zu verwechseln mit cancel oben, das
//     storniert eine PaymentIntent-Reserve, kein Abo)
import { config } from "../config.js";
// G5: EINE Normalisierung (pm-Id, pm-Typ, Perioden)
import { paymentMethodIdOf, paymentMethodTypeOf, periodFieldsOf } from "./webhook.js";
import { CustomerMissingError, PaymentAuthenticationRequiredError } from "./errors.js";
import { declineOf, declineDetail, attachProviderDecline } from "./decline.js"; // GP-P1: EINE Quelle des Ablehnungsgrunds

const PAYMENT_INTENTS_PATH = "/v1/payment_intents";
const METER_EVENTS_PATH = "/v1/billing/meter_events";
const CUSTOMERS_PATH = "/v1/customers";
const CHECKOUT_SESSIONS_PATH = "/v1/checkout/sessions";
const SUBSCRIPTIONS_PATH = "/v1/subscriptions"; // W4: monatliches Recurring
const PAYMENT_METHODS_PATH = "/v1/payment_methods"; // GP-P2: rein lesend, kein Geld
const PRICES_PATH = "/v1/prices"; // GP-P6: rein lesend, kein Geld
const CHECKOUT_SETUP_MODE = "setup"; // Karte speichern OHNE Abbuchung (kein Magic-String)
const CHECKOUT_SUBSCRIPTION_MODE = "subscription"; // Karte + Abo in EINEM gehosteten Schritt (kein Magic-String)
// GAP-05 (Sicherungs-Achse): Stripe sammelt im subscription-Mode bei einem Rechnungsbetrag
// von 0 (100-%-Coupon) per Default GAR KEINE Karte - genau so entsteht eine DID ohne
// hinterlegtes Zahlungsmittel. "always" erzwingt die Kartenbindung unabhaengig vom Rabatt.
// Die PREIS-Achse (allow_promotion_codes) bleibt davon unberuehrt (Owner-Entscheidung O2b).
const PAYMENT_METHOD_COLLECTION_ALWAYS = "always";
const OFF_SESSION = "true"; // Karte ohne Kunden-Interaktion belasten (kein 3DS-Redirect noetig)
// W4: Stripe legt bei fehlgeschlagener Erstzahlung KEIN incomplete-Abo an, sondern wirft
// (fail-closed, kein "Abo ohne Zahlung"). Kein Magic-String (G25).
const SUBSCRIPTION_FAILCLOSED_BEHAVIOR = "error_if_incomplete";

// PROV-01/F6: Stripe lehnt einen zweiten Capture desselben PaymentIntent mit diesem
// Fehlercode ab und meldet den PI-Status 'succeeded' (Geld bereits eingezogen). NUR diese
// Kombination gilt als idempotenter Erfolg (kein Magic-String, G25). Dokumentierte Stripe-
// Form, live im Owner-Smoke bestaetigen (wie der uebrige Adapter, live UNBESTAETIGT).
const PI_UNEXPECTED_STATE_CODE = "payment_intent_unexpected_state";
const PI_STATUS_SUCCEEDED = "succeeded";

// Self-Heal (PLAN-CHECKOUT-STALE-STRIPE-CUSTOMER.md, Fix B): Stripes Fehlerform fuer
// eine tote/unsichtbare Customer-Referenz. NUR diese Code+Param-Kombination wird als
// CustomerMissing klassifiziert (kein Magic-String, G25; Muster PI_UNEXPECTED_STATE_CODE).
const RESOURCE_MISSING_CODE = "resource_missing";
const CUSTOMER_PARAM = "customer";

// PAY-19 (SCA/3-D Secure): Stripe lehnt eine off-session-Belastung mit GENAU diesem
// error.code ab, wenn die Bank eine Authentifizierung verlangt. Kein Magic-String (G25;
// Muster PI_UNEXPECTED_STATE_CODE / RESOURCE_MISSING_CODE). Bewusst NUR error.code als
// Anker - decline_code traegt bei diesem Fall denselben Wert und waere ein zweiter,
// redundanter Vertrag mit dem Provider (nie raten, G26).
const AUTHENTICATION_REQUIRED_CODE = "authentication_required";

// Logischer kind -> Stripe-Meter-event_name (Provider-Spezifik adapter-intern, G25).
// Live mit dem Owner gegen die echten Stripe-Meter abgleichen (geparkt, wie P6b1):
// die Customer-Bindung (stripe_customer_id pro Tenant) ist NICHT in P6b3-Scope ->
// der Meter meldet payload[value]=quantity + tenant_ref (Audit), kein erfundener
// stripe_customer_id. event_name muss zu den im Stripe-Dashboard angelegten Metern
// passen (Owner-Smoke). EXPORT (P1, S1-7): boot.js prueft ueber meterMappingGaps, dass
// JEDE usage_event-Sorte (USAGE_EVENT_KIND) hier ein Mapping hat - sonst faellt ein
// SMS-Event beim Flush endlos auf 'failed' zurueck (Umsatz nie gemeldet).
export const STRIPE_METER_EVENT_NAME = Object.freeze({
  voice_minute: "voice_minutes",
  ai_token: "ai_tokens",
  sms: "sms_messages", // S1-7: SMS-Producer existiert real (call-finish.js kind=SMS)
  number_month: "number_months",
});

function authHeaders(extra = {}) {
  if (!config.billing.stripeSecretKey) throw new Error("Stripe Billing: STRIPE_SECRET_KEY fehlt");
  return {
    Authorization: `Bearer ${config.billing.stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...extra,
  };
}

// EINE Quelle (G5) fuer "Auth-Header + optionaler Idempotency-Key", die vier Geld-Calls
// (placeHold/reportMeter/createSubscriptionCheckoutSession/createSubscription) identisch
// brauchen. Fehlt der Key -> nur Auth-Header (byte-identisch zum bisherigen Inline-Ternary).
function idempotentHeaders(idempotencyKey) {
  return authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
}

// Diagnose-Text einer gescheiterten Stripe-Operation: EINE Quelle (G5) fuer alle drei
// Fehlergrenzen unten. `detail` ist der Provider-Rohtext; ohne ihn bleibt die Meldung
// byte-identisch zur bisherigen Form. Regel 4: NIE der Secret-Key - der liegt
// ausschliesslich im Request-Header.
function failureMessage(op, status, detail = "") {
  return `Stripe ${op} fehlgeschlagen: HTTP ${status} ${detail}`.trimEnd();
}

// Stufe 1 der Fehlergrenze: Operation + HTTP-Status, der Fehlerkoerper wird nicht gelesen.
// Fuer Calls, deren Aufrufer ohnehin nur abbrechen kann (kein eigener Erholungspfad).
function assertOk(res, op) {
  if (!res.ok) throw new Error(failureMessage(op, res.status));
}

// Praezise Diskriminierung des idempotenten "bereits captured"-Falls (PROV-01/F6): NUR
// Fehlercode payment_intent_unexpected_state UND PI-Status 'succeeded' gelten als Erfolg
// (das Geld ist eingezogen). Jeder andere Fehler (anderer code, anderer PI-Status wie
// 'canceled') bleibt ein echter Fehler. Erwartet den geparsten Stripe-Fehlerkoerper.
function isAlreadyCapturedError(errorBody) {
  const err = errorBody && errorBody.error;
  return Boolean(
    err &&
      err.code === PI_UNEXPECTED_STATE_CODE &&
      err.payment_intent &&
      err.payment_intent.status === PI_STATUS_SUCCEEDED,
  );
}

// Liest den Fehlerkoerper einer Nicht-2xx-Antwort GENAU EINMAL und liefert beide Sichten:
// den Rohtext (Diagnose) und die geparste Form (Klassifikation). Nicht lesbarer Body oder
// kein JSON -> "" bzw. {}; dann bleibt es der generische Fehlerpfad (nie raten, G26).
async function readErrorBody(res) {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* Body nicht lesbar -> nur Status melden */
  }
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: {} };
  }
}

// Klassifikation nach AUFRUFER-Sicht (P9): der Stripe-Fehlercode entscheidet ueber den
// Port-Fehlertyp, nicht die technische Herkunft. Erwartet den GEPARSTEN Fehlerkoerper -
// dieselbe Form wie isAlreadyCapturedError (G11). Kennt der Adapter den Fall nicht, bleibt
// es der generische Error. Alle drei Zweige bekommen DIESELBE, bereits fertige Meldung
// uebergeben - diese Funktion baut keinen Text. Seit GP-P1 traegt diese Meldung den
// Ablehnungsgrund als Enum-Anhang; der Log-Output unterscheidet sich also sehr wohl nach
// GRUND (das ist der Zweck). Er ist trotzdem KEIN Steuerkanal: wer den Grund auswerten
// will, liest err.providerDecline (Waechter in test/gp-p1-ablehnungsgrund.test.js).
function billingErrorFor(errorBody, message) {
  const err = (errorBody && errorBody.error) || {};
  // PAY-19: die Bank verlangt 3-D Secure. Die Karte ist gueltig - ein Retry derselben
  // off-session-Belastung kann nicht helfen; der Aufrufer braucht den Zustand, um dem
  // Kunden eine on-session-Bestaetigung anzubieten.
  if (err.code === AUTHENTICATION_REQUIRED_CODE)
    return new PaymentAuthenticationRequiredError(message);
  // Tote/unsichtbare Customer-Referenz (P9/Fix B): NUR code+param=customer heilt
  // card-setup.js; resource_missing auf einem anderen param bleibt generisch.
  if (err.code === RESOURCE_MISSING_CODE && err.param === CUSTOMER_PARAM)
    return new CustomerMissingError(message);
  return new Error(message);
}

// GP-P1: der Bauplatz beider klassifizierenden Stufen - EINE Stelle, an der der
// Ablehnungsgrund erhoben, angehaengt und ans Fehlerobjekt geheftet wird (G5). `detail`
// ist der zusaetzliche Diagnose-Text der jeweiligen Stufe: Stufe 2 gibt keinen, Stufe 3
// den Provider-Rohtext. Der Enum-Anhang steht VOR dem Rohtext, damit der Grund auch in
// einer abgeschnittenen Log-Zeile noch lesbar ist. EIN Objekt-Argument (F1).
function classifiedError({ body, op, status, detail = "" }) {
  const decline = declineOf(body);
  const nachtrag = [declineDetail(decline), detail].filter(Boolean).join(" ");
  return attachProviderDecline(billingErrorFor(body, failureMessage(op, status, nachtrag)), decline);
}

// Stufe 2: wie assertOk, aber der Stripe-Fehlercode bestimmt den Port-Fehlertyp. Der
// Provider-Rohkoerper bleibt AUSSEN VOR; uebernommen wird GENAU das Enum-Trio
// code/decline_code/type. Regel 4 schuetzt Secrets, und die liegen ausschliesslich im
// Request-Header (s. authHeaders) - der Grund, den Grund wegzuwerfen, war nie Regel 4,
// sondern die Sorge um Kundendaten im Koerper. Die trifft die verschachtelten Objekte
// (payment_method/billing_details), nicht die drei Enums (GP-P1).
// Fuer Geld-Calls, deren Aufrufer den Erholungspfad unterscheiden koennen muss.
async function assertOkClassified(res, op) {
  if (res.ok) return;
  const { body } = await readErrorBody(res);
  throw classifiedError({ body, op, status: res.status });
}

// Stufe 3: wie assertOkClassified, haengt zusaetzlich den Provider-Rohtext an die Diagnose.
// Verbliebene Aufrufer sind die beiden Checkout-SESSION-Aufbauten: dort ist noch keine
// Zahlungsmethode am Vorgang, der Fehlerkoerper traegt also keine Kundendaten. Der
// Abo-Aufbau (createSubscription) hat diese Stufe mit GP-P1 verlassen - dort lagen sie
// (Vorfall 11.09.2026). Body nicht lesbar -> nur Status melden (wie assertOk).
async function assertOkWithDetail(res, op) {
  if (res.ok) return;
  const { text, body } = await readErrorBody(res);
  throw classifiedError({ body, op, status: res.status, detail: text });
}

const url = (path) => config.billing.stripeApiBase + path;

/** @type {import("./ports.js").BillingPort} */
export const stripeBilling = {
  async placeHold({
    tenantRef,
    amountCents,
    currency,
    customerId,
    paymentMethodId,
    idempotencyKey,
  }) {
    // Idempotency-Key (number-id-basiert): Retry haelt nie doppelt (Stripe-Header).
    const headers = idempotentHeaders(idempotencyKey);
    // off_session=true + gespeicherter customer/payment_method: Stripe belastet die am
    // Customer hinterlegte Karte ohne Redirect (kein return_url/automatic_payment_methods
    // noetig) - behebt den 400-Wurzel-Fehler des frueheren confirm-ohne-PM-Pfades.
    const body = new URLSearchParams({
      amount: String(amountCents),
      currency,
      capture_method: "manual",
      confirm: "true",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: OFF_SESSION,
    });
    body.set("metadata[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    const res = await fetch(url(PAYMENT_INTENTS_PATH), { method: "POST", headers, body });
    // PAY-19: eine an 3-D Secure gescheiterte Reserve muss am Fehlertyp von einer echten
    // Ablehnung unterscheidbar sein - sonst landet die Nummer still auf failed und der
    // Kunde erfaehrt nie, dass eine Bestaetigung ihn zahlen liesse.
    await assertOkClassified(res, "placeHold");
    const json = await res.json().catch(() => ({}));
    return { paymentIntentId: json.id };
  },

  async captureHold(paymentIntentId, amountCents) {
    const body = new URLSearchParams({ amount_to_capture: String(amountCents) });
    const res = await fetch(`${url(PAYMENT_INTENTS_PATH)}/${paymentIntentId}/capture`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    if (res.ok) return;
    // Idempotenz (PROV-01/F6): ein zweiter Capture desselben PI (Boot-Sweep-Re-Drive nach
    // Crash zwischen Capture und store.save()) darf KEINE bezahlte Nummer freigeben. Stripe
    // lehnt ihn mit 'already captured' ab -> als Erfolg behandeln. Jeder andere Fehler wirft.
    const errorBody = await res.json().catch(() => ({}));
    if (isAlreadyCapturedError(errorBody)) return;
    assertOk(res, "captureHold"); // res.ok ist false -> wirft mit einheitlichem Stripe-Fehlertext
  },

  async cancelHold(paymentIntentId) {
    const res = await fetch(`${url(PAYMENT_INTENTS_PATH)}/${paymentIntentId}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    assertOk(res, "cancelHold");
  },

  // Meldet EIN aggregiertes Meter-Event (P6b3). Loest KEIN Geld aus (Stripe rechnet
  // ueber payload[value] x Meter-Preis). costCents reist im Aggregat fuers interne
  // Audit, geht NICHT an Stripe (value=quantity ist die abrechnungsrelevante Groesse;
  // costCents nie geloggt/geleakt). Idempotenz-Key als Stripe-Header (Retry-sicher).
  async reportMeter({ tenantRef, kind, quantity, idempotencyKey }) {
    const eventName = STRIPE_METER_EVENT_NAME[kind];
    if (!eventName) throw new Error(`Stripe reportMeter: unbekanntes kind '${kind}'`);
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({ event_name: eventName });
    body.set("payload[value]", String(quantity));
    body.set("payload[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    const res = await fetch(url(METER_EVENTS_PATH), { method: "POST", headers, body });
    assertOk(res, "reportMeter");
  },

  // Legt einen Stripe-Customer fuer den Tenant an (POST /v1/customers). metadata
  // [tenant_ref] zur Zuordnung (Audit, kein Geheimnis). Loest KEIN Geld aus.
  async createCustomer({ tenantRef }) {
    const body = new URLSearchParams();
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(CUSTOMERS_PATH), { method: "POST", headers: authHeaders(), body });
    assertOk(res, "createCustomer");
    const json = await res.json().catch(() => ({}));
    return { customerId: json.id };
  },

  // Checkout-Session im setup-Mode (Stripe-gehostete Seite): Karte am Customer
  // speichern OHNE Abbuchung. Nur opake url/sessionId verlassen den Adapter.
  async createSetupCheckoutSession({ tenantRef, customerId, successUrl, cancelUrl }) {
    const body = new URLSearchParams({
      mode: CHECKOUT_SETUP_MODE,
      customer: customerId,
      // Stripe verlangt im setup-Mode ein currency (sonst HTTP 400 parameter_missing).
      // app-weite config.billing.paymentCurrency (default eur) - dieselbe Waehrung wie der
      // spaetere Abo-Price, damit Karte und Recurring nicht divergieren.
      currency: config.billing.paymentCurrency,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    body.set("metadata[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    const res = await fetch(url(CHECKOUT_SESSIONS_PATH), {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    await assertOkWithDetail(res, "createSetupCheckoutSession"); // Self-Heal braucht code/param
    const json = await res.json().catch(() => ({}));
    return { url: json.url, sessionId: json.id };
  },

  // Liest customer + payment_method aus einer abgeschlossenen Setup-Session
  // (setup_intent expandiert). Fehlt das payment_method -> klarer Fehler (Karte
  // nicht gespeichert), KEIN stilles null (G26: kein null ungeprueft weiterreichen).
  async getCheckoutSessionResult(sessionId) {
    // GP-P2: der Expand ist um eine Ebene vertieft (setup_intent.payment_method), sonst
    // kommt die Zahlungsmethode als blosse String-Id und der Typ existiert in der Antwort
    // gar nicht (Pre-Mortem 2: das Feld bliebe in Produktion dauerhaft null). Damit ist
    // payment_method jetzt ein OBJEKT - die Id MUSS ueber paymentMethodIdOf laufen, das
    // beide Formen kennt (String wie Objekt); die alte Direktlesung haette ein Stripe-
    // Objekt als paymentMethodId in die Datenbank geschrieben.
    const expand = "expand[]=setup_intent&expand[]=setup_intent.payment_method";
    const res = await fetch(`${url(CHECKOUT_SESSIONS_PATH)}/${sessionId}?${expand}`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "getCheckoutSessionResult");
    const json = await res.json().catch(() => ({}));
    const paymentMethod = json.setup_intent && json.setup_intent.payment_method;
    const paymentMethodId = paymentMethodIdOf(paymentMethod);
    if (!paymentMethodId)
      throw new Error(
        "Stripe getCheckoutSessionResult: kein payment_method (Karte nicht gespeichert)",
      );
    // Typ fehlt (unexpandierte Altform) -> null, KEIN Wurf: ob das reicht, entscheidet
    // das Eignungs-Gate, nicht der Adapter.
    return {
      customerId: json.customer,
      paymentMethodId,
      paymentMethodType: paymentMethodTypeOf(paymentMethod),
    };
  },

  // Checkout-Session im subscription-Mode (Rabattcode-Feature): Stripe erfasst Karte
  // UND legt das Abo in EINEM gehosteten Schritt an, inkl. nativem Rabattcode-Feld
  // (allow_promotion_codes). KEIN currency-Parameter (der Price bestimmt die Waehrung).
  // subscription_data[metadata]: Session-Metadata reist NICHT in die Subscription ->
  // tenant_ref/plan_slug werden explizit gespiegelt, damit die Webhook-Tenant-Aufloesung
  // (webhook.js tenantRefOf/planSlugOf) und A3-Reconcile (retrieveSubscription) fuer
  // Checkout-erzeugte Abos genauso funktionieren wie fuer createSubscription-Abos.
  // Idempotency-Key (tenant+plan+price-basiert, subscribe.js checkoutSessionIdempotencyKey):
  // ein Doppelklick/zwei Tabs erhaelt DIESELBE Session zurueck statt einer zweiten -
  // schliesst die TOCTOU-Luecke zwischen dem already_subscribed-Vor-Check und dem
  // tatsaechlichen Checkout-Abschluss (Muster wie placeHold/createSubscription).
  // Nur opake url/sessionId verlassen den Adapter.
  async createSubscriptionCheckoutSession({
    tenantRef,
    customerId,
    priceId,
    planSlug,
    successUrl,
    cancelUrl,
    idempotencyKey,
  }) {
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({
      mode: CHECKOUT_SUBSCRIPTION_MODE,
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      allow_promotion_codes: "true",
      payment_method_collection: PAYMENT_METHOD_COLLECTION_ALWAYS,
    });
    body.set("metadata[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    body.set("subscription_data[metadata][tenant_ref]", tenantRef);
    body.set("subscription_data[metadata][plan_slug]", planSlug);
    const res = await fetch(url(CHECKOUT_SESSIONS_PATH), { method: "POST", headers, body });
    await assertOkWithDetail(res, "createSubscriptionCheckoutSession");
    const json = await res.json().catch(() => ({}));
    return { url: json.url, sessionId: json.id };
  },

  // Liest das Ergebnis einer abgeschlossenen subscription-Mode-Session (KEIN zweiter
  // Geld-Call: das Abo existiert schon). expand: subscription + deren payment_method.
  // Fehlt die Subscription (Session nicht abgeschlossen) oder das payment_method ->
  // klarer Fehler (fail-closed, Muster getCheckoutSessionResult). Periodenfelder wie
  // createSubscription: pro Item (aktuelle API) mit top-level-Fallback. planSlug aus
  // der Subscription-Metadata (createSubscriptionCheckoutSession spiegelt sie hinein);
  // fehlt sie -> null (Aufrufer entscheidet fail-closed, NIE raten).
  async getSubscriptionCheckoutResult(sessionId) {
    const expand = "expand[]=subscription&expand[]=subscription.default_payment_method";
    const res = await fetch(`${url(CHECKOUT_SESSIONS_PATH)}/${sessionId}?${expand}`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "getSubscriptionCheckoutResult");
    const json = await res.json().catch(() => ({}));
    const sub = json.subscription;
    if (!sub || !sub.id)
      throw new Error(
        "Stripe getSubscriptionCheckoutResult: keine Subscription (Session nicht abgeschlossen)",
      );
    const paymentMethodId = paymentMethodIdOf(sub.default_payment_method);
    if (!paymentMethodId)
      throw new Error(
        "Stripe getSubscriptionCheckoutResult: kein payment_method (Karte nicht gespeichert)",
      );
    return {
      customerId: json.customer,
      paymentMethodId,
      paymentMethodType: paymentMethodTypeOf(sub.default_payment_method), // GP-P2: bereits expandiert
      subscriptionId: sub.id,
      ...periodFieldsOf(sub),
      planSlug: (sub.metadata && sub.metadata.plan_slug) || null,
    };
  },

  // GP-P2: liest NUR den Typ einer gespeicherten Zahlungsmethode (GET /v1/payment_methods/
  // {id}). Rein lesend, bewegt KEIN Geld, aendert nichts. Gebraucht vom Webhook-Pfad:
  // Stripe-Ereignisse tragen default_payment_method immer unexpandiert, der Typ steht dort
  // nie - ohne diesen Nachschlag bekaeme jeder ueber den Race-Fix gebundene Mandant einen
  // unbekannten Typ und damit fail-closed keine Nummer. Aus dem Adapter kommt AUSSCHLIESS-
  // LICH der Enum-Typ: das PM-Objekt traegt billing_details mit Name, E-Mail und Anschrift
  // (Vorfall 11.09.2026) und bleibt vollstaendig hier drinnen (Regel 4/GP-P1).
  async retrievePaymentMethodType(paymentMethodId) {
    const res = await fetch(`${url(PAYMENT_METHODS_PATH)}/${paymentMethodId}`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "retrievePaymentMethodType");
    const json = await res.json().catch(() => ({}));
    return paymentMethodTypeOf(json);
  },

  // GP-P6: liest NUR Betrag und Waehrung eines Stripe-Price (GET /v1/prices/{id}).
  // Rein lesend, bewegt KEIN Geld. Aus dem Adapter kommen ausschliesslich zwei Skalare
  // (KEIN Stripe-Objekt). Fehlendes/nicht ganzzahliges unit_amount (gestaffelter oder
  // metered Price) -> null: der Waechter urteilt dann "unbekannt" statt zu raten (G26).
  async retrievePriceAmount(priceId) {
    const res = await fetch(`${url(PRICES_PATH)}/${priceId}`, { method: "GET", headers: authHeaders() });
    assertOk(res, "retrievePriceAmount");
    const json = await res.json().catch(() => ({}));
    return {
      unitAmountCents: Number.isInteger(json.unit_amount) ? json.unit_amount : null,
      currency: typeof json.currency === "string" ? json.currency : null,
    };
  },

  // Erstellt ein echtes monatliches Recurring (POST /v1/subscriptions). off_session +
  // error_if_incomplete: Stripe belastet die hinterlegte Karte sofort; gelingt die
  // Erstzahlung nicht (3DS/Ablehnung), wirft Stripe statt ein incomplete-Abo anzulegen
  // (fail-closed, kein "Abo ohne Zahlung"). Idempotency-Key (tenant+plan): Retry legt
  // nie zwei Abos an. tenant_ref + plan_slug als metadata reisen in die Subscription-
  // Webhook-Events zurueck (Tenant-/Plan-Aufloesung; Audit, KEINE Secrets). Nur
  // subscriptionId + current_period_end + current_period_start (Unix-s) verlassen den
  // Adapter (KEIN Stripe-Objekt).
  async createSubscription({ tenantRef, customerId, priceId, paymentMethodId, idempotencyKey }) {
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({
      customer: customerId,
      "items[0][price]": priceId,
      // default_payment_method: die am Customer gespeicherte Karte wird die Zahlungsquelle
      // der Abo-Rechnungen. OHNE das kann Stripe die erste Rechnung off_session NICHT
      // belasten (am Customer attached != invoice-default) -> mit error_if_incomplete
      // -> HTTP 400 ("Abo passiert nichts"). Spiegelt placeHold (payment_method).
      default_payment_method: paymentMethodId,
      off_session: OFF_SESSION,
      payment_behavior: SUBSCRIPTION_FAILCLOSED_BEHAVIOR,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(SUBSCRIPTIONS_PATH), { method: "POST", headers, body });
    // GP-P1 (Owner-Entscheidung 2026-09-11, Frage 6): Stufe 2 statt 3. Der 402-Koerper
    // dieses Calls trug am 11.09.2026 Name, E-Mail und Anschrift des Kunden und landete
    // ueber err.message in console.error (self-service-routes.js, asyncBilling). Die
    // Diagnose bleibt - als Enum-Anhang code/decline_code/type an derselben Meldung.
    await assertOkClassified(res, "createSubscription");
    const json = await res.json().catch(() => ({}));
    return { subscriptionId: json.id, ...periodFieldsOf(json) };
  },

  // A3-Reconcile + Fix B (0-EUR-Checkout generisch): liest Plan-Slug UND ob die
  // aktuelle Abrechnungsperiode mit 0 EUR abgerechnet wurde (expand[]=latest_invoice).
  // numberSetupFeeExempt=true NUR wenn das Invoice-total ein exaktes 0 ist (typeof-
  // Check: fehlt/kein number -> false, fail-closed, nie raten - G26). Genutzt von
  // activation.js (syncNumberSetupFeeExemption) als EINE Quelle fuer Checkout-Return-
  // UND Webhook-Pfad (s. Design-Begruendung), UND vom bestehenden A3-Backfill-Resolver
  // (liest nur .planSlug, das zusaetzliche Feld ist fuer ihn folgenlos). Nur opake
  // Werte verlassen den Adapter; Secret nur im Header. LIVE owner-smoke (offline
  // ungetestet wie der uebrige Adapter).
  async retrieveSubscription(subscriptionId) {
    const res = await fetch(`${url(SUBSCRIPTIONS_PATH)}/${subscriptionId}?expand[]=latest_invoice`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "retrieveSubscription");
    const json = await res.json().catch(() => ({}));
    const invoiceTotal = json.latest_invoice && json.latest_invoice.total;
    return {
      planSlug: (json.metadata && json.metadata.plan_slug) || null,
      numberSetupFeeExempt: typeof invoiceTotal === "number" ? invoiceTotal === 0 : false,
      // Stripe-Abgleich-Sweep (stripe-reconcile.js): der Abo-STATUS laut Stripe (opaker
      // Stripe-API-Wert, z.B. "active"/"canceled"). Additiv - die Bestandsaufrufer
      // (activation.js, A3-Backfill) lesen nur planSlug/numberSetupFeeExempt und bleiben
      // unberuehrt. Fehlt das Feld in der Antwort -> null (nie raten, G26): der Sweep
      // behandelt null als "nicht beurteilbar" und heilt fail-closed NICHT.
      status: typeof json.status === "string" ? json.status : null,
    };
  },

  // 312k-P2: vermerkt/nimmt eine Kuendigung-zum-Periodenende zurueck (Owner-Entscheidung:
  // Kuendigung wirkt zum Ende des bezahlten Zeitraums). EINE Quelle (G5) fuer beide
  // Richtungen - Stripe kennt keine eigene "cancel"-Operation dafuer, nur denselben PATCH
  // auf die bestehende Subscription (POST /v1/subscriptions/{id}, Stripe-REST-Konvention:
  // Update via POST) mit cancel_at_period_end auf true bzw. false. Fehlerstufe 1 (assertOk,
  // wie cancelHold): anders als placeHold/createSubscription loest dieser Call KEIN Geld
  // aus - keiner der beiden bestehenden klassifizierten Fehlertypen (Authentication-
  // Required/CustomerMissing) entsteht an einem reinen Flag-Patch auf ein bestehendes Abo,
  // und Phase 2 hat noch KEINEN Aufrufer (Route/UI folgt erst P3), der einen Stripe-
  // Fehlercode braucht - der HTTP-Status reicht zum Abbrechen. Der Roh-Fehlerkoerper wird
  // bewusst NICHT gelesen (kein assertOkWithDetail): das haelt jede Fehlermeldung auf
  // Status+Op begrenzt, ohne jeden Fall einzeln pruefen zu muessen, ob der Provider-Body
  // PII traegt (Regel 4). subscriptionId + der GESETZTE cancel_at_period_end-Wert + die
  // Periodenfelder verlassen den Adapter - KEIN Stripe-Objekt (Muster createSubscription).
  async scheduleCancellation({ subscriptionId, idempotencyKey }) {
    return await patchCancelAtPeriodEnd(subscriptionId, true, idempotencyKey);
  },
  async unscheduleCancellation({ subscriptionId, idempotencyKey }) {
    return await patchCancelAtPeriodEnd(subscriptionId, false, idempotencyKey);
  },
};

// 312k-P2: geteilte Implementierung (G5) fuer scheduleCancellation/unscheduleCancellation -
// beide sind DERSELBE Stripe-Call mit umgekehrtem cancel_at_period_end-Wert. Der GESETZTE
// Wert (nicht Stripes Antwort) bestimmt cancelAtPeriodEnd im Ergebnis: Stripe spiegelt das
// gesendete Flag im Response-Body, ein zusaetzliches Parsen daraus waere ein zweiter,
// redundanter Vertrag mit dem Provider (nie raten, G26 - Muster AUTHENTICATION_REQUIRED_CODE-
// Kommentar). periodFieldsOf liest dieselbe Normalisierung wie ueberall sonst im Adapter.
async function patchCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd, idempotencyKey) {
  const headers = idempotentHeaders(idempotencyKey);
  const body = new URLSearchParams({ cancel_at_period_end: String(cancelAtPeriodEnd) });
  const res = await fetch(`${url(SUBSCRIPTIONS_PATH)}/${subscriptionId}`, {
    method: "POST",
    headers,
    body,
  });
  assertOk(res, cancelAtPeriodEnd ? "scheduleCancellation" : "unscheduleCancellation");
  const json = await res.json().catch(() => ({}));
  return { subscriptionId: json.id ?? subscriptionId, cancelAtPeriodEnd, ...periodFieldsOf(json) };
}
