// Pay1: Routen /api/billing/setup-checkout (POST) + /api/billing/checkout-return (GET).
// Spawn (node:test), offline gegen eine Mini-Fake-Stripe (STRIPE_API_BASE zeigt darauf
// -> KEIN echter Netz-Call, kein api.stripe.com). KEIN pglite in derselben Datei (Lehre
// P6a: nie mit Server-Spawn mischen). Prueft das PAYMENT_ENABLED-404-Gate (Flag aus =
// byte-identisch), den Happy-Path (Customer anlegen -> Karte speichern), die fail-closed
// Customer-Match-Invariante (cross-tenant session_id -> 403) und das TENANT_REJECT-403.
//
// Identitaets-Threading wie read-scope-tenant.test.js: localhost-Request mit
// X-Internal-Identity = idpSubject -> exakt der requestTenant-REST-Pfad.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, PLAN_PRICE_BOOT_ENV } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const SUB_A = "sub-a";
const CUST = "cus_test1",
  PM = "pm_test1",
  SESSION = "cs_1";

// Mini-Fake-Stripe (Vorlage startTelnyxProvisioningMock): die drei Pay1-Endpunkte.
// getCheckoutSessionResult liefert per default cus_test1; ein Sonderpfad
// (cs_other) liefert einen FREMDEN Customer fuer den Mismatch-Test.
async function startFakeStripe() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/v1/customers")
        return res.end(JSON.stringify({ id: CUST }));
      if (req.method === "POST" && req.url === "/v1/checkout/sessions")
        return res.end(JSON.stringify({ id: SESSION, url: `https://stripe.test/c/${SESSION}` }));
      if (req.method === "GET" && req.url.startsWith("/v1/checkout/sessions/cs_other"))
        return res.end(
          JSON.stringify({ customer: "cus_other", setup_intent: { payment_method: "pm_other" } }),
        );
      if (req.method === "GET" && req.url.startsWith(`/v1/checkout/sessions/${SESSION}`))
        return res.end(JSON.stringify({ customer: CUST, setup_intent: { payment_method: PM } }));
      res.statusCode = 404;
      res.end(JSON.stringify({}));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Ein aktiver Tenant A mit idpSubject (Karten-Erfassung laeuft tenant-scoped).
const seedTenantA = () =>
  seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", idpSubject: SUB_A }] });

// Env mit PAYMENT_ENABLED an: NUMBER_SETUP_FEE_CENTS>0 ist assertConfig-Pflicht,
// STRIPE_API_BASE muss auf die Fake-Stripe zeigen (sonst Live-Default api.stripe.com).
// STRIPE_WEBHOOK_SECRET ist seit W4 Boot-Pflicht bei PAYMENT_ENABLED (Webhook sonst
// fail-closed unverifizierbar) - ohne diese Zeile verweigert assertConfig den Boot und
// der Spawn haengt; der Wert ist hier neutral (dieser Test nutzt den Webhook nicht).
const PAY_ENV = (stripeUrl) => ({
  MULTI_TENANT: "true",
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: stripeUrl,
  NUMBER_SETUP_FEE_CENTS: "500",
  // GP-P6: Price-Id je Katalog-Slug ist bei PAYMENT_ENABLED=true Boot-Pflicht (assertPricedPlans).
  ...PLAN_PRICE_BOOT_ENV,
});

const postAs = (srv, idpSub, path) =>
  fetch(`${srv.localUrl}${path}`, { method: "POST", headers: { "X-Internal-Identity": idpSub } });
const getAs = (srv, idpSub, path) =>
  fetch(`${srv.localUrl}${path}`, { headers: { "X-Internal-Identity": idpSub } });

test("Flag aus (PAYMENT_ENABLED default false): beide Routen 404 (byte-identisch)", async () => {
  const srv = await startServer({ seed: seedTenantA() });
  try {
    assert.equal(
      (await postAs(srv, SUB_A, "/api/billing/setup-checkout")).status,
      404,
      "setup-checkout 404",
    );
    assert.equal(
      (await getAs(srv, SUB_A, "/api/billing/checkout-return?session_id=cs_1")).status,
      404,
      "checkout-return 404",
    );
  } finally {
    await srv.stop();
  }
});

test("Happy-Path: setup-checkout legt Customer an (Store), checkout-return speichert payment_method", async () => {
  const stripe = await startFakeStripe();
  const srv = await startServer({ env: PAY_ENV(stripe.url), seed: seedTenantA() });
  try {
    const checkout = await postAs(srv, SUB_A, "/api/billing/setup-checkout");
    assert.equal(checkout.status, 200);
    assert.equal(
      (await checkout.json()).url,
      `https://stripe.test/c/${SESSION}`,
      "Stripe-Checkout-URL durchgereicht",
    );
    assert.equal(
      srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID).stripeCustomerId,
      CUST,
      "Customer im Store hinterlegt",
    );

    const ret = await getAs(srv, SUB_A, `/api/billing/checkout-return?session_id=${SESSION}`);
    assert.equal(ret.status, 200);
    assert.equal((await ret.json()).status, "card_on_file");
    assert.equal(
      srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID).stripePaymentMethodId,
      PM,
      "payment_method im Store gespeichert",
    );
  } finally {
    await srv.stop();
    await stripe.close();
  }
});

test("Customer-Mismatch (fremde session_id -> fremder Customer) -> 403, KEIN payment_method gebunden", async () => {
  const stripe = await startFakeStripe();
  const srv = await startServer({ env: PAY_ENV(stripe.url), seed: seedTenantA() });
  try {
    // Erst Customer cus_test1 anlegen (setup-checkout), dann return mit cs_other (cus_other).
    await postAs(srv, SUB_A, "/api/billing/setup-checkout");
    const ret = await getAs(srv, SUB_A, "/api/billing/checkout-return?session_id=cs_other");
    assert.equal(ret.status, 403, "Customer-Mismatch -> 403");
    assert.equal(
      "stripePaymentMethodId" in srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID),
      false,
      "kein fremdes payment_method gebunden",
    );
  } finally {
    await srv.stop();
    await stripe.close();
  }
});

test("TENANT_REJECT (vorhandene, unbekannte Identitaet) -> setup-checkout 403", async () => {
  const stripe = await startFakeStripe();
  const srv = await startServer({ env: PAY_ENV(stripe.url), seed: seedTenantA() });
  try {
    assert.equal((await postAs(srv, "sub-unknown", "/api/billing/setup-checkout")).status, 403);
  } finally {
    await srv.stop();
    await stripe.close();
  }
});
