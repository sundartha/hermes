// PAY-19 (Katalog: tasks/i18n-tests/07-geld-und-waehrung.md, Abschnitt "PAY-19";
// Schwere-Einordnung: PLAN-SECURITY.md Rubrik "SCA-DEADEND").
//
// SOLL-Gate der SCA-Achse. Verlangt die Bank eines Kunden bei einer off-session-Belastung
// eine Authentifizierung (3-D Secure), muss der Aufrufer das ERKENNEN koennen - sonst
// kann er den Kunden weder benachrichtigen noch ihm eine Bestaetigung anbieten, und der
// Vorgang endet als stiller Fehlschlag.
//
// FORMULIERT AM BEOBACHTBAREN ERGEBNIS, nicht an einer Signatur (R1/R2 der kanonischen
// Liste): der Fix darf einen eigenen Fehlertyp einfuehren (Praezedenz im Bestand:
// CustomerMissingError, src/billing/stripe.js:126), ein Feld am Fehler setzen oder ein
// typisiertes Ergebnis zurueckgeben. Der Test schreibt den WEG nicht vor, nur dass die
// beiden Faelle am Ergebnis auseinanderzuhalten sind.
//
// WARUM NICHT UEBER DIE MELDUNG: beide Faelle sind HTTP 402. assertOk (:92-94) baut daraus
// denselben Text; assertOkWithDetail (:114-128) haengt den Roh-Body an, sodass sich die
// Texte zwar unterscheiden - aber nur als unstrukturierter Freitext. Ein Aufrufer muesste
// darin nach Teilzeichenketten suchen. Deshalb prueft dieser Test auf ein MASCHINEN-
// LESBARES Unterscheidungsmerkmal (Fehlertyp oder eigene Eigenschaft), nicht auf .message.
//
// Rein und offline: global.fetch wird ueber makeStripeStub ersetzt (Muster
// test/gap-05-number-hold.test.js), kein Netz, kein Stripe-Konto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makeStripeStub } from "./helpers.js";

const withStripeStub = makeStripeStub(config, "sk_test_pay19");

// Stripe antwortet auf BEIDE Faelle mit 402 - das ist der Kern des Problems.
const DECLINED_HTTP_STATUS = 402;

// Echter Antwortkoerper, am 2026-07-27 gegen Stripe TEST gemessen (Test-Token
// pm_card_authenticationRequired): die Bank verlangt eine Authentifizierung. Bemerkenswert
// und im Feld next_action festgehalten - Stripe liefert KEINES, es gibt also nichts, wohin
// man umleiten koennte; die Erholung muss eine neue on-session-Bestaetigung sein.
const SCA_ERROR_BODY = {
  error: {
    type: "card_error",
    code: "authentication_required",
    decline_code: "authentication_required",
    message: "Your card was declined. This transaction requires authentication.",
    payment_intent: { status: "requires_payment_method" },
  },
};

// Gewoehnliche Ablehnung ohne Authentifizierungs-Wunsch - der Fall, von dem sich der obere
// unterscheiden MUSS. Hier ist der Kunde wirklich am Ende; oben nicht.
const GENERIC_DECLINE_BODY = {
  error: {
    type: "card_error",
    code: "card_declined",
    decline_code: "generic_decline",
    message: "Your card was declined.",
  },
};

function declineResponse(body) {
  return async () => ({
    ok: false,
    status: DECLINED_HTTP_STATUS,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

// Das maschinenlesbare Profil eines Fehlers: Typname plus alle EIGENEN Eigenschaften.
// .message bleibt bewusst draussen (s. Datei-Kopf) - ein Freitext ist kein Vertrag.
function machineReadableShape(err) {
  return JSON.stringify({
    type: err?.constructor?.name ?? typeof err,
    own: Object.fromEntries(Object.entries(err ?? {})),
  });
}

// Faengt den Fehler eines Geld-Aufrufs ein. Bleibt der Aufruf erfolgreich, ist das selbst
// ein Befund (eine abgelehnte Karte darf nie als Erfolg durchgehen) - dann traegt der
// Rueckgabewert die Aussage.
async function shapeOfFailure(body, callBilling) {
  return withStripeStub(declineResponse(body), async () => {
    try {
      await callBilling();
      return "KEIN FEHLER - der abgelehnte Aufruf lief als Erfolg durch";
    } catch (err) {
      return machineReadableShape(err);
    }
  });
}

const HOLD_ARGS = {
  tenantRef: "t_pay19",
  amountCents: 300,
  currency: "eur",
  customerId: "cus_pay19",
  paymentMethodId: "pm_pay19",
  idempotencyKey: "pay19-hold",
};

const SUBSCRIPTION_ARGS = {
  tenantRef: "t_pay19",
  customerId: "cus_pay19",
  priceId: "price_pay19",
  paymentMethodId: "pm_pay19",
  idempotencyKey: "pay19-sub",
};

test("PAY-19 (SOLL, rot) - eine Reserve, die an 3-D Secure scheitert, ist von einer echten Ablehnung unterscheidbar", async () => {
  const sca = await shapeOfFailure(SCA_ERROR_BODY, () => stripeBilling.placeHold(HOLD_ARGS));
  const generic = await shapeOfFailure(GENERIC_DECLINE_BODY, () => stripeBilling.placeHold(HOLD_ARGS));

  assert.notEqual(
    sca,
    generic,
    "SOLL: placeHold muss den Authentifizierungs-Fall maschinenlesbar von einer echten Ablehnung " +
      `trennen (heute identisch: ${sca}). Ohne das kann der Aufrufer den Kunden weder ` +
      "benachrichtigen noch ihm eine Bestaetigung anbieten - die Nummer landet still auf failed.",
  );
});

test("PAY-19 (SOLL, rot) - ein Abo, das an 3-D Secure scheitert, ist von einer echten Ablehnung unterscheidbar", async () => {
  const sca = await shapeOfFailure(SCA_ERROR_BODY, () => stripeBilling.createSubscription(SUBSCRIPTION_ARGS));
  const generic = await shapeOfFailure(GENERIC_DECLINE_BODY, () =>
    stripeBilling.createSubscription(SUBSCRIPTION_ARGS),
  );

  assert.notEqual(
    sca,
    generic,
    "SOLL: createSubscription muss den Authentifizierungs-Fall maschinenlesbar von einer echten " +
      `Ablehnung trennen (heute identisch: ${sca}). Heute wirft payment_behavior=error_if_incomplete ` +
      "genau die Information weg, die die Erholung traegt - der Kunde kann dann GAR NICHT abonnieren.",
  );
});
