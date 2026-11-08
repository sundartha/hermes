import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { config } from "../../src/config.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { SESSION_COOKIE_NAME } from "../../src/web-auth.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeStripeStub } from "../helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { antwortetNie, mitKurzerFrist } from "../gemeinsam/kurze-antwortfrist.mjs";

const withStripeStub = makeStripeStub(config, "sk_test_karte_frist");

const TENANT = "t_dev-user";
const NEUER_KUNDE = "cus_karte_neu";
const CHECKOUT_URL = "https://checkout.stripe.test/cs_karte";
const NEUE_FRIST_UNTERGRENZE_MS = 30_000;
const BILLING_NICHT_ERREICHBAR = { error: "billing_unavailable" };

const basis = webLoginBasisKonfiguration("https://api.workos.test");
const KONFIGURATION = {
  ...basis,
  tenancy: { selfServiceEnabled: true, multiTenant: true },
  auth: { ...basis.auth, devLoginEnabled: true },
  billing: {
    paymentEnabled: true,
    stripeWebhookSecret: "whsec_karte",
    stripeStarterPriceId: "price_starter",
    stripeBusinessPriceId: "price_business",
    paymentCurrency: "eur",
    stripeCustomerRetryDelayMs: 0,
    numberSetupFeeCents: 0,
  },
  provisioning: { releaseGraceMs: 0, provisioningCountry: "DE" },
};

const pfadVon = (url) => new URL(url).pathname;

function stripeAntwort(url) {
  const pfad = pfadVon(url);
  if (pfad === "/v1/customers") return Response.json({ id: NEUER_KUNDE });
  if (pfad === "/v1/checkout/sessions") return Response.json({ id: "cs_karte", url: CHECKOUT_URL });
  return Response.json({}, { status: 404 });
}

const netzfehler = () => Promise.reject(new TypeError("fetch failed"));

const ausfallBei = (pfad, ausfall) => (url, init) =>
  init.method === "POST" && pfadVon(url) === pfad ? ausfall(url, init) : stripeAntwort(url);

async function starteServer() {
  const { store, runner } = await makePgTestStore();
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
  const { port } = server.address();
  return { store, port, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function meldeMandantAn(s) {
  const login = await abrufMitFrist(`http://127.0.0.1:${s.port}/auth/dev-login`, {
    method: "POST",
    redirect: "manual",
  });
  const [cookie] = login.headers.get("set-cookie").split(";");
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`), "Dev-Login setzt das Sitzungs-Cookie");
  return cookie;
}

async function kartenEinrichten(stripe) {
  const s = await starteServer();
  try {
    const cookie = await meldeMandantAn(s);
    const anfragen = [];
    const fristen = [];
    let antwort;
    await withStripeStub(
      (url, init) => {
        anfragen.push({ methode: init.method ?? "GET", pfad: pfadVon(url), init });
        return stripe(url, init);
      },
      async () => {
        const gemessen = await mitKurzerFrist(async () => {
          antwort = await request("POST", `http://127.0.0.1:${s.port}/api/self-service/billing/setup-checkout`, {
            cookie,
            body: {},
          });
        });
        fristen.push(...gemessen);
      },
    );
    const istJson = /application\/json/.test(antwort.headers["content-type"]);
    return {
      status: antwort.status,
      koerper: istJson ? JSON.parse(antwort.body) : antwort.body,
      anfragen,
      fristen,
      kunde: s.store.tenantStripe(TENANT).customerId ?? null,
    };
  } finally {
    await s.close();
  }
}

const posts = (anfragen, pfad) => anfragen.filter((a) => a.methode === "POST" && a.pfad === pfad);

test("Geld-Frist: Karten-Einrichtung mit antwortender Gegenseite trägt bei Kunde und Checkout Frist-Signal, Authorization und Körper unverändert", async () => {
  const { status, koerper, anfragen, fristen, kunde } = await kartenEinrichten(stripeAntwort);

  assert.deepEqual({ status, koerper }, { status: 200, koerper: { url: CHECKOUT_URL } });
  assert.equal(kunde, NEUER_KUNDE);
  const [kundeAnlegen] = posts(anfragen, "/v1/customers");
  const [checkout] = posts(anfragen, "/v1/checkout/sessions");
  for (const { init } of [kundeAnlegen, checkout]) {
    assert.ok(init.signal instanceof AbortSignal, "Anfrage trägt ein Frist-Signal");
    assert.equal("fristMs" in init, false, "fristMs erreicht fetch nicht");
    assert.equal(init.headers.Authorization, "Bearer sk_test_karte_frist");
    assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  }
  assert.equal(new URLSearchParams(String(kundeAnlegen.init.body)).get("metadata[tenant_ref]"), TENANT);
  const sitzung = new URLSearchParams(String(checkout.init.body));
  assert.equal(sitzung.get("mode"), "setup");
  assert.equal(sitzung.get("customer"), NEUER_KUNDE);
  assert.equal(fristen.length, 2, "Kunde und Checkout haben je eine Frist");
  assert.ok(
    fristen.every((ms) => ms >= NEUE_FRIST_UNTERGRENZE_MS),
    `Fristen ${fristen} liegen unter 30 s`,
  );
});

for (const [name, ausfall] of [
  ["Fristabbruch", antwortetNie],
  ["Netzfehler", netzfehler],
]) {
  test(`Geld-Frist: ${name} beim Kunde anlegen -> 502 billing_unavailable, kein Kunde gespeichert, kein Checkout, kein zweiter Versuch`, async () => {
    const { status, koerper, anfragen, kunde, fristen } = await kartenEinrichten(ausfallBei("/v1/customers", ausfall));

    assert.deepEqual({ status, koerper }, { status: 502, koerper: BILLING_NICHT_ERREICHBAR });
    assert.equal(kunde, null);
    assert.equal(posts(anfragen, "/v1/customers").length, 1);
    assert.equal(posts(anfragen, "/v1/checkout/sessions").length, 0);
    assert.equal(fristen.length, 1, "der Kunde trägt genau eine Frist");
  });

  test(`Geld-Frist: ${name} beim Checkout anlegen -> 502 billing_unavailable ohne Adresse, kein zweiter Versuch`, async () => {
    const { status, koerper, anfragen, fristen } = await kartenEinrichten(ausfallBei("/v1/checkout/sessions", ausfall));

    assert.deepEqual({ status, koerper }, { status: 502, koerper: BILLING_NICHT_ERREICHBAR });
    assert.equal(posts(anfragen, "/v1/customers").length, 1);
    assert.equal(posts(anfragen, "/v1/checkout/sessions").length, 1);
    assert.equal(fristen.length, 2, "Kunde und Checkout tragen je eine Frist");
  });
}
