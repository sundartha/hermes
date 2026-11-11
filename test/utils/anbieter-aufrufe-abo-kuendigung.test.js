import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { config } from "../../src/config.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeStripeStub } from "../helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist, fristSignal } from "../gemeinsam/antwortfrist.mjs";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { dauerPunkte, mitTelemetrie, zaehlerPunkte } from "../gemeinsam/anbieter-messung-export.mjs";

const HTTP_ZU_VIELE = 429;
const HTTP_FEHLER = 500;
const HTTP_CREATED = 201;
const WORKOS = "https://api.workos.test";
const BREVO_ORIGIN = "https://api.brevo.com";
const STRIPE_BASIS = "https://api.stripe.test";
const TENANT = "t_dev-user";
const KUNDE = "cus_abo";
const KARTE = "pm_abo";
const SITZUNG = "cs_abo";
const ABO = "sub_abo";
const FEHLERTEXT_MIT_429 = "interner Fehler 429 fuer kunde-abo@example.test";

const echtesFetch = globalThis.fetch;
const attrappe = { stripe: null };

globalThis.fetch = async (url, init = {}) => {
  const ziel = new URL(String(url));
  if (ziel.origin === STRIPE_BASIS) return attrappe.stripe(ziel.pathname, init.method ?? "GET");
  if (ziel.origin === BREVO_ORIGIN) return Response.json({}, { status: HTTP_CREATED });
  return echtesFetch(url, {
    ...init,
    signal: AbortSignal.any([fristSignal(), ...(init.signal ? [init.signal] : [])]),
  });
};

const mitStripe = makeStripeStub(config, "sk_test_messung_abo");

const basis = webLoginBasisKonfiguration(WORKOS);
const KONFIGURATION = {
  ...basis,
  tenancy: { selfServiceEnabled: true, multiTenant: true },
  auth: { ...basis.auth, devLoginEnabled: true, workosManagementApiKey: "" },
  billing: {
    paymentEnabled: true,
    stripeWebhookSecret: "whsec_messung",
    stripeStarterPriceId: "price_starter",
    stripeBusinessPriceId: "price_business",
    paymentCurrency: "eur",
    stripeCustomerRetryDelayMs: 0,
    numberSetupFeeCents: 0,
  },
  provisioning: { releaseGraceMs: 0, provisioningCountry: "DE" },
  mail: { smtpHost: "", brevoApiKey: "brevo-messung", mailFrom: "absender@example.test" },
};

const ERFOLG = {
  "POST /v1/customers": { id: KUNDE },
  "POST /v1/checkout/sessions": { id: SITZUNG, url: "https://checkout.stripe.test/cs_abo" },
  [`GET /v1/checkout/sessions/${SITZUNG}`]: {
    customer: KUNDE,
    setup_intent: { payment_method: { id: KARTE, type: "card" } },
    subscription: {
      id: ABO,
      default_payment_method: { id: KARTE, type: "card" },
      metadata: { plan_slug: "starter" },
    },
  },
  "POST /v1/subscriptions": { id: ABO },
  [`POST /v1/subscriptions/${ABO}`]: { id: ABO },
};

const VORGAENGE = [
  {
    vorgang: "checkout-abo-anlegen",
    ziel: "POST /v1/checkout/sessions",
    vorbereitung: {},
    aufruf: ["POST", "/api/self-service/billing/setup-checkout", { plan: "starter" }],
  },
  {
    vorgang: "checkout-abo-lesen",
    ziel: `GET /v1/checkout/sessions/${SITZUNG}`,
    vorbereitung: { stripe: { customerId: KUNDE } },
    aufruf: ["GET", `/api/self-service/billing/return?session_id=${SITZUNG}&plan=starter`],
  },
  {
    vorgang: "checkout-karte-lesen",
    ziel: `GET /v1/checkout/sessions/${SITZUNG}`,
    vorbereitung: { stripe: { customerId: KUNDE } },
    aufruf: ["GET", `/api/self-service/billing/return?session_id=${SITZUNG}`],
  },
  {
    vorgang: "abo-anlegen",
    ziel: "POST /v1/subscriptions",
    vorbereitung: { stripe: { customerId: KUNDE, paymentMethodId: KARTE } },
    aufruf: ["POST", "/api/self-service/billing/subscribe", { plan: "starter" }],
  },
  {
    vorgang: "kuendigung-vormerken",
    ziel: `POST /v1/subscriptions/${ABO}`,
    vorbereitung: { aktiv: true, abo: { subscriptionId: ABO, planSlug: "starter" } },
    aufruf: ["POST", "/api/self-service/billing/cancel", {}],
  },
  {
    vorgang: "kuendigung-zuruecknehmen",
    ziel: `POST /v1/subscriptions/${ABO}`,
    vorbereitung: { aktiv: true, abo: { subscriptionId: ABO, planSlug: "starter", cancelAtPeriodEnd: true } },
    aufruf: ["POST", "/api/self-service/billing/resume", {}],
  },
];

const fehlerAntwort = (status, text) => Response.json({ error: { message: text } }, { status });

