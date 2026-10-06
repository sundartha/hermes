import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makeStripeStub } from "./helpers.js";

const withStripeStub = makeStripeStub(config, "sk_test_pay19");

const DECLINED_HTTP_STATUS = 402;

const SCA_ERROR_BODY = {
  error: {
    type: "card_error",
    code: "authentication_required",
    decline_code: "authentication_required",
    message: "Your card was declined. This transaction requires authentication.",
    payment_intent: { status: "requires_payment_method" },
  },
};

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

function machineReadableShape(err) {
  return JSON.stringify({
    type: err?.constructor?.name ?? typeof err,
    own: Object.fromEntries(Object.entries(err ?? {})),
  });
}

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
