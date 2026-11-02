import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { config } from "../../src/config.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { SESSION_COOKIE_NAME } from "../../src/web-auth.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeStripeStub } from "../helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist, fristSignal } from "../gemeinsam/antwortfrist.mjs";
import { antwortetNie, mitKurzerFrist } from "../gemeinsam/kurze-antwortfrist.mjs";

const ERWARTETER_FEHLER = "Abbruch beim Lesen des Antwortkörpers kommt nicht als TimeoutError an";
const KUENDIGUNG_OHNE_WURF = "Kündigung nach Status 200 darf bei ausbleibendem Körper nicht werfen";
const withStripeStub = makeStripeStub(config, "sk_test_koerper");
const echtesFetch = globalThis.fetch;

const TENANT = "t_dev-user";
const KUNDE = "cus_koerper";
const KARTE = "pm_koerper";
const ABO = "sub_koerper";
const SITZUNG = "cs_koerper";
const CHECKOUT_ADRESSE = `https://checkout.stripe.test/${SITZUNG}`;
const PERIODENENDE = 1893456000;
const SUBSCRIBE = "/api/self-service/billing/subscribe";
const SETUP_CHECKOUT = "/api/self-service/billing/setup-checkout";
const RUECKKEHR = `/api/self-service/billing/return?session_id=${SITZUNG}`;
const BILLING_UNAVAILABLE = { error: "billing_unavailable" };

const BASIS_KONFIGURATION = webLoginBasisKonfiguration("https://api.workos.test");
const KONFIGURATION = {
  ...BASIS_KONFIGURATION,
  tenancy: { selfServiceEnabled: true, multiTenant: true },
  auth: { ...BASIS_KONFIGURATION.auth, devLoginEnabled: true },
  billing: {
    paymentEnabled: true,
    paymentCurrency: "eur",
    stripeStarterPriceId: "price_starter",
    stripeBusinessPriceId: "price_business",
    stripeCustomerRetryDelayMs: 0,
  },
  provisioning: { ...BASIS_KONFIGURATION.provisioning, provisioningRetryMaxAttempts: 3 },
};

const alsJson = (inhalt, status = 200) => () =>
  new Response(JSON.stringify(inhalt), { status, headers: { "content-type": "application/json" } });

const STRIPE_ABO = {
  id: ABO,
  current_period_end: PERIODENENDE,
  default_payment_method: { id: KARTE, type: "card" },
  metadata: { plan_slug: "starter" },
};

const STRIPE_REGULAER = {
  "POST /v1/subscriptions": alsJson(STRIPE_ABO),
  "GET /v1/subscriptions/sub_koerper": alsJson({ ...STRIPE_ABO, status: "active" }),
  "POST /v1/subscriptions/sub_koerper": alsJson(STRIPE_ABO),
  "POST /v1/checkout/sessions": alsJson({ id: SITZUNG, url: CHECKOUT_ADRESSE }),
  "GET /v1/checkout/sessions/cs_koerper": alsJson({
    customer: KUNDE,
    setup_intent: { payment_method: { id: KARTE, type: "card" } },
    subscription: STRIPE_ABO,
  }),
};

const koerperBleibtAus = (url, init) => ({ ok: true, status: 200, json: () => antwortetNie(url, init) });
const koerperReisstAb = () => ({
  ok: true,
  status: 200,
  json: () => Promise.reject(new TypeError("terminated")),
});
const koerperOhneJson = () => new Response("{kein json", { status: 200 });

function stripeFetch(abweichungen) {
  const antworten = { ...STRIPE_REGULAER, ...abweichungen };
  return async (url, init = {}) => {
    if (!String(url).startsWith(config.billing.stripeApiBase))
      return echtesFetch(url, { ...init, signal: AbortSignal.any([fristSignal(), ...(init.signal ? [init.signal] : [])]) });
    return antworten[`${init.method} ${new URL(String(url)).pathname}`](url, init);
  };
}

function sitzungsCookie(antwort) {
  const paare = antwort.headers.getSetCookie().map((eintrag) => eintrag.split(";")[0]);
  return paare.find((paar) => paar.startsWith(`${SESSION_COOKIE_NAME}=`));
}

