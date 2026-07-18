// P7 (Cluster 7, G5, DoD-Pflicht): requirePaymentEnabled() in src/billing/payment-gate.js
// ersetzt den vormals an 7 Stellen verdoppelten PAYMENT_ENABLED-404-Guard (6 identisch +
// 1 abweichender Text im Metering-Flush; der 7. Fund - routes/stripe-webhook.js - kam erst
// aus dem P7-Review nach, Blocker S2). Drei Ebenen:
//   (1) direkter Unit-Test der reinen Funktion (fail-closed, Default-/Override-Message);
//   (2) alle 6 realen Routen (routes/api-billing.js + self-service-routes.js) bei
//       PAYMENT_ENABLED=false -> 404 mit dem exakten JSON-Body;
//   (3) der 7. Fund routes/stripe-webhook.js -> 404 mit seinem EIGENEN abweichenden Text
//       ("payment disabled", ohne "(PAYMENT_ENABLED)"-Suffix), bevor die Signaturpruefung
//       greift (Gate steht als ALLERERSTE Zeile im Handler).
// KEIN Server-Spawn (Lehre p6a-Stall): api-billing.js direkt gemountet (Gate kommt VOR
// jedem store/billing-Zugriff -> Stub-Deps genuegen); self-service-routes.js braucht eine
// echte eingeloggte Session (webAuthPendingMw laeuft VOR dem Gate) -> pglite ohne Spawn,
// Muster w4-self-service-subscribe.test.js; stripe-webhook.js ist ein direkter
// Handler-Aufruf (kein Router-Mount noetig, Gate steht vor jedem rawBody-Zugriff).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requirePaymentEnabled } from "../src/billing/payment-gate.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { makeStripeWebhookRoute } from "../src/routes/stripe-webhook.js";
import { webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { registerTenant } from "../src/store/state-ops.js";
import { makePgTestStore } from "./pg-helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const PAYMENT_DISABLED_MESSAGE = "payment disabled (PAYMENT_ENABLED)";
const METERING_DISABLED_MESSAGE = "metering disabled (PAYMENT_ENABLED)";
const STRIPE_WEBHOOK_DISABLED_MESSAGE = "payment disabled";

// ---- (1) Direkter Unit-Test der reinen Gate-Funktion ----------------------------

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

test("requirePaymentEnabled: paymentEnabled=true -> true, res unberuehrt", () => {
  const res = fakeRes();
  assert.equal(requirePaymentEnabled(res, withConfigNamespaces({ paymentEnabled: true })), true);
  assert.equal(res.statusCode, null);
});

test("requirePaymentEnabled: paymentEnabled=false, kein message-Override -> 404 mit Default-Text", () => {
  const res = fakeRes();
  assert.equal(requirePaymentEnabled(res, withConfigNamespaces({ paymentEnabled: false })), false);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: PAYMENT_DISABLED_MESSAGE });
});

test("requirePaymentEnabled: paymentEnabled=false, message-Override -> 404 mit dem uebergebenen Text", () => {
  const res = fakeRes();
  assert.equal(requirePaymentEnabled(res, withConfigNamespaces({ paymentEnabled: false }), "custom text"), false);
  assert.deepEqual(res.body, { error: "custom text" });
});

// ---- (2a) routes/api-billing.js: 3 Routen, direkt gemountet (kein Spawn) --------

async function startBillingApp() {
  const app = express();
  app.use(express.json());
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled: false }),
      store: {},
      audit: () => {},
      billing: {},
      tenant: {},
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("PAYMENT_ENABLED aus: alle 3 routes/api-billing.js-Routen -> 404 mit exaktem Body", async () => {
  const app = await startBillingApp();
  try {
    const flush = await fetch(`${app.base}/api/billing/flush-meters`, { method: "POST" });
    assert.equal(flush.status, 404);
    assert.deepEqual(await flush.json(), { error: METERING_DISABLED_MESSAGE });

    const setup = await fetch(`${app.base}/api/billing/setup-checkout`, { method: "POST" });
    assert.equal(setup.status, 404);
    assert.deepEqual(await setup.json(), { error: PAYMENT_DISABLED_MESSAGE });

    const ret = await fetch(`${app.base}/api/billing/checkout-return?session_id=cs_1`);
    assert.equal(ret.status, 404);
    assert.deepEqual(await ret.json(), { error: PAYMENT_DISABLED_MESSAGE });
  } finally {
    await app.close();
  }
});

// ---- (2b) self-service-routes.js: 3 Routen hinter einer echten Session ---------
// webAuthPendingMw laeuft VOR requirePaymentEnabled -> braucht eine gueltige Session
// (pglite, kein Spawn, Muster w4-self-service-subscribe.test.js).

const SECRET = "payment-gate-test-secret-0123456789";
const SUB = "sub-paygate";
const TENANT = "t_sub-paygate";

test("PAYMENT_ENABLED aus: alle 3 self-service/billing-Routen -> 404 mit exaktem Body (eingeloggt)", async () => {
  // makeAccounts/makeSessions brauchen denselben pglite-Runner wie der Store (Muster
  // w4-self-service-subscribe.test.js): makePgTestStore liefert store + die rohe pglite-
  // Instanz db, aus der hier derselbe Runner-Vertrag fuer Accounts/Sessions gebaut wird.
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };

  const s = store.load();
  registerTenant(s, TENANT, { firstName: "Kunde", lastName: "Paygate" });
  const t = s.tenants.find((x) => x.id === TENANT);
  t.idpSubject = SUB;

  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "paygate@kunde.de" });
  await accounts.setStatus(TENANT, "active");
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: 3600 });
  const cookie = `session=${encodeURIComponent(signValue(sessionId, SECRET))}`;

  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: false, publicUrl: "https://test.local" }),
      billing: {},
      accounts,
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const fetchWithCookie = (path, opts = {}) =>
    fetch(`${base}${path}`, { ...opts, headers: { ...opts.headers, Cookie: cookie } });

  try {
    const setup = await fetchWithCookie("/api/self-service/billing/setup-checkout", { method: "POST" });
    assert.equal(setup.status, 404);
    assert.deepEqual(await setup.json(), { error: PAYMENT_DISABLED_MESSAGE });

    const ret = await fetchWithCookie("/api/self-service/billing/return?session_id=cs_1");
    assert.equal(ret.status, 404);
    assert.deepEqual(await ret.json(), { error: PAYMENT_DISABLED_MESSAGE });

    const sub = await fetchWithCookie("/api/self-service/billing/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "starter" }),
    });
    assert.equal(sub.status, 404);
    assert.deepEqual(await sub.json(), { error: PAYMENT_DISABLED_MESSAGE });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---- (2c) routes/stripe-webhook.js: der 7. Fund, abweichender Text ("payment disabled",
// ohne "(PAYMENT_ENABLED)"-Suffix). Gate ist die allererste Zeile -> direkter Handler-
// Aufruf mit einem Fake-req/res genuegt (kein rawBody/Signatur-Setup noetig).

function fakeStripeWebhookReqRes() {
  const res = fakeRes();
  const req = { rawBody: Buffer.from(""), headers: {} };
  return { req, res };
}

test("PAYMENT_ENABLED aus: routes/stripe-webhook.js -> 404 mit dem eigenen abweichenden Text", async () => {
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: false }),
    store: {},
    audit: () => {},
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
  });
  const { req, res } = fakeStripeWebhookReqRes();
  await handler(req, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: STRIPE_WEBHOOK_DISABLED_MESSAGE });
});
