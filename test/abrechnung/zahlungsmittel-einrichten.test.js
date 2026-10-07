import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { requirePublicUrl, ERROR_SERVER_UNCONFIGURED } from "../../src/billing/payment-gate.js";
import { makeBillingRoutes } from "../../src/routes/api-billing.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { startServer, seedState, PLAN_PRICE_BOOT_ENV } from "../helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const BOOTSTRAP_TENANT_ID = "owner";
const SUB_A = "sub-a";
const CUST = "cus_test1";
const PM = "pm_test1";
const SESSION = "cs_1";

function fakeRes() {
  const gesendet = { statusCode: null, body: null };
  return Object.assign(gesendet, {
    status: (code) => Object.assign(gesendet, { statusCode: code }),
    json: (body) => Object.assign(gesendet, { body }),
  });
}

function listen(app, host) {
  return new Promise((resolve) => {
    const server = app.listen(0, host, () => resolve(server));
  });
}

function closer(server) {
  return () => new Promise((resolve) => server.close(resolve));
}

async function startBillingApp(publicUrl) {
  let tenantResolverCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled: true, publicUrl }),
      store: {},
      audit: () => {},
      billing: {},
      tenant: {
        requireTenant: (req, res) => {
          tenantResolverCalls += 1;
          res.status(HTTP_FORBIDDEN).json({ error: "TENANT_REJECT" });
          return null;
        },
      },
    }),
  );
  const server = await listen(app, "127.0.0.1");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: closer(server),
    tenantResolverCalls: () => tenantResolverCalls,
  };
}

test("requirePublicUrl: publicUrl gesetzt -> true, res unberuehrt", () => {
  const res = fakeRes();
  assert.equal(requirePublicUrl(res, withConfigNamespaces({ publicUrl: "https://agent.test" })), true);
  assert.equal(res.statusCode, null);
});

test("requirePublicUrl: publicUrl leer -> 500 + Code server_unconfigured, kein Klartext", () => {
  const res = fakeRes();
  assert.equal(requirePublicUrl(res, withConfigNamespaces({ publicUrl: "" })), false);
  assert.equal(res.statusCode, HTTP_SERVER_ERROR);
  assert.deepEqual(res.body, { error: ERROR_SERVER_UNCONFIGURED });
});

test("setup-checkout ohne oeffentliche Basis-URL -> 500 mit sprachneutralem Code, kein Env-Name (api-billing)", async () => {
  const app = await startBillingApp("");
  try {
    const res = await fetch(`${app.base}/api/billing/setup-checkout`, { method: "POST" });
    assert.equal(res.status, HTTP_SERVER_ERROR);
    const json = await res.json();
    assert.equal(json.error, ERROR_SERVER_UNCONFIGURED);
    assert.doesNotMatch(json.error, /\s/);
    assert.doesNotMatch(json.error, /PUBLIC_URL/i);
    assert.equal(app.tenantResolverCalls(), 0);
  } finally {
    await app.close();
  }
});

test("setup-checkout mit gesetzter Basis-URL -> Guard laesst durch (glueckliche Pfad)", async () => {
  const app = await startBillingApp("https://agent.test");
  try {
    const res = await fetch(`${app.base}/api/billing/setup-checkout`, { method: "POST" });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal(app.tenantResolverCalls(), 1);
  } finally {
    await app.close();
  }
});

function stripeAntwort(req) {
  if (req.method === "POST" && req.url === "/v1/customers") return { id: CUST };
  if (req.method === "POST" && req.url === "/v1/checkout/sessions")
    return { id: SESSION, url: `https://stripe.test/c/${SESSION}` };
  if (req.method === "GET" && req.url.startsWith("/v1/checkout/sessions/cs_other"))
    return { customer: "cus_other", setup_intent: { payment_method: "pm_other" } };
  if (req.method === "GET" && req.url.startsWith(`/v1/checkout/sessions/${SESSION}`))
    return { customer: CUST, setup_intent: { payment_method: PM } };
  return null;
}

async function startFakeStripe() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const antwort = stripeAntwort(req);
      res.writeHead(antwort === null ? HTTP_NOT_FOUND : HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify(antwort ?? {}));
    });
  });
  const listening = await listen(server, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${listening.address().port}`,
    close: closer(listening),
  };
}

const seedTenantA = () =>
  seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", idpSubject: SUB_A }] });

const PAY_ENV = (stripeUrl) => ({
  MULTI_TENANT: "true",
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: stripeUrl,
  NUMBER_SETUP_FEE_CENTS: "500",
  ...PLAN_PRICE_BOOT_ENV,
});

const postAs = (srv, idpSub, path) =>
  fetch(`${srv.localUrl}${path}`, { method: "POST", headers: { "X-Internal-Identity": idpSub } });
const getAs = (srv, idpSub, path) =>
  fetch(`${srv.localUrl}${path}`, { headers: { "X-Internal-Identity": idpSub } });
const ownerTenant = (srv) => srv.readStore().tenants.find((tenant) => tenant.id === BOOTSTRAP_TENANT_ID);

test("Flag aus (PAYMENT_ENABLED default false): beide Routen 404 (byte-identisch)", async () => {
  const srv = await startServer({ seed: seedTenantA() });
  try {
    assert.equal(
      (await postAs(srv, SUB_A, "/api/billing/setup-checkout")).status,
      HTTP_NOT_FOUND,
      "setup-checkout 404",
    );
    assert.equal(
      (await getAs(srv, SUB_A, "/api/billing/checkout-return?session_id=cs_1")).status,
      HTTP_NOT_FOUND,
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
    assert.equal(checkout.status, HTTP_OK);
    assert.equal(
      (await checkout.json()).url,
      `https://stripe.test/c/${SESSION}`,
      "Stripe-Checkout-URL durchgereicht",
    );
    assert.equal(ownerTenant(srv).stripeCustomerId, CUST, "Customer im Store hinterlegt");

    const ret = await getAs(srv, SUB_A, `/api/billing/checkout-return?session_id=${SESSION}`);
    assert.equal(ret.status, HTTP_OK);
    assert.equal((await ret.json()).status, "card_on_file");
    assert.equal(ownerTenant(srv).stripePaymentMethodId, PM, "payment_method im Store gespeichert");
  } finally {
    await srv.stop();
    await stripe.close();
  }
});

test("Customer-Mismatch (fremde session_id -> fremder Customer) -> 403, KEIN payment_method gebunden", async () => {
  const stripe = await startFakeStripe();
  const srv = await startServer({ env: PAY_ENV(stripe.url), seed: seedTenantA() });
  try {
    await postAs(srv, SUB_A, "/api/billing/setup-checkout");
    const ret = await getAs(srv, SUB_A, "/api/billing/checkout-return?session_id=cs_other");
    assert.equal(ret.status, HTTP_FORBIDDEN, "Customer-Mismatch -> 403");
    assert.equal("stripePaymentMethodId" in ownerTenant(srv), false, "kein fremdes payment_method gebunden");
  } finally {
    await srv.stop();
    await stripe.close();
  }
});

test("TENANT_REJECT (vorhandene, unbekannte Identitaet) -> setup-checkout 403", async () => {
  const stripe = await startFakeStripe();
  const srv = await startServer({ env: PAY_ENV(stripe.url), seed: seedTenantA() });
  try {
    assert.equal((await postAs(srv, "sub-unknown", "/api/billing/setup-checkout")).status, HTTP_FORBIDDEN);
  } finally {
    await srv.stop();
    await stripe.close();
  }
});
