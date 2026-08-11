// 312k-P2 (Kuendigungsbutton nach Paragraph 312k BGB, Phase 2 - das Abo bei Stripe
// tatsaechlich beenden koennen): stripeBilling.scheduleCancellation/unscheduleCancellation
// (src/billing/stripe.js) gegen ein gemocktes global fetch (kein echter Netz-Call, F.I.R.S.T.,
// Muster stripe-cancel-hold-adapter.test.js/billing-stripe-idempotent-headers.test.js). Owner-
// Entscheidung: Kuendigung wirkt zum Ende des bezahlten Zeitraums - beide Methoden sind
// DERSELBE Stripe-Call (POST /v1/subscriptions/{id}) mit umgekehrtem cancel_at_period_end.
//
// Deckt: (1) Vormerken -> richtiger Pfad/Feld, geprueft am abgefangenen HTTP-Aufruf (nicht an
// einem Mock der eigenen Funktion); (2) Zuruecknehmen -> umgekehrter Wert; (3) derselbe
// Idempotenz-Schluessel zweimal -> EIN Vorgang (identischer Header, Stripe liefert dieselbe
// Antwort zurueck - der Adapter reicht das transparent durch); (4) Fehlerpfad -> klassifizierter
// Abbruch, und die Fehlermeldung traegt WEDER den Idempotenz-Schluessel NOCH eine Kundennummer
// NOCH den rohen Stripe-Fehlerkoerper (Regel 4: kein PII/Secrets im Log - assertOk (Stufe 1)
// liest den Fehlerkoerper gar nicht erst).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makeStripeStub } from "./helpers.js";

const SECRET = "sk_test_312k_p2_cancel_probe";
const withStripeStub = makeStripeStub(config, SECRET);

const SUBSCRIPTION_ID = "sub_312k_p2";
const CURRENT_PERIOD_END = 1_800_000_000;

// Stripe spiegelt das gesendete cancel_at_period_end-Flag in der Antwort (das eigentliche
// Verhalten, das der Adapter dokumentiert - s. stripe.js patchCancelAtPeriodEnd-Kommentar).
function subscriptionResponse(cancelAtPeriodEnd) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: SUBSCRIPTION_ID,
      cancel_at_period_end: cancelAtPeriodEnd,
      items: { data: [{ current_period_end: CURRENT_PERIOD_END, current_period_start: 1_700_000_000 }] },
    }),
  };
}

test("scheduleCancellation: POST /v1/subscriptions/<id>, cancel_at_period_end=true im Body (kein Mock der eigenen Funktion)", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return subscriptionResponse(true);
    },
    () =>
      stripeBilling.scheduleCancellation({
        subscriptionId: SUBSCRIPTION_ID,
        idempotencyKey: "cancel_sched_" + SUBSCRIPTION_ID,
      }),
  );
  assert.ok(captured.url.endsWith(`/v1/subscriptions/${SUBSCRIPTION_ID}`), "URL traegt die Subscription-id, kein Sub-Pfad");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(captured.opts.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(
    new URLSearchParams(String(captured.opts.body)).get("cancel_at_period_end"),
    "true",
    "das RICHTIGE Feld traegt den RICHTIGEN Wert im tatsaechlich abgeschickten Request-Body",
  );
  // Rueckgabe: Zustand + Termin aus EINER Antwort, kein erneutes retrieveSubscription noetig.
  assert.deepEqual(result, {
    subscriptionId: SUBSCRIPTION_ID,
    cancelAtPeriodEnd: true,
    currentPeriodStart: 1_700_000_000,
    currentPeriodEnd: CURRENT_PERIOD_END,
  });
});

test("unscheduleCancellation: DERSELBE Endpunkt, cancel_at_period_end=false (umgekehrter Wert)", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return subscriptionResponse(false);
    },
    () =>
      stripeBilling.unscheduleCancellation({
        subscriptionId: SUBSCRIPTION_ID,
        idempotencyKey: "cancel_unsched_" + SUBSCRIPTION_ID,
      }),
  );
  assert.ok(captured.url.endsWith(`/v1/subscriptions/${SUBSCRIPTION_ID}`));
  assert.equal(captured.opts.method, "POST");
  assert.equal(
    new URLSearchParams(String(captured.opts.body)).get("cancel_at_period_end"),
    "false",
    "die Ruecknahme ist DERSELBE Call, NUR der Wert ist umgekehrt",
  );
  assert.equal(result.cancelAtPeriodEnd, false);
  assert.equal(result.subscriptionId, SUBSCRIPTION_ID);
});