function stripeAntwort(ziel, abweichung) {
  return (pfad, methode) => {
    const schluessel = `${methode} ${pfad}`;
    if (schluessel === ziel && abweichung) return abweichung();
    const koerper = ERFOLG[schluessel];
    return koerper ? Response.json(koerper) : Response.json({}, { status: 404 });
  };
}

async function starteServer({ store, runner }) {
  const app = express();
  app.use(express.json());
  await wireWebLogin({
    app,
    config: KONFIGURATION,
    store,
    audit: () => {},
    provision: async () => ({ reason: "dry_run" }),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function meldeAn(s, runner, store, { aktiv, stripe, abo }) {
  const login = await abrufMitFrist(`http://127.0.0.1:${s.port}/auth/dev-login`, {
    method: "POST",
    redirect: "manual",
  });
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  if (aktiv) await runner.withClient((c) => c.query("UPDATE tenant SET status = 'active' WHERE id = $1", [TENANT]));
  if (stripe) store.setTenantStripe(TENANT, stripe);
  if (abo) store.setTenantSubscription(TENANT, abo);
  return cookie;
}

async function ruf({ ziel, vorbereitung, aufruf: [methode, pfad, body] }, abweichung) {
  attrappe.stripe = stripeAntwort(ziel, abweichung);
  const { store, runner } = await makePgTestStore();
  const s = await starteServer({ store, runner });
  try {
    const cookie = await meldeAn(s, runner, store, vorbereitung);
    const res = await mitStripe(globalThis.fetch, () => request(methode, `http://127.0.0.1:${s.port}${pfad}`, { cookie, body }));
    return { status: res.status, body: res.body, location: res.location };
  } finally {
    await s.close();
  }
}

async function gemessen(lauf) {
  return mitTelemetrie(starteTelemetrie, async ({ telemetrie, exporte }) => {
    const ergebnis = await lauf(telemetrie);
    await telemetrie.spuele();
    return { ergebnis, exporte };
  });
}

const zaehlungVon = (exporte, vorgang) =>
  zaehlerPunkte(exporte).filter((p) => p.vorgang === vorgang);
const dauerVon = (exporte, vorgang) => dauerPunkte(exporte).filter((p) => p.attribute.vorgang === vorgang);

for (const fall of VORGAENGE) {
  test(`${fall.vorgang}: Erfolg zaehlt ok, genau ein Dauer-Eintrag mit nur anbieter und vorgang`, async () => {
    const { exporte } = await gemessen(() => ruf(fall));
    assert.deepEqual(zaehlungVon(exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "ok", wert: 1 },
    ]);
    assert.deepEqual(dauerVon(exporte, fall.vorgang), [
      { attribute: { anbieter: "stripe", vorgang: fall.vorgang }, anzahl: 1 },
    ]);
  });

  test(`${fall.vorgang}: Stripe 500 zaehlt fehler, Stripe 429 zaehlt 429`, async () => {
    const fehler = await gemessen(() => ruf(fall, () => fehlerAntwort(HTTP_FEHLER, "kaputt")));
    assert.deepEqual(zaehlungVon(fehler.exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "fehler", wert: 1 },
    ]);
    const gedrosselt = await gemessen(() => ruf(fall, () => fehlerAntwort(HTTP_ZU_VIELE, "zu viele")));
    assert.deepEqual(zaehlungVon(gedrosselt.exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "429", wert: 1 },
    ]);
  });

  test(`${fall.vorgang}: 500 mit 429 im Text zaehlt fehler, der Text steht nicht im Export`, async () => {
    const { exporte } = await gemessen(() => ruf(fall, () => fehlerAntwort(HTTP_FEHLER, FEHLERTEXT_MIT_429)));
    assert.deepEqual(zaehlungVon(exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "fehler", wert: 1 },
    ]);
    assert.ok(!JSON.stringify(exporte).includes("kunde-abo@example.test"));
  });
}

test("Die Antwort der Route bleibt mit und ohne Messung gleich, bei Erfolg und bei Stripe 429", async () => {
  for (const fall of VORGAENGE) {
    for (const abweichung of [undefined, () => fehlerAntwort(HTTP_ZU_VIELE, "zu viele")]) {
      const ohne = await ruf(fall, abweichung);
      const { ergebnis } = await gemessen(() => ruf(fall, abweichung));
      assert.deepEqual(ergebnis, ohne, fall.vorgang);
    }
  }
});

test("Wirft das Erfassen, bleibt die Antwort gleich und die Logzeile nennt nur anbieter und vorgang", async () => {
  const fall = VORGAENGE[0];
  const ohne = await ruf(fall);
  const { ergebnis } = await gemessen(async (telemetrie) => {
    mock.method(telemetrie, "messeAnbieter", () => {
      throw new Error("Erfassen kaputt kunde-abo@example.test");
    });
    const warnung = mock.method(console, "warn", () => {});
    const res = await ruf(fall);
    const zeilen = warnung.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
    warnung.mock.restore();
    return { res, zeilen };
  });
  assert.deepEqual(ergebnis.res, ohne);
  assert.deepEqual(ergebnis.zeilen, [
    "[anbieter-messung] Erfassen fehlgeschlagen anbieter=stripe vorgang=kunde-anlegen",
    "[anbieter-messung] Erfassen fehlgeschlagen anbieter=stripe vorgang=checkout-abo-anlegen",
  ]);
});