async function starteMitStripe(abweichungen, ablauf) {
  return withStripeStub(stripeFetch(abweichungen), async () => {
    const { store, runner } = await makePgTestStore();
    const app = express();
    app.use(express.json());
    const verdrahtet = await wireWebLogin({
      app,
      config: KONFIGURATION,
      store,
      audit: () => {},
      provision: async () => ({ reason: "queued" }),
      createPortalRunner: () => runner,
      stripeWebhookPath: "/webhooks/stripe",
      appPath: "/app",
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const anmeldung = await abrufMitFrist(`${base}/auth/dev-login`, { method: "POST", redirect: "manual" });
      store.setTenantStripe(TENANT, { customerId: KUNDE, paymentMethodId: KARTE });
      return await ablauf({ store, accounts: verdrahtet.accounts, base, cookie: sitzungsCookie(anmeldung) });
    } finally {
      server.close();
    }
  });
}

async function anfrage(s, pfad, body) {
  const laufend = abrufMitFrist(`${s.base}${pfad}`, {
    method: body ? "POST" : "GET",
    redirect: "manual",
    headers: { Cookie: s.cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let antwort;
  await mitKurzerFrist(async () => {
    antwort = await laufend;
  });
  const text = await antwort.text();
  const istJson = (antwort.headers.get("content-type") ?? "").includes("json");
  return { status: antwort.status, ort: antwort.headers.get("location"), inhalt: istJson ? JSON.parse(text) : null };
}

async function mitAbschluss(s, pfad, body) {
  const antwort = await anfrage(s, pfad, body);
  const zustand = await anfrage(s, "/api/self-service/billing/status");
  return { ...antwort, kontoStatus: zustand.inhalt.status, abo: s.store.tenantSubscription(TENANT) };
}

const abonniereMitKoerper = (koerper) =>
  starteMitStripe({ "POST /v1/subscriptions": koerper }, (s) => mitAbschluss(s, SUBSCRIBE, { plan: "starter" }));

function pruefeAboAbgelehnt(ergebnis, meldung) {
  assert.equal(ergebnis.status, 502, meldung);
  assert.deepEqual(ergebnis.inhalt, BILLING_UNAVAILABLE);
  assert.equal(ergebnis.kontoStatus, "suspended");
}

async function kuendigungMitAusbleibendemKoerper(pfad, vorherGekuendigt) {
  return starteMitStripe({ "POST /v1/subscriptions/sub_koerper": koerperBleibtAus }, async (s) => {
    await s.accounts.setStatus(TENANT, "active");
    s.store.setTenantSubscription(TENANT, {
      subscriptionId: ABO,
      planSlug: "starter",
      currentPeriodEnd: PERIODENENDE,
      cancelAtPeriodEnd: vorherGekuendigt,
    });
    return anfrage(s, pfad, {});
  });
}

test("Stripe-Körperfrist: bleibt der Körper der Abo-Anlage aus, antwortet subscribe mit 502 und schaltet den Mandanten nicht frei", async () => {
  pruefeAboAbgelehnt(await abonniereMitKoerper(koerperBleibtAus), ERWARTETER_FEHLER);
});

test("Stripe-Körperfrist: reißt die Verbindung im Körper der Abo-Anlage ab, antwortet subscribe mit 502 und schaltet den Mandanten nicht frei", async () => {
  pruefeAboAbgelehnt(await abonniereMitKoerper(koerperReisstAb), ERWARTETER_FEHLER);
});

test("Stripe-Körperfrist: bleibt der Körper der Checkout-Sitzung aus, antwortet setup-checkout mit 502 statt einer leeren Adresse", async () => {
  const ergebnis = await starteMitStripe({ "POST /v1/checkout/sessions": koerperBleibtAus }, (s) =>
    anfrage(s, SETUP_CHECKOUT, { plan: "starter" }),
  );
  assert.equal(ergebnis.status, 502, ERWARTETER_FEHLER);
  assert.deepEqual(ergebnis.inhalt, BILLING_UNAVAILABLE);
});

test("[NIE1] ausbleibender oder abgerissener Körper der Abo-Anlage: 502, keine Freischaltung, keine Abo-Referenz", async () => {
  for (const koerper of [koerperBleibtAus, koerperReisstAb]) {
    const ergebnis = await abonniereMitKoerper(koerper);
    pruefeAboAbgelehnt(ergebnis, `Abo-Anlage ohne Körper darf nicht freischalten (${koerper.name})`);
    assert.equal(ergebnis.abo.subscriptionId ?? null, null);
  }
});

test("[NIE2] rechtzeitige 200-Antwort mit JSON: subscribe, setup-checkout und Rückkehr liefern dieselben Ergebnisse", async () => {
  const abo = await starteMitStripe({}, (s) => mitAbschluss(s, SUBSCRIBE, { plan: "starter" }));
  assert.equal(abo.status, 200);
  assert.deepEqual(abo.inhalt, { plan: "starter", currentPeriodEnd: PERIODENENDE });
  assert.equal(abo.kontoStatus, "active");
  assert.equal(abo.abo.subscriptionId, ABO);

  const checkout = await starteMitStripe({}, (s) => anfrage(s, SETUP_CHECKOUT, { plan: "starter" }));
  assert.deepEqual([checkout.status, checkout.inhalt], [200, { url: CHECKOUT_ADRESSE }]);

  const rueckkehr = await starteMitStripe({}, (s) => mitAbschluss(s, `${RUECKKEHR}&plan=starter`));
  assert.deepEqual([rueckkehr.status, rueckkehr.ort], [302, "/app?sub=ok"]);
  assert.equal(rueckkehr.abo.subscriptionId, ABO);

  const karte = await starteMitStripe({}, (s) => anfrage(s, RUECKKEHR));
  assert.deepEqual([karte.status, karte.ort], [302, "/app?card=ok"]);
});

test("[NIE3] 200-Antwort ohne gültiges JSON: Routen liefern wie heute ein leeres Ergebnis", async () => {
  const abo = await abonniereMitKoerper(koerperOhneJson);
  assert.deepEqual([abo.status, abo.inhalt], [200, { plan: "starter" }]);

  const checkout = await starteMitStripe({ "POST /v1/checkout/sessions": koerperOhneJson }, (s) =>
    anfrage(s, SETUP_CHECKOUT, { plan: "starter" }),
  );
  assert.deepEqual([checkout.status, checkout.inhalt], [200, {}]);
});

test("[NIE4] Ablehnung der Abo-Anlage mit card_declined: Route antwortet mit demselben Status und Fehlertext", async () => {
  const ablehnung = alsJson(
    { error: { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined." } },
    402,
  );
  const ergebnis = await abonniereMitKoerper(ablehnung);
  assert.deepEqual([ergebnis.status, ergebnis.inhalt, ergebnis.kontoStatus], [502, BILLING_UNAVAILABLE, "suspended"]);
});

test("[NIE5] Stripe-Körperfrist: bleibt der Körper von Kündigen nach Status 200 aus, antwortet cancel wie heute mit Erfolg", async () => {
  const ergebnis = await kuendigungMitAusbleibendemKoerper("/api/self-service/billing/cancel", false);
  assert.equal(ergebnis.status, 200, KUENDIGUNG_OHNE_WURF);
  assert.deepEqual(ergebnis.inhalt, { cancelAtPeriodEnd: true, currentPeriodEnd: PERIODENENDE });
});

test("[NIE5] Stripe-Körperfrist: bleibt der Körper von Fortsetzen nach Status 200 aus, antwortet resume wie heute mit Erfolg", async () => {
  const ergebnis = await kuendigungMitAusbleibendemKoerper("/api/self-service/billing/resume", true);
  assert.equal(ergebnis.status, 200, KUENDIGUNG_OHNE_WURF);
  assert.deepEqual(ergebnis.inhalt, { cancelAtPeriodEnd: false, currentPeriodEnd: PERIODENENDE });
});