test("scheduleCancellation: derselbe Idempotenz-Schluessel zweimal (Doppelklick) -> identischer Header, EIN Vorgang", async () => {
  const capturedHeaders = [];
  const KEY = "cancel_sched_" + SUBSCRIPTION_ID;
  const call = () =>
    stripeBilling.scheduleCancellation({ subscriptionId: SUBSCRIPTION_ID, idempotencyKey: KEY });
  const [first, second] = await withStripeStub(
    async (url, opts) => {
      capturedHeaders.push(opts.headers["Idempotency-Key"]);
      // Stripe erkennt den Schluessel wieder und liefert BEIDE Male dieselbe Antwort
      // (server-seitige Dedup - der Adapter reicht sie transparent durch).
      return subscriptionResponse(true);
    },
    async () => [await call(), await call()],
  );
  assert.equal(capturedHeaders.length, 2, "beide Doppelklick-Requests erreichen den Adapter");
  assert.equal(capturedHeaders[0], KEY);
  assert.equal(capturedHeaders[1], KEY, "derselbe Schluessel bei einem Retry -> Stripe haelt nie doppelt");
  assert.deepEqual(first, second, "beide Aufrufe liefern denselben Zustand -> EIN Vorgang aus Aufrufersicht");
});

test("scheduleCancellation vs. unscheduleCancellation: unterschiedliche Richtung -> unterschiedlicher Schluessel (spaeterer echter Gegenteil-Vorgang geht durch)", async () => {
  const headers = [];
  await withStripeStub(
    async (url, opts) => {
      headers.push(opts.headers["Idempotency-Key"]);
      return subscriptionResponse(true);
    },
    () =>
      stripeBilling.scheduleCancellation({
        subscriptionId: SUBSCRIPTION_ID,
        idempotencyKey: "cancel_sched_" + SUBSCRIPTION_ID,
      }),
  );
  await withStripeStub(
    async (url, opts) => {
      headers.push(opts.headers["Idempotency-Key"]);
      return subscriptionResponse(false);
    },
    () =>
      stripeBilling.unscheduleCancellation({
        subscriptionId: SUBSCRIPTION_ID,
        idempotencyKey: "cancel_unsched_" + SUBSCRIPTION_ID,
      }),
  );
  assert.notEqual(headers[0], headers[1], "Richtung ist Teil des Schluessels - kein falsches Zusammenfallen");
});

// Fehlerpfad: Stripe antwortet mit einem Fehler, dessen Koerper (realistisch) eine Kunden-
// Telefonnummer/PII enthalten KOENNTE (z.B. in einer decline-Message) - der Test beweist, dass
// weder der Idempotenz-Schluessel noch diese PII noch der rohe Koerper je die Fehlermeldung
// erreichen (assertOk/Stufe 1 liest den Koerper gar nicht erst, s. stripe.js-Kommentar).
const LEAKY_ERROR_BODY = {
  error: {
    type: "invalid_request_error",
    message: "No such subscription for customer with phone +4915799990001 (cus_secret_ref)",
  },
};
const SECRET_IDEMPOTENCY_KEY = "cancel_sched_leak_probe_do_not_leak";

test("scheduleCancellation: Stripe-Fehler -> Abbruch, Fehlermeldung OHNE Schluessel/Kundennummer/Rohantwort", async () => {
  await withStripeStub(
    async () => ({
      ok: false,
      status: 404,
      json: async () => LEAKY_ERROR_BODY,
      text: async () => JSON.stringify(LEAKY_ERROR_BODY),
    }),
    () =>
      assert.rejects(
        () =>
          stripeBilling.scheduleCancellation({
            subscriptionId: SUBSCRIPTION_ID,
            idempotencyKey: SECRET_IDEMPOTENCY_KEY,
          }),
        (err) => {
          assert.match(err.message, /HTTP 404/, "der Aufrufer bekommt den Status zum Abbrechen");
          assert.doesNotMatch(err.message, /cancel_sched_leak_probe/, "der Idempotenz-Schluessel darf nicht leaken");
          assert.doesNotMatch(err.message, /\+4915799990001/, "keine Kundennummer im Log");
          assert.doesNotMatch(err.message, /cus_secret_ref/, "keine Kundenreferenz im Log");
          assert.doesNotMatch(err.message, /No such subscription/, "die rohe Stripe-Fehlermeldung (PII-Risiko) darf nicht leaken");
          assert.doesNotMatch(err.message, /sk_test|Bearer/, "Secret-Key/Bearer darf nicht leaken");
          return true;
        },
      ),
  );
});

test("unscheduleCancellation: Stripe-Fehler -> derselbe Log-Schutz (Gegen-Fall)", async () => {
  await withStripeStub(
    async () => ({
      ok: false,
      status: 404,
      json: async () => LEAKY_ERROR_BODY,
      text: async () => JSON.stringify(LEAKY_ERROR_BODY),
    }),
    () =>
      assert.rejects(
        () =>
          stripeBilling.unscheduleCancellation({
            subscriptionId: SUBSCRIPTION_ID,
            idempotencyKey: SECRET_IDEMPOTENCY_KEY,
          }),
        (err) => {
          assert.match(err.message, /HTTP 404/);
          assert.doesNotMatch(err.message, /cancel_sched_leak_probe/);
          assert.doesNotMatch(err.message, /\+4915799990001/);
          return true;
        },
      ),
  );
});
