// PROV-402-DIAG — der Grund einer gescheiterten Einrichtungsgebuehr muss im Log UND im
// persistierten provisioning_job.last_error stehen.
//
// Ausgangsfall (live, 2026-09-11): der Hold der einmaligen Nummern-Einrichtungsgebuehr
// scheiterte mit HTTP 402. Im Log und in der Datenbank stand danach ausschliesslich
// "Stripe placeHold fehlgeschlagen: HTTP 402". Ob die Bank ablehnte, das Guthaben nicht
// reichte, 3-D Secure fehlte oder die Karte abgelaufen war, war NICHT rekonstruierbar -
// genau diese Unterscheidung entscheidet aber, ob ein Retry helfen kann. (Der echte
// Grund liess sich nur finden, weil ein FRUEHERER Aufruf zufaellig ueber eine Fehlergrenze
// lief, die den Roh-Body anhaengt: decline_code=insufficient_funds.)
//
// Geprueft wird am beobachtbaren Ergebnis: der geworfene Fehler traegt die STABILEN
// Stripe-Token maschinenlesbar, und providerErrorDetail formt daraus die Log-/
// Persistenz-Zeile. Die .message bleibt unveraendert (sie ist anderswo gepinnt).
//
// Rein und offline: global.fetch wird ueber makeStripeStub ersetzt (Muster
// test/pay-19-sca-authentication-required.test.js), kein Netz, kein Stripe-Konto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { providerErrorDetail } from "../src/billing/errors.js";
import { makeStripeStub } from "./helpers.js";

const withStripeStub = makeStripeStub(config, "sk_test_prov402");
const DECLINED_HTTP_STATUS = 402;
const HOLD_AMOUNT_CENTS = 500;

// Der real gemessene Koerper aus dem Ausgangsfall (Gateway-Log 2026-09-11 07:49:24,
// auf PII reduziert): die Bank lehnte wegen fehlender Deckung ab.
const INSUFFICIENT_FUNDS_BODY = {
  error: {
    type: "card_error",
    code: "payment_method_provider_decline",
    decline_code: "insufficient_funds",
    message: "The customer has insufficient funds with the payment provider.",
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

function placeHold() {
  return stripeBilling.placeHold({
    tenantRef: "t_diag",
    amountCents: HOLD_AMOUNT_CENTS,
    currency: "eur",
    customerId: "cus_diag",
    paymentMethodId: "pm_diag_0123456789",
    idempotencyKey: "hold_num_diag",
  });
}

async function captureError(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return null;
}

test("placeHold-402: der Fehler traegt Stripe-code UND decline_code maschinenlesbar", async () => {
  const err = await withStripeStub(declineResponse(INSUFFICIENT_FUNDS_BODY), () =>
    captureError(placeHold),
  );
  assert.ok(err, "placeHold muss bei 402 werfen");
  assert.equal(err.providerCode, "payment_method_provider_decline");
  assert.equal(err.declineCode, "insufficient_funds");
});

test("placeHold-402: die .message bleibt unveraendert (anderswo gepinnt, kein Roh-Body)", async () => {
  const err = await withStripeStub(declineResponse(INSUFFICIENT_FUNDS_BODY), () =>
    captureError(placeHold),
  );
  assert.equal(err.message, "Stripe placeHold fehlgeschlagen: HTTP 402");
  // Regel 4: der Provider-Rohkoerper (Adresse/E-Mail des Kunden) bleibt aussen vor.
  assert.ok(!err.message.includes("insufficient funds"));
});

// Die Zeile, die Ops und jede spaetere Sitzung tatsaechlich liest (Log + persistierter
// provisioning_job.last_error). Sie haengt an der Message, ersetzt sie nicht.
test("providerErrorDetail: formt die Diagnose-Zeile aus den beiden Token", async () => {
  const err = await withStripeStub(declineResponse(INSUFFICIENT_FUNDS_BODY), () =>
    captureError(placeHold),
  );
  assert.equal(
    `${err.message}${providerErrorDetail(err)}`,
    "Stripe placeHold fehlgeschlagen: HTTP 402 code=payment_method_provider_decline decline=insufficient_funds",
  );
});

test("providerErrorDetail: ohne Provider-Token leer -> Bestandszeile byte-identisch", () => {
  assert.equal(providerErrorDetail(new Error("Netzfehler")), "");
  assert.equal(providerErrorDetail(null), "");
  assert.equal(providerErrorDetail(undefined), "");
});

// Ein Fehler mit code, aber ohne decline_code (z.B. resource_missing) darf keine leere
// "decline="-Haelfte schreiben - die Zeile bleibt sonst dauerhaft irrefuehrend.
test("providerErrorDetail: nur code -> nur code im Text", () => {
  const err = Object.assign(new Error("x"), { providerCode: "resource_missing" });
  assert.equal(providerErrorDetail(err), " code=resource_missing");
});
